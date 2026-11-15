/* Zen Refined — Adaptive Page Transitions
 * Native navigation always proceeds normally. All pixels are ephemeral, in memory.
 * No interception of requests, content injection, disk writes, or viewport resize.
 */
const PREFIX = "zen.refined.transitions.";
const KEY = "__zenRefinedPageTransitions";
const NS = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const ACTOR = "ZenRefinedVerifiedTransition";
const ACTOR_URI = "chrome://sine/content/9d788b55-d497-41da-8444-993c603e89e4/actors/ZenRefinedVerifiedTransitionParent.sys.mjs";
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
  let recentPointer = null, pending = null, pendingTimer = 0;
  const log = (...args) => console.info('[Zen Refined transitions 0.2.0-preview.5]', ...args);
  const painted = new WeakSet();
  const locations = new WeakMap();
  for (const b of gb.browsers) locations.set(b, b.currentURI?.spec || "");
  const debug = (...args) => { if (prefs.getBoolPref(PREFIX + "debug", false)) console.debug("[Zen Refined transitions]", ...args); };
  const on = (key, fallback = true) => prefs.getBoolPref(PREFIX + key, fallback);
  const maxTime = () => clamp(prefs.getIntPref(PREFIX + "timeout", 4000), 1000, 4000);
  const now = () => window.performance.now();
  function safeBrowser(b) {
    return enabled && !motion.matches && b === gb.selectedBrowser &&
      !root.hasAttribute("inDOMFullscreen") && !root.hasAttribute("customizing") &&
      !window.document.fullscreenElement && !gb.selectedTab?.hasAttribute("splitview") &&
      !gb.selectedTab?.hasAttribute("zen-split-view") && b.getBoundingClientRect().width > 20;
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
    if(!safeBrowser(b)||!on("snapshot")||active||pending||warming||!isWeb(b.currentURI?.spec))return;
    if(now()-lastWarm<(force?350:1000))return;
    const bounds=b.getBoundingClientRect(), global=b.browsingContext?.currentWindowGlobal, uri=b.currentURI.spec;
    if(!global?.drawSnapshot){debug("warm: drawSnapshot unavailable");return;}
    const scale=clamp(1900/Math.max(bounds.width,bounds.height),.12,1), epoch=cacheEpoch;
    warming=true;lastWarm=now();
    try {
      global.drawSnapshot(null,scale,"transparent",{drawView:true}).then(bitmap=>{
        if(!bitmap)return;
        if(dead||!enabled||cacheEpoch!==epoch||active||pending||b!==gb.selectedBrowser||
          b.browsingContext?.currentWindowGlobal!==global||b.currentURI?.spec!==uri){
          bitmap.close?.();return;
        }
        cached?.bitmap?.close?.();
        cached={browser:b,uri,global,bitmap,at:now()};
        debug("warm: cached outgoing viewport",bitmap.width,bitmap.height);
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
  function fingerprint(image,width,height){
    try{
      const canvas=document.createElementNS(NS,"canvas");canvas.width=32;canvas.height=18;
      const c=canvas.getContext("2d",{willReadFrequently:true});
      c.drawImage(image,0,0,width,height,0,0,32,18);
      const data=c.getImageData(0,0,32,18).data;
      let count=0,detail=0,centerLight=0,centerCount=0;
      const rgb=new Uint8Array(32*18*3);
      for(let y=0;y<18;y++)for(let x=0;x<32;x++){
        const i=y*32+x,j=i*4,k=i*3;
        if(data[j+3]>=220)count++;
        rgb[k]=data[j];rgb[k+1]=data[j+1];rgb[k+2]=data[j+2];
        if(x>0){const p=k-3;if(Math.abs(rgb[k]-rgb[p])+Math.abs(rgb[k+1]-rgb[p+1])+Math.abs(rgb[k+2]-rgb[p+2])>45)detail++;}
        if(x>=3&&x<=20&&y>=3&&y<=13){centerCount++;if(Math.max(rgb[k],rgb[k+1],rgb[k+2])>25)centerLight++;}
      }
      return {rgb,opaque:count/576,detail:detail/576,center: centerLight/centerCount};
    }catch{return null;}
  }
  function difference(a,b){
    if(!a||!b)return 0;
    let sum=0,changed=0;
    for(let i=0;i<a.rgb.length;i+=3){
      const delta=(Math.abs(a.rgb[i]-b.rgb[i])+Math.abs(a.rgb[i+1]-b.rgb[i+1])+Math.abs(a.rgb[i+2]-b.rgb[i+2]))/3;
      sum+=delta;if(delta>18)changed++;
    }
    return {mean:sum/576,changed:changed/576};
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
  function remember(b,rect,pixels=null) {
    if(!safeBrowser(b) || !on("snapshot"))return;
    if(active)finish(active,"interaction");
    clearOrigin();
    origin={browser:b,rect,at:now(),bitmap:null,pixels,expired:false};
    if(!pixels && cached?.browser!==b)capture(b,origin);
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
    let source=origin?.browser===b && now()-origin.at<1400 ? origin:null;
    // No guessed pointer and no free-floating loading animation. History,
    // redirects without user intent, and failed captures remain native.
    const oldURI=pending?.previous||locations.get(b)||b.currentURI?.spec;
    const oldCache=cached?.browser===b && cached.uri===oldURI && now()-cached.at<120000 ? cached:null;
    if(!source && oldCache)source={browser:b,rect:pointer(b),bitmap:null,pixels:null};
    if(!source){debug("skip: no origin or cached frame");return null;}
    window.clearTimeout(originTimer);originTimer=0;origin=null;
    let backdrop=drawSource(source,bounds);
    if(!backdrop && oldCache)backdrop=drawSource({bitmap:oldCache.bitmap},bounds);
    source.expired=true;source.bitmap?.close?.();source.bitmap=null;source.pixels=null;
    if(!backdrop){debug("skip: no valid outgoing snapshot");return null;}
    clearPending();
    clearCache();
    const overlay=newNode("div","zr-page-transition"),shade=newNode("div","zr-page-transition-shade");
    const art=svg("svg",{class:"zr-page-transition-art",viewBox:"0 0 "+bounds.width+" "+bounds.height});
    const defs=svg("defs"),gradient=svg("linearGradient",{id:"zr-morph-drop-fill",x1:"0",y1:"0",x2:"0",y2:"1"});
    const light=svg("stop",{offset:"0%","stop-color":"#dedede"}),dark=svg("stop",{offset:"100%","stop-color":"#a8a8a8"});
    gradient.append(light,dark);defs.append(gradient);
    const ring=svg("circle",{cx:bounds.width/2,cy:bounds.height/2,r:23,fill:"none",stroke:"#888","stroke-width":"1.5",opacity:"0"});
    const fill=svg("circle",{cx:bounds.width/2,cy:bounds.height/2,r:23,fill:"#737373",opacity:"0"});
    const drop=svg("path",{fill:"url(#zr-morph-drop-fill)",stroke:"#969696","stroke-width":"1.25"});
    art.append(defs,fill,ring,drop);overlay.append(backdrop,shade,art);
    Object.assign(overlay.style,{left:bounds.left+"px",top:bounds.top+"px",width:bounds.width+"px",height:bounds.height+"px"});
    const start=now(),nominal=1000;
    const s={token:++serial,browser:b,kind,uri,start,timeout:maxTime(),nominal,
      w:bounds.width,h:bounds.height,left:bounds.left,top:bounds.top,overlay,backdrop,shade,art,drop,ring,fill,light,dark,
      from:point(bounds,source.rect),committed:kind==="soft",global:kind==="soft"?b.browsingContext?.currentWindowGlobal:null,
      oldGlobal:oldCache?.global||b.browsingContext?.currentWindowGlobal,readyAt:null,raf:0,timer:0,lastGeometry:start,
      oldFingerprint:fingerprint(backdrop,backdrop.width,backdrop.height), signal:false, probing:false, nextProbe:start+120, confirmed:0,
      revealStart:null,revealDuration:0,revealRadius:23,forced:false,flightMs:320,dim:on("dim"),youtube:/^https?:\/\/(?:[^/]+\.)?youtube\.com\//i.test(uri)};
    active=s;
    try {
      root.append(overlay);
      if(s.dim)backdrop.style.filter="brightness(.94)";
      render(s,start);
      s.timer=window.setTimeout(()=>finish(s,"timeout"),s.timeout);
      s.raf=window.requestAnimationFrame(t=>tick(s,t));
      debug("start",kind,"validated snapshot");
      if(kind==="soft"){
        const actor=getActor(b);
        try{actor?.sendAsyncMessage("WatchSoft",{token:s.token});}catch{}
        // The actor provides a hint, never a timer-based declaration of readiness.
      }
      return s;
    }catch(error){finish(s,"setup-error");console.warn("[Zen Refined transitions]",error);return null;}
  }
  function dropPath(r,stretch){
    const k=.55228475,tail=r*(1+stretch*1.7),h=r*(1-stretch*.20);
    return "M "+(-tail)+" 0 C "+(-tail)+" "+(-h*k*(1-stretch*.7))+" "+(-r*k)+" "+(-h)+" 0 "+(-h)+
      " C "+(r*k)+" "+(-h)+" "+r+" "+(-h*k)+" "+r+" 0 C "+r+" "+(h*k)+" "+(r*k)+" "+h+" 0 "+h+
      " C "+(-r*k)+" "+h+" "+(-tail)+" "+(h*k*(1-stretch*.7))+" "+(-tail)+" 0 Z";
  }
  function waitingRadius(elapsed){
    // Continuous small expansion during slow loading, not a giant empty hole.
    return 23+26*(1-Math.exp(-Math.max(0,elapsed)/950));
  }
  function render(s,time){
    const elapsed=Math.max(0,time-s.start),flight=clamp(elapsed/s.flightMs,0,1);
    const f=ease(flight),cx=s.w/2,cy=s.h/2;
    if(flight<1){
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
    const t=s.revealStart===null?0:clamp((time-s.revealStart)/s.revealDuration,0,1);
    const radius=s.revealStart===null?waitingRadius(elapsed-s.flightMs):
      lerp(s.revealRadius,Math.hypot(cx,cy)+8,1-Math.pow(1-t,3)*(1+3*t));
    // Only expose the live destination once verified (or during the bounded
    // timeout exit). Before that the old frame remains completely opaque.
    if(s.revealStart!==null){
      s.backdrop.style.maskImage="radial-gradient(circle at 50% 50%, transparent "+Math.max(0,radius-.8)+"px, black "+(radius+.8)+"px)";
      if(t>.82&&s.dim)s.backdrop.style.filter="brightness("+lerp(.94,1,ease((t-.82)/.18))+")";
    }
    s.fill.setAttribute("r",String(radius));
    s.fill.setAttribute("opacity",String(s.revealStart===null?1:1-ease(t/.15)));
    s.ring.setAttribute("r",String(radius));
    s.ring.setAttribute("opacity",String(1-ease((t-.86)/.14)));
  }
  function beginReveal(s,time,forced=false){
    if(s.revealStart!==null)return;
    const elapsed=time-s.start;
    s.revealStart=time;s.forced=forced;s.revealRadius=waitingRadius(elapsed-s.flightMs);
    s.revealDuration=Math.max(1,Math.min(s.timeout-elapsed,Math.max(540,1000-elapsed)));
    debug("reveal",forced?"deadline fallback":"verified destination",Math.round(elapsed)+"ms");
  }
  function probe(s,time){
    if(active!==s||s.readyAt!==null||s.probing||!s.committed||time<s.nextProbe)return;
    const b=s.browser,global=b.browsingContext?.currentWindowGlobal,uri=b.currentURI?.spec;
    if(!global?.drawSnapshot||!isWeb(uri)||stripHash(uri)!==stripHash(s.uri))return;
    if(s.kind==="hard"&&global===s.oldGlobal&&s.oldGlobal)return;
    // A cheap low-resolution probe. Two changed, non-blank observations
    // avoid accepting an old document, a transient paint or a black player.
    s.probing=true;s.nextProbe=time+170;
    const scale=clamp(420/Math.max(s.w,s.h),.08,.5);
    try{
      global.drawSnapshot(null,scale,"transparent",{drawView:true}).then(bitmap=>{
        if(!bitmap)return;
        try{
          if(active!==s||global!==b.browsingContext?.currentWindowGlobal||uri!==b.currentURI?.spec)return;
          const fp=fingerprint(bitmap,bitmap.width,bitmap.height);
          const diff=difference(s.oldFingerprint,fp);
          const watch=s.youtube&&/\/watch(?:\?|$)/.test(uri);
          const valid=fp&&fp.opaque>.97&&fp.detail>.025&&diff&&diff.mean>5&&diff.changed>.09&&(!watch||fp.center>.12);
          if(valid){
            s.confirmed++;
            // An actor/network hint plus one actual changed frame is not
            // sufficient: always require two visual samples.
            if(s.confirmed>=2){
              s.readyAt=now();debug("destination verified",Math.round(s.readyAt-s.start)+"ms",Math.round(diff.changed*100)+"% changed");
            }
          }else{s.confirmed=0;debug("destination not ready",diff?Math.round(diff.changed*100)+"% changed":"no pixels");}
        }finally{bitmap.close?.();}
      },error=>debug("destination probe failed",String(error))).finally(()=>{s.probing=false;});
    }catch{s.probing=false;}
  }
  function tick(s,time){
    if(active!==s)return;
    if(!enabled||motion.matches||s.browser!==gb.selectedBrowser)return finish(s,"context");
    if(time-s.lastGeometry>200){
      s.lastGeometry=time;
      if(!safeBrowser(s.browser))return finish(s,"context");
      const r=s.browser.getBoundingClientRect();
      if(Math.abs(r.width-s.w)>6||Math.abs(r.height-s.h)>6||Math.abs(r.left-s.left)>6||Math.abs(r.top-s.top)>6)
        return finish(s,"resize");
    }
    const elapsed=Math.max(0,time-s.start);
    if(elapsed>=s.timeout)return finish(s,"timeout");
    if(s.revealStart===null){
      probe(s,time);
      if(elapsed>=s.flightMs&&(s.readyAt!==null||elapsed>=s.timeout-560))
        beginReveal(s,time,s.readyAt===null);
    }
    render(s,time);
    if(s.revealStart!==null&&time-s.revealStart>=s.revealDuration&&elapsed>=1000)
      return finish(s,"complete");
    s.raf=window.requestAnimationFrame(t=>tick(s,t));
  }
  function markReady(s){
    if(active!==s)return;
    s.signal=true;
    s.nextProbe=Math.min(s.nextProbe,now());
    debug("navigation readiness hint",Math.round(now()-s.start)+"ms");
  }
  function finish(s,reason){
    if(active!==s)return;
    active=null;window.cancelAnimationFrame(s.raf);window.clearTimeout(s.timer);window.clearTimeout(s.softTimer);
    if(s.kind==="soft"){try{getActor(s.browser)?.sendAsyncMessage("CancelSoft");}catch{}}
    s.overlay.remove();debug("finish",reason,Math.round(now()-s.start)+"ms");scheduleWarm(350);
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
    if (message.name === "Warm") { warm(b); return; }
    if (message.name === "Paint") scheduleWarm(250);
    if (message.name === "Origin") {
      const d = message.data;
      if (![d.x, d.y, d.vw, d.vh].every(Number.isFinite) || d.vw <= 0 || d.vh <= 0) return;
      const r = b.getBoundingClientRect(), sx = r.width / d.vw, sy = r.height / d.vh;
      if (!d.navigation) return;
      historyUntil=0;
      const rect={x:r.left+d.x*sx,y:r.top+d.y*sy};
      recentPointer={browser:b,...rect,at:now()};
      if(active)return;
      remember(b,rect,d.pixels||null);
      if(pending?.browser===b && now()-pending.at<180 && !active){
        const p=pending;
        const st=begin(b,p.kind,p.uri);
        if(st&&p.committed){st.committed=true;st.global=b.browsingContext?.currentWindowGlobal;}
      }
      return;
    }
    if (message.name === "Paint") painted.add(global);
    const s = active;
    if (!s || s.browser !== b || !s.committed) return;
    if (message.name === "SoftReady" && s.kind === "soft" && message.data.token === s.token && global === s.global) markReady(s);
    if (message.name === "Paint" && s.kind === "hard" && global === b.browsingContext?.currentWindowGlobal &&
        global !== s.oldGlobal) markReady(s);
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
        if(Components.isSuccessCode(status)&&active.committed)markReady(active);
        else debug("network stop before destination verified",status);
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
          if(active.uri!==uri){active.uri=uri;active.confirmed=0;active.readyAt=null;active.nextProbe=now();}
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
        active.global = b.browsingContext?.currentWindowGlobal;
        if(active.uri!==uri){active.confirmed=0;active.readyAt=null;active.nextProbe=now();}
        active.uri = uri;
        if (active.global && active.global !== active.oldGlobal && painted.has(active.global)) markReady(active);
      } else if (origin?.browser === b || (cached?.browser===b&&cached.uri===previous)) {
        pending={browser:b,kind:"hard",uri,previous,at:now(),committed:true};
        const s = begin(b, "hard", uri);
        if (s) {
          s.committed = true; s.global = b.browsingContext?.currentWindowGlobal;
          if (s.global && painted.has(s.global)) markReady(s);
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
    ["resize", cancel, false], ["deactivate", cancel, false], ["beforecustomization", cancel, false],
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
    window[KEY].diagnostics=()=>({enabled,snapshot:on("snapshot"),reducedMotion:motion.matches,actorRegistered:!!releaseActor,cacheReady:!!cached,cacheAge:cached?Math.round(now()-cached.at):null,active:!!active,pending:!!pending,version:"0.2.0-preview.5",destinationVerified:active?.readyAt!==null&&!!active,revealing:active?.revealStart!==null&&!!active});
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
