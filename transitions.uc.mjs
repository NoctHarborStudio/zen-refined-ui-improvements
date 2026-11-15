/* Zen Refined — Adaptive Page Transitions
 * Native navigation always proceeds normally. All pixels are ephemeral, in memory.
 * No interception of requests, content injection, disk writes, or viewport resize.
 */
const PREFIX = "zen.refined.transitions.";
const KEY = "__zenRefinedPageTransitions";
const NS = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";
const ACTOR = "ZenRefinedProgressiveTransition";
const ACTOR_URI = "chrome://sine/content/9d788b55-d497-41da-8444-993c603e89e4/actors/ZenRefinedProgressiveTransitionParent.sys.mjs";
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
  const log = (...args) => console.info('[Zen Refined transitions 0.2.0-preview.7]', ...args);
  const painted = new WeakSet();
  const locations = new WeakMap();
  for (const b of gb.browsers) locations.set(b, b.currentURI?.spec || "");
  const debug = (...args) => { if (prefs.getBoolPref(PREFIX + "debug", false)) console.debug("[Zen Refined transitions]", ...args); };
  const on = (key, fallback = true) => prefs.getBoolPref(PREFIX + key, fallback);
  const maxTime = () => clamp(prefs.getIntPref(PREFIX + "timeout", 4000), 800, 4000);
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
    if(!safeBrowser(b)||!on("snapshot")||active||pending||!isWeb(b.currentURI?.spec))return;
    const delay=(force?350:1000)-(now()-lastWarm);
    if(warming || delay>0){if(force)scheduleWarm(Math.max(120,delay));return;}
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
        // Validate and upload the outgoing frame BEFORE navigation, not in
        // the first animation frame. Keep the previous good frame if this fails.
        const frame=drawSource({bitmap},bounds);
        bitmap.close?.();
        if(!frame){debug("warm: rejected outgoing frame");return;}
        cached?.bitmap?.close?.();
        cached={browser:b,uri,global,frame,at:now()};
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
    if(!pixels && (cached?.browser!==b||cached.uri!==b.currentURI?.spec))capture(b,origin);
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
    let backdrop=oldCache?.frame||drawSource(source,bounds);
    source.expired=true;source.bitmap?.close?.();source.bitmap=null;source.pixels=null;
    if(!backdrop){debug("skip: no valid outgoing snapshot");return null;}
    clearPending();
    clearCache();
    const overlay=newNode("div","zr-page-transition"),cover=newNode("div","zr-page-transition-cover"),shade=newNode("div","zr-page-transition-shade");
    const art=svg("svg",{class:"zr-page-transition-art",viewBox:"0 0 "+bounds.width+" "+bounds.height});
    const defs=svg("defs"),gradient=svg("linearGradient",{id:"zr-morph-drop-fill",x1:"0",y1:"0",x2:"0",y2:"1"});
    const light=svg("stop",{offset:"0%","stop-color":"#dedede"}),dark=svg("stop",{offset:"100%","stop-color":"#a8a8a8"});
    gradient.append(light,dark);defs.append(gradient);
    const ring=svg("circle",{cx:bounds.width/2,cy:bounds.height/2,r:23,fill:"none",stroke:"#888","stroke-width":"1.5",opacity:"0"});
    const fill=svg("circle",{cx:bounds.width/2,cy:bounds.height/2,r:23,fill:"#737373",opacity:"0"});
    const drop=svg("path",{fill:"url(#zr-morph-drop-fill)",stroke:"#969696","stroke-width":"1.25"});
    art.append(defs,fill,ring,drop);cover.append(backdrop,shade);overlay.append(cover,art);
    Object.assign(overlay.style,{left:bounds.left+"px",top:bounds.top+"px",width:bounds.width+"px",height:bounds.height+"px"});
    const start=now(),nominal=800;
    const s={token:++serial,browser:b,kind,uri,start,timeout:maxTime(),nominal,
      w:bounds.width,h:bounds.height,left:bounds.left,top:bounds.top,overlay,cover,backdrop,shade,art,drop,ring,fill,light,dark,
      from:point(bounds,source.rect),committed:kind==="soft",global:kind==="soft"?b.browsingContext?.currentWindowGlobal:null,
      oldGlobal:oldCache?.global||b.browsingContext?.currentWindowGlobal,readyAt:null,raf:0,timer:0,lastGeometry:start,
      commitAt:kind==="soft"?start:null,paintAt:null,showAt:null,plan:null,progress:0,lastProgressAt:start,
      velocity:0,radius:0,finalRendered:false,flightMs:260,dim:on("dim"),
      clipPath:window.CSS?.supports?.("clip-path",'path(evenodd, "M 0 0 H 100 V 100 H 0 Z M 50 50 L 51 51 Z")')||false,youtube:/^https?:\/\/(?:[^/]+\.)?youtube\.com\//i.test(uri)};
    active=s;
    try {
      root.append(overlay);
      if(s.dim)shade.style.opacity=".06";
      render(s,start);
      // One watchdog for a suspended refresh driver. Normal completion is
      // exclusively owned by the animation clock, not this timer.
      s.timer=window.setTimeout(()=>{
        if(active!==s)return;
        s.progress=1;s.showAt=s.showAt??now();render(s,s.start+s.timeout);
        finish(s,"deadline-watchdog");
      },s.timeout);
      s.raf=window.requestAnimationFrame(t=>tick(s,t));
      debug("start",kind,"validated snapshot");
      if(kind==="soft"){
        const actor=getActor(b);
        try{actor?.sendAsyncMessage("WatchSoft",{token:s.token});}catch{}
        // SoftPaint exposes the first meaningful update; SoftReady only affects completion.
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
  function setCover(s,radius){
    const cx=s.w/2,cy=s.h/2,r=Math.max(0,radius);
    if(s.clipPath){
      // A single inverse circular clip, shared by the snapshot and dim layer.
      const path="M 0 0 H "+s.w+" V "+s.h+" H 0 Z M "+(cx-r)+" "+cy+
        " A "+r+" "+r+" 0 1 0 "+(cx+r)+" "+cy+" A "+r+" "+r+" 0 1 0 "+(cx-r)+" "+cy+" Z";
      s.cover.style.clipPath='path(evenodd, "'+path+'")';
    }else{
      s.cover.style.maskImage="radial-gradient(circle at 50% 50%, transparent "+Math.max(0,r-.6)+"px, black "+(r+.6)+"px)";
    }
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
    const p=clamp(s.progress,0,1);
    const radius=lerp(23,Math.hypot(cx,cy)+12,ease(p));
    s.radius=radius;
    const visibility=s.showAt===null?0:ease((time-s.showAt)/100);
    // The new page is live behind this cutout: subsequent DOM, image and
    // video updates are immediately visible inside it. No destination copy.
    if(s.showAt!==null)setCover(s,radius);
    s.fill.setAttribute("r",String(radius));
    s.fill.setAttribute("opacity",String(1-visibility));
    s.ring.setAttribute("r",String(radius));
    s.ring.setAttribute("opacity",String(1-ease((p-.86)/.14)));
    if(s.dim)s.shade.style.opacity=String(.06*(1-ease((p-.8)/.2)));
    if(p>=1){
      s.cover.style.opacity="0";s.fill.setAttribute("opacity","0");s.ring.setAttribute("opacity","0");
    }
  }
  function planCompletion(s,time,forced=false){
    if(s.plan)return;
    const elapsed=time-s.start;
    // Reserve a compositor frame at the deadline; 800ms is the minimum,
    // not a prediction of network duration.
    const deadline=s.start+s.timeout-20;
    // A forced completion consumes the reserved final interval. It must
    // never set the end to "now": that made a slow transition jump at 70%.
    const earliest=forced?deadline:Math.max(s.start+s.nominal,time+Math.max(180,440*(1-s.progress)));
    const end=Math.max(time+1,Math.min(deadline,earliest));
    const duration=end-time;
    // Cubic Hermite continuity: carry the current expansion velocity into
    // the completion curve, bounded for strictly monotonic motion.
    const tangent=clamp(s.velocity*duration,0,3*(1-s.progress));
    s.plan={at:time,end,from:s.progress,tangent};
    if(s.showAt===null)s.showAt=time;
    debug("completion planned",forced?"deadline":"ready",Math.round(elapsed)+"ms","end",Math.round(end-s.start)+"ms");
  }
  function syncGeometry(s){
    const b=s.browser,r=b.getBoundingClientRect();
    if(r.width<=20||r.height<=20)return false;
    if(Math.abs(r.width-s.w)<.5&&Math.abs(r.height-s.h)<.5&&Math.abs(r.left-s.left)<.5&&Math.abs(r.top-s.top)<.5)return true;
    // Compact mode / sidebar layout may move by a few pixels. Re-anchor
    // instead of deleting an in-progress mask and flashing the full page.
    s.from={x:clamp(s.from.x+s.left-r.left,0,r.width),y:clamp(s.from.y+s.top-r.top,0,r.height)};
    s.w=r.width;s.h=r.height;s.left=r.left;s.top=r.top;
    Object.assign(s.overlay.style,{left:r.left+"px",top:r.top+"px",width:r.width+"px",height:r.height+"px"});
    s.art.setAttribute("viewBox","0 0 "+s.w+" "+s.h);
    for(const el of [s.fill,s.ring]){el.setAttribute("cx",String(s.w/2));el.setAttribute("cy",String(s.h/2));}
    return true;
  }
  function tick(s,time){
    if(active!==s)return;
    if(!enabled||motion.matches||s.browser!==gb.selectedBrowser)return finish(s,"context");
    if(time-s.lastGeometry>160){s.lastGeometry=time;if(!safeBrowser(s.browser)||!syncGeometry(s))return finish(s,"context");}
    const elapsed=Math.max(0,time-s.start);
    if(s.finalRendered&&elapsed>=s.nominal)return finish(s,"complete");
    // Readiness is a hint to the animation, never a gate to the network.
    // Hard navigation exposes committed live content after paint or a short
    // grace period; SPA navigation uses its first DOM update, with a bounded
    // fallback because not every application exposes navigation events.
    if(s.showAt===null&&elapsed>=s.flightMs&&s.committed){
      const grace=s.kind==="soft"?240:90;
      if(s.paintAt!==null||time-(s.commitAt??s.start)>=grace)s.showAt=time;
    }
    if(elapsed>=s.flightMs){
      const age=elapsed-s.flightMs;
      // Begin expanding on landing, regardless of readiness. Without a
      // committed page only a small neutral disc grows; once visible, the
      // aperture grows continuously and the user sees native loading.
      const limit=s.showAt===null?.19:.80;
      const tau=s.showAt===null?400:740;
      const dt=Math.max(0,time-Math.max(s.lastProgressAt,s.start+s.flightMs));
      if(!s.plan){
        const previous=s.progress;
        if(s.progress<limit)s.progress=limit-(limit-s.progress)*Math.exp(-dt/tau);
        s.velocity=dt>0?(s.progress-previous)/dt:s.velocity;
        const forced=elapsed>=s.timeout-600;
        if(s.readyAt!==null||forced)planCompletion(s,time,forced);
      }
      if(s.plan){
        const a=s.plan,u=clamp((time-a.at)/(a.end-a.at),0,1);
        const u2=u*u,u3=u2*u;
        const value=(2*u3-3*u2+1)*a.from+(u3-2*u2+u)*a.tangent+(-2*u3+3*u2);
        s.progress=Math.max(s.progress,clamp(value,0,1));
        if(u>=1&&elapsed>=s.nominal)s.progress=1;
        // At a custom 800ms deadline the interpolation may finish just
        // before the minimum; keep the final frame until 800ms.
        if(u>=1&&elapsed<s.nominal)s.progress=Math.min(s.progress,.999);
      }
      s.lastProgressAt=time;
    }
    render(s,time);
    if(s.progress>=1&&elapsed>=s.nominal)s.finalRendered=true;
    if(elapsed>=s.timeout)return finish(s,"deadline-frame");
    s.raf=window.requestAnimationFrame(t=>tick(s,t));
  }
  function markPaint(s){
    if(active!==s)return;
    if(s.paintAt===null)s.paintAt=now();
    debug("destination first update",Math.round(now()-s.start)+"ms");
  }
  function markReady(s){
    if(active!==s)return;
    markPaint(s);
    if(s.readyAt===null){s.readyAt=now();debug("destination readiness",Math.round(s.readyAt-s.start)+"ms");}
  }
  function finish(s,reason){
    if(active!==s)return;
    active=null;window.cancelAnimationFrame(s.raf);window.clearTimeout(s.timer);window.clearTimeout(s.softTimer);
    if(s.kind==="soft"){try{getActor(s.browser)?.sendAsyncMessage("CancelSoft");}catch{}}
    lastResult={reason,elapsed:Math.round(now()-s.start),progress:Math.round(s.progress*1000)/1000,committed:s.committed,painted:s.paintAt!==null};
    s.overlay.remove();debug("finish",lastResult);scheduleWarm(350);
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
        if(st&&p.committed){st.committed=true;st.commitAt=now();st.global=b.browsingContext?.currentWindowGlobal;}
      }
      return;
    }
    if (message.name === "Paint") painted.add(global);
    const s = active;
    if (!s || s.browser !== b || !s.committed) return;
    if(message.name==="SoftPaint"&&s.kind==="soft"&&message.data.token===s.token&&global===s.global)markPaint(s);
    if (message.name === "SoftReady" && s.kind === "soft" && message.data.token === s.token && global === s.global) markReady(s);
    if (message.name === "Paint" && s.kind === "hard" && global === b.browsingContext?.currentWindowGlobal &&
        global !== s.oldGlobal) markPaint(s);
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
          if(active.uri!==uri)active.uri=uri;
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
        active.global = b.browsingContext?.currentWindowGlobal;
        active.uri = uri;
        if (active.global && active.global !== active.oldGlobal && painted.has(active.global)) markPaint(active);
      } else if (origin?.browser === b || (cached?.browser===b&&cached.uri===previous)) {
        pending={browser:b,kind:"hard",uri,previous,at:now(),committed:true};
        const s = begin(b, "hard", uri);
        if (s) {
          s.committed = true; s.commitAt=now();s.global = b.browsingContext?.currentWindowGlobal;
          if (s.global && painted.has(s.global)) markPaint(s);
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
    window[KEY].diagnostics=()=>({enabled,snapshot:on("snapshot"),reducedMotion:motion.matches,actorRegistered:!!releaseActor,cacheReady:!!cached,cacheAge:cached?Math.round(now()-cached.at):null,active:!!active,pending:!!pending,version:"0.2.0-preview.7",destinationReady:active?.readyAt!=null,revealing:active?.showAt!=null,progress:active?.progress??null,lastResult});
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
