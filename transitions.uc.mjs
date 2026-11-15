/* Zen Refined — Adaptive Page Transitions
 * Native navigation always proceeds normally. All pixels are ephemeral, in memory.
 * No interception of requests, content injection, disk writes, or viewport resize.
 */
const PREFIX = "zen.refined.transitions.";
const KEY = "__zenRefinedPageTransitions";
const NS = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const ACTOR = "ZenRefinedCompositorReveal";
const ACTOR_URI = "chrome://sine/content/9d788b55-d497-41da-8444-993c603e89e4/actors/ZenRefinedCompositorRevealParent.sys.mjs";
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
  const log = (...args) => console.info('[Zen Refined transitions 0.4.0-preview.1]', ...args);
  const locations = new WeakMap();
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
        cached={browser:b,uri,global,frame,id:documentId(global),at:now()};
        debug("warm: cached outgoing viewport",frame.width,frame.height);
      },error=>debug("warm: drawSnapshot rejected",String(error))).finally(()=>{
        warming=false;
        if(cacheEpoch!==epoch)scheduleWarm();
      });
    }catch(error){warming=false;debug("warm: failed",String(error));}
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
  function remember(b,rect,pixels=null,sourceURI=b.currentURI?.spec,sourceGlobal=b.browsingContext?.currentWindowGlobal) {
    if(!safeBrowser(b) || !on("snapshot"))return;
    if(active)finish(active,"interaction");
    clearOrigin();
    origin={browser:b,rect,at:now(),bitmap:null,pixels,expired:false,global:sourceGlobal,id:documentId(sourceGlobal),uri:sourceURI};
    // Late input IPC must never capture the destination as the outgoing page.
    if(!pixels&&sourceGlobal===b.browsingContext?.currentWindowGlobal&&sourceURI===b.currentURI?.spec&&(cached?.browser!==b||cached.uri!==sourceURI))capture(b,origin);
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
    if(!source && oldCache)source={browser:b,rect:pointer(b),bitmap:null,pixels:null,global:oldCache.global,id:oldCache.id,uri:oldCache.uri};
    if(!source){debug("skip: no origin or cached frame");return null;}
    window.clearTimeout(originTimer);originTimer=0;origin=null;
    const oldGlobal=oldCache?.global||source.global;
    const oldId=oldCache?.id||source.id||documentId(oldGlobal);
    let backdrop=oldCache?.frame||drawSource(source,bounds);
    if(backdrop&&Math.abs((backdrop.width/backdrop.height)/(bounds.width/bounds.height)-1)>.12)backdrop=null;
    source.expired=true;source.bitmap?.close?.();source.bitmap=null;source.pixels=null;
    if(!backdrop||oldId===null){debug("skip: no verified outgoing frame");return null;}
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
      from:point(bounds,source.rect),oldGlobal,oldId,oldURI,global:kind==="soft"?oldGlobal:null,
      committed:kind==="soft",commitAt:kind==="soft"?start:null,documentCommitAt:null,
      watchedGlobal:null,watchAt:-Infinity,evidence:null,firstPaint:null,paintReason:null,visibleAt:null,
      progress:0,flightMs:260,plan:null,fallbackAt:null,fallbackReason:null,unsupported:false,
      raf:0,timer:0,lastGeometry:start,dim:on("dim"),radius:0,networkDataAt:null,networkStopAt:null,
      paintState:null,trace:[],finalRendered:false};
    active=st;
    try{
      // Leave the remote browser entirely untouched. Only the static cover
      // and the small dark shield are clipped. The live compositor is free
      // to paint underneath, including accelerated video.
      root.append(overlay);syncGeometry(st,true);
      if(st.dim)shade.style.opacity=".06";
      render(st,start);
      st.timer=window.setTimeout(()=>{
        if(active!==st)return;finish(st,st.plan&&st.progress>=.99?"complete":"deadline-watchdog");
      },st.timeout);
      st.raf=window.requestAnimationFrame(t=>tick(st,t));
      debug("start",kind,"live browser untouched");
      if(kind==="soft")watchSoft(st);else syncDocument(st,start);
      return st;
    }catch(error){finish(st,"setup-error");console.warn("[Zen Refined transitions]",error);return null;}
  }
  function dropPath(r,stretch){
    const k=.55228475,tail=r*(1+stretch*1.7),h=r*(1-stretch*.20);
    return "M "+(-tail)+" 0 C "+(-tail)+" "+(-h*k*(1-stretch*.7))+" "+(-r*k)+" "+(-h)+" 0 "+(-h)+
      " C "+(r*k)+" "+(-h)+" "+r+" "+(-h*k)+" "+r+" 0 C "+r+" "+(h*k)+" "+(r*k)+" "+h+" 0 "+h+
      " C "+(-r*k)+" "+h+" "+(-tail)+" "+(h*k*(1-stretch*.7))+" "+(-tail)+" 0 Z";
  }
  function trace(s,event,data={}){
    if(s.trace.length>=32)s.trace.shift();
    s.trace.push({ms:Math.round(now()-s.start),event,...data});debug(event,data);
  }
  function documentId(g){
    try{const id=g?.innerWindowId;return typeof id==="number"&&Number.isFinite(id)&&id>0?String(id):typeof id==="bigint"&&id>0n?String(id):null;}catch{return null;}
  }
  function watchSoft(s){
    const g=s.browser.browsingContext?.currentWindowGlobal;
    if(documentId(g)!==s.oldId){s.unsupported=true;return;}
    s.watchedGlobal=g;s.watchAt=now();
    try{g.getActor(ACTOR).sendAsyncMessage("Watch",{token:s.token,kind:"soft",uri:s.uri,oldURI:s.oldURI});}
    catch{trace(s,"soft-watch-unavailable");}
  }
  function cancelWatch(s){
    if(!s.watchedGlobal)return;
    try{s.watchedGlobal.getActor(ACTOR).sendAsyncMessage("Cancel",{token:s.token});}catch{}
    s.watchedGlobal=null;
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
  function newDocument(s,g){
    const id=documentId(g);
    if(s.kind!=="hard"||!id||id===s.oldId)return false;
    try{
      if(g.isInitialDocument===true||g.isUncommittedInitialDocument===true||g.isClosed===true||g.isCurrentGlobal===false)return false;
      const uri=g.documentURI?.spec;
      return isWeb(uri)&&(stripHash(uri)===stripHash(s.uri)||
        (s.committed&&stripHash(uri)===stripHash(s.browser.currentURI?.spec)));
    }catch{return false;}
  }
  function markReady(s,evidence){
    if(active!==s||s.firstPaint!==null||s.fallbackAt!==null)return;
    s.firstPaint=now();s.paintReason=evidence.reason;s.evidence=evidence;
    trace(s,"frame-confirmed",{reason:evidence.reason,transaction:evidence.transaction??null});
  }
  function syncDocument(s,time){
    if(active!==s||s.kind!=="hard")return;
    const g=s.browser.browsingContext?.currentWindowGlobal;
    if(!newDocument(s,g))return;
    if(documentId(s.global)!==documentId(g)){
      if(s.firstPaint!==null){startFallback(s,time,"redirect-during-reveal");return;}
      cancelWatch(s);s.global=g;s.documentCommitAt=time;s.evidence=null;
      trace(s,"document-committed",{id:documentId(g)});
    }
    s.committed=true;s.commitAt??=time;s.uri=g.documentURI.spec;
    if(s.evidence){if(s.browser.hasLayers!==false)markReady(s,s.evidence);return;}
    if(s.firstPaint!==null||s.fallbackAt!==null)return;
    if(s.watchedGlobal!==g||time-s.watchAt>=200){
      s.watchedGlobal=g;s.watchAt=time;
      try{g.getActor(ACTOR).sendAsyncMessage("Watch",{token:s.token,kind:"hard",uri:s.uri});}
      catch{trace(s,"hard-watch-unavailable");}
    }
  }
  function pendingProgress(s,time){
    return .24*clamp((time-s.start-s.flightMs)/Math.max(1,s.timeout-s.flightMs),0,1);
  }
  function startFallback(s,time,reason){
    if(s.fallbackAt!==null)return;
    s.fallbackAt=time;s.fallbackReason=reason;cancelWatch(s);trace(s,"native-fallback",{reason});
  }
  function planReveal(s,time){
    if(s.plan||s.firstPaint===null||s.fallbackAt!==null)return;
    const start=Math.max(s.start+s.flightMs,s.firstPaint);
    const from=pendingProgress(s,start);
    const end=Math.min(s.start+s.timeout,Math.max(s.start+s.nominal,start+540*(1-from)));
    if(end-start<140){startFallback(s,time,"insufficient-reveal-time");return;}
    const duration=end-start;
    s.plan={start,end,from,tangent:Math.min(1-from,.24/Math.max(1,s.timeout-s.flightMs)*duration)};
    s.visibleAt=start;
  }
  function revealProgress(plan,time){
    const t=clamp((time-plan.start)/(plan.end-plan.start),0,1),t2=t*t,t3=t2*t;
    return clamp((2*t3-3*t2+1)*plan.from+(t3-2*t2+t)*plan.tangent+(-2*t3+3*t2),plan.from,1);
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
    if(s.visibleAt!==null)s.shield.style.opacity=String(1-ease((time-s.visibleAt)/65));
    if(p>=1){s.ring.setAttribute("opacity","0");s.cover.style.opacity="0";}
  }
  function tick(s,time){
    if(active!==s)return;
    if(!enabled||motion.matches||s.browser!==gb.selectedBrowser)return finish(s,"context");
    if(time-s.lastGeometry>120){
      s.lastGeometry=time;
      if(!safeBrowser(s.browser)||!syncGeometry(s))return finish(s,"context");
    }
    if(s.finalRendered)return finish(s,"complete");
    const elapsed=Math.max(0,time-s.start);
    if(s.fallbackAt===null){
      if(s.kind==="hard")syncDocument(s,time);
      else if(s.evidence&&s.browser.hasLayers!==false)markReady(s,s.evidence);
      else if(s.firstPaint===null&&time-s.watchAt>=250&&!s.unsupported)watchSoft(s);
      if(s.firstPaint!==null)planReveal(s,time);
      if(s.unsupported&&elapsed>=s.flightMs)startFallback(s,time,"unconfirmed-spa");
      else if(s.firstPaint===null&&elapsed>=s.timeout-140)startFallback(s,time,"no-confirmed-frame");
    }
    if(s.fallbackAt!==null){
      const fade=clamp((time-s.fallbackAt)/120,0,1);
      s.overlay.style.opacity=String(1-ease(fade));
      if(fade>=1||elapsed>=s.timeout)return finish(s,s.fallbackReason);
    }else if(elapsed>=s.flightMs){
      s.progress=Math.max(s.progress,s.plan?revealProgress(s.plan,time):pendingProgress(s,time));
    }
    render(s,time);
    if(s.plan&&s.progress>=1)s.finalRendered=true;
    if(elapsed>=s.timeout)return finish(s,s.progress>=1?"complete":"deadline-frame");
    s.raf=window.requestAnimationFrame(t=>tick(s,t));
  }
  function finish(s,reason){
    if(active!==s)return;
    active=null;window.cancelAnimationFrame(s.raf);window.clearTimeout(s.timer);cancelWatch(s);
    s.overlay.remove();
    lastResult={kind:s.kind,reason,elapsed:Math.round(now()-s.start),progress:Math.round(s.progress*1000)/1000,
      committed:s.committed,painted:s.firstPaint!==null,firstPaintMs:s.firstPaint===null?null:Math.round(s.firstPaint-s.start),
      paintReason:s.paintReason,documentCommitMs:s.documentCommitAt===null?null:Math.round(s.documentCommitAt-s.start),
      networkDataMs:s.networkDataAt===null?null:Math.round(s.networkDataAt-s.start),
      networkStopMs:s.networkStopAt===null?null:Math.round(s.networkStopAt-s.start),paintState:s.paintState,trace:s.trace};
    debug("finish",lastResult);scheduleWarm(350);
  }
  function cancel(){
    if(active)finish(active,"cancel");clearOrigin();clearPending();
  }
  function history(){
    cancel();historyUntil=now()+1100;
  }
  function receive(b,global,message){
    if(!safeBrowser(b))return;
    const data=message.data||{};
    if(message.name==="History"){history();return;}
    if(message.name==="Warm"){warm(b);return;}
    if(message.name==="Origin"){
      const d=data;
      if(![d.x,d.y,d.vw,d.vh].every(Number.isFinite)||d.vw<=0||d.vh<=0||!d.navigation)return;
      const r=b.getBoundingClientRect(),rect={x:r.left+d.x*r.width/d.vw,y:r.top+d.y*r.height/d.vh};
      historyUntil=0;recentPointer={browser:b,...rect,at:now()};
      if(active)return;
      if(typeof d.uri!=="string")return;
      remember(b,rect,null,d.uri,global);
      if(pending?.browser===b&&now()-pending.at<180){
        const p=pending,st=begin(b,p.kind,p.uri);
        if(st&&p.committed){st.committed=true;st.commitAt=now();if(st.kind==="hard")syncDocument(st,now());}
      }
      return;
    }
    const s=active;
    if(!s||s.browser!==b||data.token!==s.token||s.fallbackAt!==null)return;
    if(documentId(global)!==documentId(b.browsingContext?.currentWindowGlobal))return;
    if(stripHash(data.uri)!==stripHash(s.uri))return;
    if(s.kind==="hard"){
      if(!newDocument(s,global))return;
      syncDocument(s,now());
      if(documentId(s.global)!==documentId(global))return;
    }else if(documentId(global)!==s.oldId||stripHash(data.oldURI)!==stripHash(s.oldURI))return;
    if(message.name==="PaintState"){
      s.paintState={suppressed:data.suppressed??null,fcp:!!data.fcp,pending:data.pending??null,transaction:data.transaction??null};
      trace(s,"paint-state",s.paintState);return;
    }
    if(message.name==="Unsupported"&&s.kind==="soft"){s.unsupported=true;trace(s,"spa-unconfirmed",{reason:data.reason});return;}
    if(message.name!=="FrameReady"||data.suppressed!==false)return;
    const allowed=s.kind==="hard"?["contentful-composite","contentful-after-paint","contentful-drained"]:["route-after-paint"];
    if(!allowed.includes(data.reason))return;
    if(s.kind==="soft"&&data.routeReplaced!==true)return;
    s.evidence={reason:data.reason,transaction:data.transaction??null};
    if(s.browser.hasLayers!==false)markReady(s,s.evidence);
  }
  function requestURL(request, b) {
    try { return request.QueryInterface(Ci.nsIChannel).URI.spec; } catch { return b.currentURI?.spec; }
  }
  const listener = {
    onStateChange(b, wp, request, flags, status) {
      if(!wp?.isTopLevel||b!==gb.selectedBrowser)return;
      if(active?.browser===b&&(flags&P.STATE_TRANSFERRING)&&(flags&P.STATE_IS_DOCUMENT))active.networkDataAt??=now();
      if(!(flags&P.STATE_IS_NETWORK))return;
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
        active.networkStopAt??=now();syncDocument(active,now());
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
          if(active.uri!==uri){active.uri=uri;if(active.kind==="soft"){if(active.firstPaint!==null)startFallback(active,now(),"route-changed-during-reveal");else{cancelWatch(active);active.evidence=null;active.unsupported=false;watchSoft(active);}}}
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
        active.uri=uri;
        syncDocument(active,now());
      } else if (origin?.browser === b || (cached?.browser===b&&cached.uri===previous)) {
        pending={browser:b,kind:"hard",uri,previous,at:now(),committed:true};
        const s = begin(b, "hard", uri);
        if (s) {
          s.committed = true; s.commitAt=now();
          syncDocument(s,now());
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
    window[KEY].diagnostics=()=>({enabled,snapshot:on("snapshot"),reducedMotion:motion.matches,actorRegistered:!!releaseActor,cacheReady:!!cached,cacheAge:cached?Math.round(now()-cached.at):null,active:!!active,pending:!!pending,version:"0.4.0-preview.1",navigationKind:active?.kind??null,documentCommitted:active?.documentCommitAt!=null,destinationReady:active?.firstPaint!=null,revealing:!!active?.plan,shieldVisible:active?active.visibleAt===null:null,progress:active?.progress??null,radius:active?.radius??null,paintState:active?.paintState??null,trace:active?.trace??null,lastResult});
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
