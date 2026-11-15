/* Zen Refined — Adaptive Page Transitions
 * Native navigation always proceeds normally. All pixels are ephemeral, in memory.
 * No interception of requests, content injection, disk writes, or viewport resize.
 */
const PREFIX = "zen.refined.transitions.";
const KEY = "__zenRefinedPageTransitions";
const NS = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const ACTOR = "ZenRefinedHybridReveal";
const ACTOR_URI = "chrome://sine/content/9d788b55-d497-41da-8444-993c603e89e4/actors/ZenRefinedHybridRevealParent.sys.mjs";
const P = Ci.nsIWebProgressListener;
const root = document.documentElement;
const prefs = Services.prefs;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const isWeb = s => /^https?:\/\//i.test(s || "");
const stripHash = s => (s || "").split("#")[0];
let startup = null, teardown = null, disposed = false;

function install() {
  const gb = window.gBrowser;
  if (!gb?.addTabsProgressListener) return () => {};
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let active = null, origin = null, originTimer = 0, serial = 0, dead = false;
  let releaseActor = null, enabled = false;
  let historyUntil = 0, cached = null, warming = false, warmTimer = 0, lastWarm = -Infinity, cacheEpoch = 0;
  let recentPointer = null, pending = null, pendingTimer = 0, lastResult = null;
  const log = (...args) => console.info('[Zen Refined transitions 0.3.0-preview.5]', ...args);
  const painted = new WeakSet();
  const locations = new WeakMap();
  const scenes = new WeakMap();
  for (const b of gb.browsers) locations.set(b, b.currentURI?.spec || "");
  const debug = (...args) => { if (prefs.getBoolPref(PREFIX + "debug", false)) console.debug("[Zen Refined transitions]", ...args); };
  const on = (key, fallback = true) => prefs.getBoolPref(PREFIX + key, fallback);
  const maxTime = () => clamp(prefs.getIntPref(PREFIX + "timeout", 4000), 800, 4000);
  const now = () => window.performance.now();
  function safeBrowser(b) {
    return !!b && enabled && !motion.matches && b === gb.selectedBrowser &&
      !root.hasAttribute("inDOMFullscreen") && !root.hasAttribute("customizing") &&
      !window.document.fullscreenElement && !gb.selectedTab?.hasAttribute("splitview") &&
      !gb.selectedTab?.hasAttribute("zen-split-view") && !gb.selectedTab?.hasAttribute("split-view") &&
      !b.closest?.("[zen-split-view]") && b.getBoundingClientRect().width > 20;
  }
  function getActor(b) {
    try { return b.browsingContext.currentWindowGlobal.getActor(ACTOR); } catch { return null; }
  }
  function clearCache() {
    cacheEpoch++;
    cached?.bitmap?.close?.(); cached=null;
    window.clearTimeout(warmTimer); warmTimer=0;
  }
  function scheduleWarm(delay=180) {
    window.clearTimeout(warmTimer);
    if(!enabled || !on("snapshot") || motion.matches || dead)return;
    warmTimer=window.setTimeout(()=>warm(gb.selectedBrowser,true),delay);
  }
  function warm(b, force=false) {
    if(!safeBrowser(b)||!on("snapshot")||active||pending||origin||!isWeb(b.currentURI?.spec))return;
    const delay=(force?350:1000)-(now()-lastWarm);
    if(warming || delay>0){if(force)scheduleWarm(Math.max(120,delay));return;}
    const bounds=b.getBoundingClientRect(), global=b.browsingContext?.currentWindowGlobal, uri=b.currentURI.spec;
    if(!global?.drawSnapshot){debug("warm: drawSnapshot unavailable");return;}
    const scale=clamp(1900/Math.max(bounds.width,bounds.height),.12,1), epoch=cacheEpoch;
    warming=true;lastWarm=now();
    try {
      global.drawSnapshot(null,scale,"transparent",{drawView:true}).then(bitmap=>{
        if(!bitmap)return;
        if(dead||!enabled||cacheEpoch!==epoch||active||pending||origin||b!==gb.selectedBrowser||
          b.browsingContext?.currentWindowGlobal!==global||b.currentURI?.spec!==uri){
          bitmap.close?.();return;
        }
        // Validate and upload the outgoing frame BEFORE navigation, not in
        // the first animation frame. Keep the previous good frame if this fails.
        const frame=drawSource({bitmap},bounds);
        bitmap.close?.();
        if(!frame){debug("warm: rejected outgoing frame");return;}
        cached?.bitmap?.close?.();
        cached={browser:b,uri,global,frame,sample:sampleFrame(frame,frame.width,frame.height),scene:sceneFor(b,uri),at:now()};
        debug("warm: cached outgoing viewport",frame.width,frame.height);
      },error=>debug("warm: drawSnapshot rejected",String(error))).finally(()=>{
        warming=false;
        if(cacheEpoch!==epoch)scheduleWarm();
      });
    }catch(error){warming=false;debug("warm: failed",String(error));}
  }
  function sceneFor(b,uri){
    const scene=scenes.get(b);
    return scene&&stripHash(scene.uri)===stripHash(uri)&&now()-scene.at<2500?scene:null;
  }
  function acceptScene(b,global,data){
    if(typeof data?.uri!=="string"||!Array.isArray(data.dynamic)||data.dynamic.length>128)return null;
    const dynamic=data.dynamic.filter(r=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite))
      .map(r=>r.map(v=>clamp(v,0,1))).filter(r=>r[2]>r[0]&&r[3]>r[1]);
    const scene={uri:data.uri,dynamic,at:now(),global};
    // Keep source-route data even when input IPC follows the route change,
    // but never replace an incoming route's cached scene with old metadata.
    if(stripHash(data.uri)===stripHash(b.currentURI?.spec))scenes.set(b,scene);
    return scene;
  }
  function pointer(b) {
    const r=b.getBoundingClientRect();
    if(recentPointer?.browser===b&&now()-recentPointer.at<1800)return recentPointer;
    try {
      const x={},y={};
      window.windowUtils.getLastOverWindowPointerLocationInCSSPixels(x,y);
      if(Number.isFinite(x.value)&&Number.isFinite(y.value)&&(x.value||y.value))
        return {x:x.value,y:y.value};
    }catch{}
    return {x:r.left+r.width/2,y:r.top+r.height/2};
  }
  function clearPending() {
    window.clearTimeout(pendingTimer);pendingTimer=0;pending=null;
  }
  function clearOrigin() {
    window.clearTimeout(originTimer);
    originTimer = 0;
    if (origin) { origin.expired = true; origin.bitmap?.close?.(); origin.bitmap = null; origin.pixels=null; }
    origin = null;
  }
  function validPixels(ctx, width, height) {
    try {
      const sample = document.createElementNS(NS,"canvas");
      sample.width=12; sample.height=8;
      const c=sample.getContext("2d",{willReadFrequently:true});
      c.drawImage(ctx.canvas,0,0,width,height,0,0,12,8);
      const pixels=c.getImageData(0,0,12,8).data;
      let lo=255,hi=0,opaque=0;
      for(let i=0;i<pixels.length;i+=4){
        if(pixels[i+3]<128)continue;
        opaque++; const v=(pixels[i]+pixels[i+1]+pixels[i+2])/3;
        lo=Math.min(lo,v);hi=Math.max(hi,v);
      }
      return opaque>=94 && hi-lo>=8;
    } catch {return false;}
  }
  function capture(b,rec) {
    if(!on("snapshot") || rec.expired)return;
    try {
      const global=b.browsingContext?.currentWindowGlobal;
      const bounds=b.getBoundingClientRect();
      if(!global?.drawSnapshot || !isWeb(b.currentURI?.spec))return;
      const uri=b.currentURI.spec;
      if(rec.uri!==uri)return;
      const scale=clamp(1900/Math.max(bounds.width,bounds.height),.12,1);
      // Browser chrome inputs (bookmarks/URL bar) have no content pointer actor.
      // Capture before the command and accept only while the old URI is current.
      global.drawSnapshot(null,scale,"transparent",{drawView:true}).then(bitmap=>{
        if(!bitmap)return;
        if(origin!==rec || rec.expired || dead || b.browsingContext?.currentWindowGlobal!==global ||
            b.currentURI?.spec!==uri){bitmap.close?.();return;}
        if(rec.bitmap)rec.bitmap.close?.();
        rec.bitmap=bitmap;
      },()=>{});
    }catch{}
  }
  function remember(b,rect,pixels=null,sourceURI=b.currentURI?.spec) {
    if(!safeBrowser(b) || !on("snapshot"))return;
    if(active)finish(active,"interaction");
    clearOrigin();
    origin={browser:b,rect,at:now(),bitmap:null,pixels,expired:false,global:b.browsingContext?.currentWindowGlobal,uri:sourceURI};
    // Late input IPC must never capture the destination as the outgoing page.
    if(!pixels && sourceURI===b.currentURI?.spec && (cached?.browser!==b||cached.uri!==sourceURI))capture(b,origin);
    debug('origin',pixels?'local snapshot':'cached/async snapshot');
    originTimer=window.setTimeout(clearOrigin,1400);
  }
  function newNode(tag,cls) {
    const el=document.createElementNS(NS,tag);el.className=cls;return el;
  }
  function svg(tag,attrs={}){
    const el=document.createElementNS(SVG,tag);
    for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));
    return el;
  }
  function drawSource(source,bounds) {
    const canvas=newNode("canvas","zr-page-transition-backdrop");
    try {
      const pixels=source.pixels,bitmap=source.bitmap;
      if(pixels){
        const {width,height,data}=pixels;
        if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||
          width>2200||height>2200||width*height>3000000||data?.length!==width*height*4)return null;
        canvas.width=width;canvas.height=height;
        const ctx=canvas.getContext("2d");const img=ctx.createImageData(width,height);
        img.data.set(data);ctx.putImageData(img,0,0);
      }else if(bitmap){
        canvas.width=bitmap.width;canvas.height=bitmap.height;
        canvas.getContext("2d").drawImage(bitmap,0,0);
      }else return null;
      const ratio=canvas.width/canvas.height, expected=bounds.width/bounds.height;
      if(Math.abs(ratio/expected-1)>.10 || !validPixels(canvas.getContext("2d"),canvas.width,canvas.height))return null;
      return canvas;
    }catch{return null;}
  }
  function point(bounds,rect){
    return {x:clamp(rect.x-bounds.left,0,bounds.width),y:clamp(rect.y-bounds.top,0,bounds.height)};
  }
  function begin(b,kind,uri){
    if(!safeBrowser(b)||!isWeb(uri)||!on("snapshot")||now()<historyUntil||
       (kind==="soft"&&!on("soft")))return null;
    if(active)finish(active,"superseded");
    const bounds=b.getBoundingClientRect();
    if(!window.CSS?.supports?.("mask-image","radial-gradient(circle, transparent 20px, black 21px)")){debug("skip: unsupported mask");return null;}
    let source=origin?.browser===b && now()-origin.at<1400 ? origin:null;
    // No guessed pointer and no free-floating loading animation. History,
    // redirects without user intent, and failed captures remain native.
    const oldURI=pending?.previous||locations.get(b)||b.currentURI?.spec;
    const oldCache=cached?.browser===b && cached.uri===oldURI && now()-cached.at<120000 ? cached:null;
    if(source&&source.uri!==oldURI){clearOrigin();source=null;}
    if(!source && oldCache)source={browser:b,rect:pointer(b),bitmap:null,pixels:null,global:oldCache.global,uri:oldCache.uri};
    if(!source){debug("skip: no origin or cached frame");return null;}
    window.clearTimeout(originTimer);originTimer=0;origin=null;
    let backdrop=oldCache?.frame||drawSource(source,bounds);
    if(backdrop&&Math.abs((backdrop.width/backdrop.height)/(bounds.width/bounds.height)-1)>.12)backdrop=null;
    source.expired=true;source.bitmap?.close?.();source.bitmap=null;source.pixels=null;
    if(!backdrop){debug("skip: no valid outgoing snapshot");return null;}
    clearPending();
    clearCache();
    const overlay=newNode("div","zr-live-reveal"),cover=newNode("div","zr-live-reveal-cover");
    const shade=newNode("div","zr-live-reveal-shade"),shield=newNode("div","zr-live-reveal-shield");
    const art=svg("svg",{class:"zr-live-reveal-art",viewBox:"0 0 "+bounds.width+" "+bounds.height});
    const defs=svg("defs"),gradient=svg("linearGradient",{id:"zr-live-reveal-drop-"+(serial+1),x1:"0",y1:"0",x2:"0",y2:"1"});
    const light=svg("stop",{offset:"0%","stop-color":"#dedede"}),dark=svg("stop",{offset:"100%","stop-color":"#a8a8a8"});
    gradient.append(light,dark);defs.append(gradient);
    const ring=svg("circle",{cx:bounds.width/2,cy:bounds.height/2,r:23,fill:"none",stroke:"#888","stroke-width":"1.5",opacity:"0"});
    const drop=svg("path",{fill:"url(#zr-live-reveal-drop-"+(serial+1)+")",stroke:"#969696","stroke-width":"1.25"});
    art.append(defs,ring,drop);cover.append(backdrop,shade);overlay.append(cover,shield,art);
    const start=now();
    const st={token:++serial,browser:b,kind,uri,start,timeout:maxTime(),nominal:800,
      w:bounds.width,h:bounds.height,left:bounds.left,top:bounds.top,overlay,cover,backdrop,shade,shield,art,drop,ring,light,dark,
      from:point(bounds,source.rect),committed:kind==="soft",global:kind==="soft"?b.browsingContext?.currentWindowGlobal:null,
      oldGlobal:oldCache?.global||source.global||null,oldURI,
      oldSample:oldCache?.sample||sampleFrame(backdrop,backdrop.width,backdrop.height),
      sourceScene:sceneFor(b,oldURI)||oldCache?.scene||null,
      dynamicMask:makeDynamicMask([...(oldCache?.scene?.dynamic||[]),...(sceneFor(b,oldURI)?.dynamic||[])]),
      firstPaint:null,paintReason:null,visibleAt:null,raf:0,timer:0,lastGeometry:start,
      progress:0,flightMs:260,last:start,rate:1,finalRendered:false,dim:on("dim"),radius:0,
      nextProbe:start+180,probing:false,probeCount:0,probeGeneration:0,probeSample:null,commitAt:kind==="soft"?start:null};
    active=st;
    try{
      // Leave the remote browser entirely untouched. Only the static cover
      // and the small dark shield are clipped. The live compositor is free
      // to paint underneath, including accelerated video.
      root.append(overlay);syncGeometry(st,true);
      if(st.dim)shade.style.opacity=".06";
      render(st,start);
      st.timer=window.setTimeout(()=>{
        if(active!==st)return;st.progress=1;render(st,st.start+st.timeout);finish(st,"deadline-watchdog");
      },st.timeout);
      st.raf=window.requestAnimationFrame(t=>tick(st,t));
      debug("start",kind,"live browser untouched");
      if(kind==="soft")watchSoft(st);
      return st;
    }catch(error){finish(st,"setup-error");console.warn("[Zen Refined transitions]",error);return null;}
  }
  function dropPath(r,stretch){
    const k=.55228475,tail=r*(1+stretch*1.7),h=r*(1-stretch*.20);
    return "M "+(-tail)+" 0 C "+(-tail)+" "+(-h*k*(1-stretch*.7))+" "+(-r*k)+" "+(-h)+" 0 "+(-h)+
      " C "+(r*k)+" "+(-h)+" "+r+" "+(-h*k)+" "+r+" 0 C "+r+" "+(h*k)+" "+(r*k)+" "+h+" 0 "+h+
      " C "+(-r*k)+" "+h+" "+(-tail)+" "+(h*k*(1-stretch*.7))+" "+(-tail)+" 0 Z";
  }
  function watchSoft(s){
    try{getActor(s.browser)?.sendAsyncMessage("WatchSoft",{token:s.token,uri:s.uri,oldURI:s.oldURI});}catch{}
  }
  function syncGeometry(s,force=false){
    const r=s.browser.getBoundingClientRect();
    if(r.width<=20||r.height<=20)return false;
    if(!force&&Math.abs(r.width-s.w)<.5&&Math.abs(r.height-s.h)<.5&&Math.abs(r.left-s.left)<.5&&Math.abs(r.top-s.top)<.5)return true;
    s.from={x:clamp(s.from.x+s.left-r.left,0,r.width),y:clamp(s.from.y+s.top-r.top,0,r.height)};
    s.w=r.width;s.h=r.height;s.left=r.left;s.top=r.top;
    Object.assign(s.overlay.style,{left:r.left+"px",top:r.top+"px",width:r.width+"px",height:r.height+"px"});
    s.art.setAttribute("viewBox","0 0 "+s.w+" "+s.h);
    s.ring.setAttribute("cx",String(s.w/2));s.ring.setAttribute("cy",String(s.h/2));
    return true;
  }
  function sampleFrame(image,w,h){
    try{
      const c=newNode("canvas","");c.width=64;c.height=36;
      const ctx=c.getContext("2d",{willReadFrequently:true});
      ctx.drawImage(image,0,0,w,h,0,0,64,36);
      const data=ctx.getImageData(0,0,64,36).data;
      let opaque=0,detail=0,lo=255,hi=0;
      for(let i=0;i<data.length;i+=4){
        if(data[i+3]<180)continue;opaque++;
        const v=(data[i]+data[i+1]+data[i+2])/3;lo=Math.min(lo,v);hi=Math.max(hi,v);
        if(i%256!==0&&Math.abs(data[i]-data[i-4])+Math.abs(data[i+1]-data[i-3])+Math.abs(data[i+2]-data[i-2])>30)detail++;
      }
      return {data,opaque:opaque/2304,detail,range:hi-lo};
    }catch{return null;}
  }
  function changedFrame(old,next){
    if(!next||next.opaque<.4||next.range<7||next.detail<3)return false;
    if(!old)return false;
    let changed=0,strong=0;
    for(let i=0;i<next.data.length;i+=4){
      const delta=(Math.abs(next.data[i]-old.data[i])+Math.abs(next.data[i+1]-old.data[i+1])+Math.abs(next.data[i+2]-old.data[i+2]))/3;
      if(delta>14)changed++;if(delta>40)strong++;
    }
    // A handful of text/image pixels is enough. Do not require a complete
    // layout or a filled video player. Limit false positives from cursor noise.
    return changed>=18&&strong>=5;
  }
  function makeDynamicMask(rects){
    const mask=new Uint8Array(64*36);
    for(const [x0,y0,x1,y1] of rects){
      // One-cell padding also excludes changing anti-aliased media edges.
      const left=Math.max(0,Math.floor(x0*64)-1),right=Math.min(64,Math.ceil(x1*64)+1);
      const top=Math.max(0,Math.floor(y0*36)-1),bottom=Math.min(36,Math.ceil(y1*36)+1);
      for(let y=top;y<bottom;y++)for(let x=left;x<right;x++)mask[y*64+x]=1;
    }
    return mask;
  }
  function stableRoutePixels(old,previous,next,mask){
    if(!old||!previous||!next||next.opaque<.4||next.range<7||next.detail<3)return false;
    const delta=(a,b,i)=>(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/3;
    const lum=(a,i)=>(a[i]*.299+a[i+1]*.587+a[i+2]*.114);
    let changed=0,strong=0,edges=0;
    const a=old.data,b=previous.data,c=next.data;
    for(let y=0;y<36;y++)for(let x=0;x<64;x++){
      const k=y*64+x,i=k*4;
      if(mask?.[k]||a[i+3]<180||b[i+3]<180||c[i+3]<180)continue;
      const d1=delta(a,b,i),d2=delta(a,c,i);
      // A new pixel must differ from the outgoing frame AND survive a
      // second observation. A moving video or brightness pulse is insufficient.
      if(d1<14||d2<14||delta(b,c,i)>12)continue;
      changed++;if(Math.min(d1,d2)>40)strong++;
      for(const n of [x>0?k-1:-1,x<63?k+1:-1,y>0?k-64:-1,y<35?k+64:-1]){
        if(n<0||mask?.[n])continue;
        const j=n*4;
        const before=lum(a,i)-lum(a,j),after=lum(c,i)-lum(c,j),prior=lum(b,i)-lum(b,j);
        if(Math.abs(after-before)>22&&Math.abs(after-prior)<15){edges++;break;}
      }
    }
    // Small, persistent structural changes are sufficient; no complete
    // page, loaded image or full DOM fingerprint is required.
    return changed>=12&&strong>=4&&edges>=6;
  }
  function probeFirstFrame(s,time){
    if(active!==s||s.firstPaint!==null||s.probing||time<s.nextProbe||s.probeCount>=14)return;
    const b=s.browser,global=b.browsingContext?.currentWindowGlobal,uri=b.currentURI?.spec;
    if(!s.committed||!global?.drawSnapshot||!isWeb(uri))return;
    if(s.kind==="hard"&&(!s.oldGlobal||global===s.oldGlobal))return;
    if(s.kind==="soft"&&global!==s.global)return;
    if(stripHash(uri)!==stripHash(s.uri))return;
    s.probing=true;s.probeCount++;s.nextProbe=time+(s.kind==="soft"?100:190);
    const generation=s.probeGeneration;
    const scale=clamp(360/Math.max(s.w,s.h),.06,.4);
    try{
      global.drawSnapshot(null,scale,"transparent",{drawView:true}).then(bitmap=>{
        if(!bitmap)return;
        try{
          if(active!==s||s.firstPaint!==null||s.probeGeneration!==generation||b.browsingContext?.currentWindowGlobal!==global||b.currentURI?.spec!==uri)return;
          const sample=sampleFrame(bitmap,bitmap.width,bitmap.height);
          const soft=s.kind==="soft";
          const accepted=soft?stableRoutePixels(s.oldSample,s.probeSample,sample,s.dynamicMask):changedFrame(s.oldSample,sample);
          if(accepted){
            s.global=global;markPaint(s,soft?"stable new pixels outside dynamic areas":"first changed pixels");
          }else{
            if(soft)s.probeSample=sample;
            debug("first-frame probe: no confirmed visible change",s.probeCount);
          }
        }finally{bitmap.close?.();}
      },error=>debug("first-frame probe failed",String(error))).finally(()=>{s.probing=false;});
    }catch(error){s.probing=false;debug("first-frame probe failed",String(error));}
  }
  function resetPaint(s){
    s.firstPaint=null;s.visibleAt=null;s.paintReason=null;s.probeGeneration++;s.probeCount=0;s.probeSample=null;s.nextProbe=now();
    s.shield.style.opacity="1";
  }
  function render(s,time){
    const elapsed=Math.max(0,time-s.start),flight=clamp(elapsed/s.flightMs,0,1);
    const f=ease(flight),cx=s.w/2,cy=s.h/2;
    if(flight<1&&s.progress<1){
      const dx=cx-s.from.x,dy=cy-s.from.y,d=Math.hypot(dx,dy)||1;
      const bend=Math.min(25,d*.045)*Math.sin(Math.PI*f);
      const x=s.from.x+dx*f-dy/d*bend,y=s.from.y+dy*f+dx/d*bend;
      const r=lerp(6,23,f),stretch=Math.pow(Math.sin(Math.PI*flight),1.25)*.93;
      const grey=ease((flight-.66)/.34);
      const light=Math.round(lerp(222,128,grey)),dark=Math.round(lerp(168,99,grey));
      s.drop.setAttribute("d",dropPath(r,stretch));
      s.drop.setAttribute("transform","translate("+x+" "+y+") rotate("+(Math.atan2(dy,dx)*180/Math.PI)+")");
      s.light.setAttribute("stop-color","rgb("+light+","+light+","+light+")");
      s.dark.setAttribute("stop-color","rgb("+dark+","+dark+","+dark+")");
      return;
    }
    s.drop.setAttribute("opacity","0");
    // One radius drives all three clips. There is no conditional geometry
    // or upper-progress ceiling while loading.
    const p=clamp(s.progress,0,1);
    const radius=lerp(23,Math.hypot(cx,cy)+12,ease(p));
    s.radius=radius;
    s.cover.style.maskImage="radial-gradient(circle at 50% 50%, transparent "+Math.max(0,radius-.5)+"px, black "+(radius+.5)+"px)";
    s.shield.style.clipPath="circle("+radius.toFixed(3)+"px at 50% 50%)";
    s.ring.setAttribute("r",String(radius));
    s.ring.setAttribute("opacity",String(1-ease((p-.86)/.14)));
    if(s.dim)s.shade.style.opacity=String(.06*(1-ease((p-.8)/.2)));
    // The shield is dark, not a snapshot. It covers the outgoing document
    // inside the aperture until the new document emits its first update.
    // Once released, actual DOM/video/images remain live and keep loading.
    if(s.visibleAt!==null)s.shield.style.opacity=String(1-ease((time-s.visibleAt)/80));
    if(p>=1){s.ring.setAttribute("opacity","0");s.cover.style.opacity="0";}
  }
  function tick(s,time){
    if(active!==s)return;
    if(!enabled||motion.matches||s.browser!==gb.selectedBrowser)return finish(s,"context");
    if(time-s.lastGeometry>120){
      s.lastGeometry=time;
      if(!safeBrowser(s.browser)||!syncGeometry(s))return finish(s,"context");
    }
    const elapsed=Math.max(0,time-s.start);
    if(s.finalRendered)return finish(s,"complete");
    probeFirstFrame(s,time);
    if(elapsed>=s.flightMs){
      const dt=Math.max(0,time-Math.max(s.last,s.start+s.flightMs));
      // Independent animation clock: slow first paint can extend the
      // transition, but never stop it. No network-stop or ready-state gate.
      // Smoothly integrate speed; slow navigation still reaches 100% by 4s.
      const span=s.nominal-s.flightMs;
      const remaining=Math.max(1,s.timeout-elapsed-24);
      const minimum=(1-s.progress)*span/remaining;
      // Start at normal speed. Only a genuinely missing first frame after
      // the first 420ms slows the remaining motion. A committed page with
      // missing actor events does not crawl at a four-second default rate.
      const slow=s.committed?.48:Math.max(.15,span/Math.max(span,s.timeout-s.flightMs-24));
      const target=s.firstPaint!==null||elapsed<420?1:slow;
      const desired=Math.max(target,minimum);
      const decay=Math.exp(-dt/95),oldRate=s.rate??desired;
      s.rate=desired+(oldRate-desired)*decay;
      const step=(desired*dt+(oldRate-desired)*95*(1-decay))/span;
      // Enforce the minimum time even if a custom cap requires acceleration.
      const ceiling=clamp((elapsed-s.flightMs)/span,0,1);
      s.progress=Math.min(ceiling,Math.max(s.progress,s.progress+step));
      if(elapsed>=s.timeout-24)s.progress=1;
      // If first paint occurs mid-flight, release the dark layer as soon as
      // a visible aperture exists, rather than waiting for animation end.
      if(s.firstPaint!==null&&s.visibleAt===null)s.visibleAt=time;
    }
    s.last=time;
    render(s,time);
    if(s.progress>=1&&elapsed>=s.nominal)s.finalRendered=true;
    if(elapsed>=s.timeout)return finish(s,"deadline-frame");
    s.raf=window.requestAnimationFrame(t=>tick(s,t));
  }
  function markPaint(s,reason="paint"){
    if(active!==s||!s.committed||s.firstPaint!==null)return;
    s.firstPaint=now();s.paintReason=reason;
    if(s.firstPaint-s.start>=s.flightMs)s.visibleAt=s.firstPaint;
    debug("first destination frame",reason,Math.round(s.firstPaint-s.start)+"ms");
  }
  function finish(s,reason){
    if(active!==s)return;
    active=null;window.cancelAnimationFrame(s.raf);window.clearTimeout(s.timer);
    if(s.kind==="soft"){try{getActor(s.browser)?.sendAsyncMessage("CancelSoft");}catch{}}
    s.overlay.remove();
    lastResult={reason,elapsed:Math.round(now()-s.start),progress:Math.round(s.progress*1000)/1000,committed:s.committed,painted:s.firstPaint!==null,firstPaintMs:s.firstPaint===null?null:Math.round(s.firstPaint-s.start),paintReason:s.paintReason,probeCount:s.probeCount};
    debug("finish",lastResult);scheduleWarm(350);
  }
  function cancel(){
    if(active)finish(active,"cancel");clearOrigin();clearPending();
  }
  function history(){
    cancel();historyUntil=now()+1100;
  }
  function receive(b, global, message) {
    if (!safeBrowser(b)) return;
    if (message.name === "History") { history(); return; }
    if (message.name === "Warm") { acceptScene(b,global,message.data);warm(b); return; }
    if (message.name === "Paint") scheduleWarm(250);
    if (message.name === "Origin") {
      const d = message.data;
      if (![d.x, d.y, d.vw, d.vh].every(Number.isFinite) || d.vw <= 0 || d.vh <= 0) return;
      const r = b.getBoundingClientRect(), sx = r.width / d.vw, sy = r.height / d.vh;
      if (!d.navigation) return;
      historyUntil=0;
      const rect={x:r.left+d.x*sx,y:r.top+d.y*sy};
      recentPointer={browser:b,...rect,at:now()};
      const scene=acceptScene(b,global,d);
      if(active){
        if(scene&&active.kind==="soft"&&active.browser===b&&stripHash(scene.uri)===stripHash(active.oldURI)&&active.firstPaint===null){
          active.dynamicMask=makeDynamicMask([...(active.sourceScene?.dynamic||[]),...scene.dynamic]);active.sourceScene=scene;
          active.probeSample=null;active.probeGeneration++;active.nextProbe=now();
        }
        return;
      }
      const sourceURI=typeof d.uri==="string"?d.uri:locations.get(b);
      if(!sourceURI)return;
      remember(b,rect,d.pixels||null,sourceURI);
      if(pending?.browser===b && now()-pending.at<180 && !active){
        const p=pending;
        const st=begin(b,p.kind,p.uri);
        if(st&&p.committed){st.committed=true;st.commitAt=now();st.global=b.browsingContext?.currentWindowGlobal;
          if(st.kind==="hard"&&st.global&&st.global!==st.oldGlobal&&painted.has(st.global))markPaint(st,"buffered paint");}
      }
      return;
    }
    if (message.name === "Paint") painted.add(global);
    const s = active;
    if (!s || s.browser !== b || !s.committed) return;
    if(message.name==="SoftPaint"&&s.kind==="soft"&&message.data.token===s.token&&global===s.global&&
       message.data.evidence==="route-content"&&stripHash(message.data.oldURI)===stripHash(s.oldURI)&&
       stripHash(message.data.uri)===stripHash(s.uri))markPaint(s,message.data.reason||"SPA visible content");
    if(message.name==="SoftBaselineMissing"&&s.kind==="soft"&&message.data.token===s.token&&global===s.global)
      debug("SPA baseline unavailable; using stable visual fallback");
    if(message.name==="Paint"&&s.kind==="hard"&&global===b.browsingContext?.currentWindowGlobal&&
       global!==s.oldGlobal&&stripHash(b.currentURI?.spec)===stripHash(s.uri)){
      s.global=global;markPaint(s,"new document paint");
    }
  }
  function requestURL(request, b) {
    try { return request.QueryInterface(Ci.nsIChannel).URI.spec; } catch { return b.currentURI?.spec; }
  }
  const listener = {
    onStateChange(b, wp, request, flags, status) {
      if (!wp?.isTopLevel || !(flags & P.STATE_IS_NETWORK) || b !== gb.selectedBrowser) return;
      if (flags & P.STATE_START) {
        if (!safeBrowser(b)) return;
        const uri = requestURL(request, b);
        if(active?.browser===b&&active.kind==="hard"){debug("additional network start");return;}
        pending={browser:b,kind:"hard",uri,previous:locations.get(b),at:now(),committed:false};
        if(!begin(b,"hard",uri)){
          window.clearTimeout(pendingTimer);pendingTimer=window.setTimeout(clearPending,180);
        }
      } else if (flags & P.STATE_STOP) {
        scheduleWarm(250);
        if (active?.browser !== b || active.kind !== "hard") return;
        // Network completion only triggers an early visual probe, not a
        // declaration of readiness or a completion condition.
        active.nextProbe=now();
      }
    },
    onLocationChange(b, wp, request, location, flags) {
      if (!wp?.isTopLevel) return;
      const uri = location?.spec || "";
      const previous = locations.get(b);
      locations.set(b, uri);
      if (b !== gb.selectedBrowser) return;
      if (!isWeb(uri) || flags & P.LOCATION_CHANGE_ERROR_PAGE) { cancel();clearCache();return; }
      const same = !!(flags & P.LOCATION_CHANGE_SAME_DOCUMENT);
      if (same) {
        if (previous && stripHash(previous) === stripHash(uri)) return;
        if(active?.browser===b){
          if(active.uri!==uri){active.uri=uri;if(active.kind==="soft"){resetPaint(active);watchSoft(active);}}
          return;
        }
        if(on("soft")){
          pending={browser:b,kind:"soft",uri,previous,at:now(),committed:true};
          if(!begin(b,"soft",uri)){
            window.clearTimeout(pendingTimer);pendingTimer=window.setTimeout(clearPending,180);
            scheduleWarm(350);
          }
        }
      } else if (active?.browser === b && active.kind === "hard") {
        active.committed = true;
        active.commitAt=active.commitAt??now();
        const next=b.browsingContext?.currentWindowGlobal;
        if(next!==active.global&&active.global){resetPaint(active);}
        active.global=next;
        active.uri=uri;
        if(active.global&&active.global!==active.oldGlobal&&painted.has(active.global))markPaint(active,"buffered paint");
      } else if (origin?.browser === b || (cached?.browser===b&&cached.uri===previous)) {
        pending={browser:b,kind:"hard",uri,previous,at:now(),committed:true};
        const s = begin(b, "hard", uri);
        if (s) {
          s.committed = true; s.commitAt=now();s.global = b.browsingContext?.currentWindowGlobal;
          if(s.global&&s.global!==s.oldGlobal&&painted.has(s.global))markPaint(s,"buffered paint");
        }else{window.clearTimeout(pendingTimer);pendingTimer=window.setTimeout(clearPending,180);}
      }
      if(!active)scheduleWarm(350);
    },

  };
  function chromePointer(event){
    if([3,4].includes(event.button)){history();return;}
    if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    if(event.target?.closest?.("#back-button,#forward-button,[command='Browser:Back'],[command='Browser:Forward']")){
      history();return;
    }
    const b=gb.selectedBrowser;
    const r=b?.getBoundingClientRect();
    if(r&&event.clientX>=r.left&&event.clientX<=r.left+r.width&&event.clientY>=r.top&&event.clientY<=r.top+r.height){
      recentPointer={browser:b,x:event.clientX,y:event.clientY,at:now()};
      if(!active)warm(b,true);
    }
    const el=event.target?.closest?.("toolbarbutton.bookmark-item,#urlbar,#reload-button");
    if(!el||!on("chrome"))return;
    historyUntil=0;
    remember(gb.selectedBrowser,{x:event.clientX,y:event.clientY});
  }
  function command(event){
    if(/^(Browser:(Back|Forward)|cmd_(back|forward))$/i.test(event.target?.id||"")||
       /^(Browser:(Back|Forward)|cmd_(back|forward))$/i.test(event.target?.getAttribute?.("command")||""))history();
  }
  function key(event){
    if(event.key==="Escape"){cancel();return;}
    if((event.altKey&&["ArrowLeft","ArrowRight"].includes(event.key))||
       ["BrowserBack","BrowserForward","GoBack","GoForward"].includes(event.key)){history();return;}
    if(event.key==="Enter"&&on("chrome")&&event.target?.closest?.("#urlbar")){
      const r=document.getElementById("urlbar")?.getBoundingClientRect();
      if(r){
        historyUntil=0;
        // Preserve an existing pre-command snapshot from the address-bar click.
        if(origin?.browser===gb.selectedBrowser&&(origin.bitmap||origin.pixels))origin.at=now();
        else remember(gb.selectedBrowser,{x:r.x+r.width/2,y:r.y+r.height/2});
      }
    }
  }
  function move(event){
    const b=gb.selectedBrowser;if(!safeBrowser(b)||active)return;
    const r=b.getBoundingClientRect();
    if(event.clientX<r.left||event.clientX>r.left+r.width||event.clientY<r.top||event.clientY>r.top+r.height)return;
    recentPointer={browser:b,x:event.clientX,y:event.clientY,at:now()};warm(b);
  }
  function tabChange(){cancel();clearCache();recentPointer=null;scheduleWarm(250);}
  function settings() {
    enabled = on("enabled", false);
    if (!enabled || motion.matches || !on("snapshot")) {
      cancel();clearCache();
      releaseActor?.(); releaseActor = null;
    } else if (!releaseActor) {
      try { releaseActor = ChromeUtils.importESModule(ACTOR_URI).acquireTransitionActor();log("actor registered"); }
      catch (error) { console.warn("[Zen Refined transitions] actor unavailable; using navigation fallback", error); }
    }
    log("settings", {enabled, snapshot:on("snapshot"), reducedMotion:motion.matches});
    if(enabled&&on("snapshot"))scheduleWarm(200);
  }
  const tabEvents = ["TabSelect"];
  const windowEvents = [["pointerdown", chromePointer, true], ["pointermove",move,true], ["keydown", key, true], ["command",command,true],
    ["beforecustomization", cancel, false],
    ["fullscreen", cancel, false]];
  function destroy() {
    if (dead) return;
    dead = true;
    cancel();clearCache();
    try { gb.removeTabsProgressListener(listener); } catch {}
    for (const type of tabEvents) gb.tabContainer.removeEventListener(type, tabChange);
    for (const [type, callback, capture] of windowEvents) window.removeEventListener(type, callback, capture);
    try { prefs.removeObserver(PREFIX, settings); } catch {}
    motion.removeEventListener("change", settings);
    try { releaseActor?.(); } catch {}
    releaseActor = null;
  }
  try {
    window[KEY].receive = receive;
    window[KEY].diagnostics=()=>({enabled,snapshot:on("snapshot"),reducedMotion:motion.matches,actorRegistered:!!releaseActor,cacheReady:!!cached,cacheAge:cached?Math.round(now()-cached.at):null,active:!!active,pending:!!pending,version:"0.3.0-preview.5",destinationReady:active?.firstPaint!=null,revealing:active?.progress>0,shieldVisible:active?active.visibleAt===null:null,progress:active?.progress??null,radius:active?.radius??null,firstPaintReason:active?.paintReason??null,probeCount:active?.probeCount??null,lastResult});
    gb.addTabsProgressListener(listener);
    for (const type of tabEvents) gb.tabContainer.addEventListener(type, tabChange);
    for (const [type, callback, capture] of windowEvents) window.addEventListener(type, callback, capture);
    prefs.addObserver(PREFIX, settings);
    motion.addEventListener("change", settings);
    settings();
  } catch (error) { destroy(); throw error; }
  return destroy;
}
function cleanup() {
  if (disposed) return;
  disposed = true;
  if (startup) { Services.obs.removeObserver(startup, "browser-delayed-startup-finished"); startup = null; }
  teardown?.(); teardown = null;
  window.removeEventListener("unload", cleanup);
  if (window[KEY]?.cleanup === cleanup) delete window[KEY];
}
function start() {
  if (disposed || window.closed) return;
  try { teardown = install(); }
  catch (error) { console.warn("[Zen Refined transitions] startup failed", error); cleanup(); }
}
if (!root.hasAttribute("popup-window") && typeof window.addUnloadListener === "function") {
  window[KEY]?.cleanup?.();
  window[KEY] = { cleanup, receive: null };
  window.addUnloadListener(cleanup);
  window.addEventListener("unload", cleanup, { once: true });
  if (window.gBrowserInit?.delayedStartupFinished) start();
  else {
    startup = subject => {
      if (subject !== window) return;
      Services.obs.removeObserver(startup, "browser-delayed-startup-finished");
      startup = null;
      start();
    };
    Services.obs.addObserver(startup, "browser-delayed-startup-finished");
  }
}
