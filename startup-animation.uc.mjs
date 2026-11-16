/* Zen Refined — Center Assembly. Browser-chrome only; optional OnePlane
 * handshake. Never navigates, captures, or injects into a web page. */
(() => {
  const root=document.documentElement,prefs=Services.prefs;
  const ENABLE="zen.refined.startup.animation",DURATION="zen.refined.startup.animation-duration";
  const PHASE="data-zr-startup-phase",HOLD="oneplane-startup-hold",READY="data-op-startup-ready";
  const KEY="__zenRefinedStartupAnimation",SEEN="__zenRefinedStartupAnimationSeen";
  const html=(tag)=>document.createElementNS("http://www.w3.org/1999/xhtml",tag);
  const get=id=>document.getElementById(id);
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
  const now=()=>window.performance.now();
  // No replay on Sine hot update, private popup, or an established window.
  // A late loader cannot conceal an already-displayed interface seamlessly.
  if(typeof window.addUnloadListener!=="function"||window[SEEN]||root.hasAttribute("popup-window"))return;
  window[SEEN]=true;
  if(!prefs.getBoolPref(ENABLE,true)||reduced.matches||now()>4000||window.closed||
      root.hasAttribute("customizing")||root.getAttribute("inDOMFullscreen")==="true")return;
  const duration=Math.max(400,Math.min(1100,prefs.getIntPref(DURATION,760)));
  const scale=duration/760;
  const started=now(),deadline=started+2400;
  let dead=false,playing=false,raf=0,timer=0,settled=false,nativeReady=false,readyAt=0,holdNode=null;
  let nativeObserver=null,cover=null,pageVeil=null,style=null;
  const animations=new Set();
  const inputs=["pointerdown","keydown","wheel","dragstart","beforecustomization"];
  const EASE="cubic-bezier(.22,.8,.22,1)";
  function hold(){
    const w=get("zen-appcontent-navbar-wrapper");
    if(w&&w!==holdNode){
      holdNode?.removeAttribute(HOLD);holdNode=w;
      w.setAttribute(HOLD,"true");
    }
  }
  function finish(){
    if(dead)return;dead=true;
    if(raf)window.cancelAnimationFrame(raf);
    if(timer)window.clearTimeout(timer);
    if(nativeObserver)try{Services.obs.removeObserver(nativeObserver,"browser-delayed-startup-finished");}catch{}
    nativeObserver=null;
    for(const a of animations)try{a.cancel();}catch{}
    animations.clear();
    cover?.remove();pageVeil?.remove();style?.remove();
    root.removeAttribute(PHASE);holdNode?.removeAttribute(HOLD);
    for(const type of inputs)window.removeEventListener(type,interrupt,true);
    window.removeEventListener("resize",onResize);
    window.removeEventListener("unload",finish);
    window.removeEventListener("OnePlane:StartupState",schedule);
    reduced.removeEventListener("change",preferenceChanged);
    try{prefs.removeObserver(ENABLE,preferenceChanged);}catch{}
    if(window[KEY]===finish)delete window[KEY];
  }
  function interrupt(){finish();}
  function onResize(){if(playing)finish();}
  function preferenceChanged(){if(reduced.matches||!prefs.getBoolPref(ENABLE,true))finish();}
  function veil(id){
    const n=html("div");n.id=id;n.setAttribute("aria-hidden","true");
    // An opaque, theme-compatible chrome veil; not a screenshot, not a
    // screenshot blur, and not a second copy of the content.
    for(const [k,v] of Object.entries({position:"fixed",inset:"0","z-index":"2147483646","pointer-events":"none",
      background:"light-dark(#eef0f4, #15171e)",margin:"0",padding:"0",border:"0","box-sizing":"border-box"}))
      n.style.setProperty(k,v,"important");
    root.append(n);return n;
  }
  function bounds(n){
    if(!n||n.hidden||n.collapsed)return null;
    const s=window.getComputedStyle(n),r=n.getBoundingClientRect();
    return s.display!=="none"&&s.visibility!=="hidden"&&Number(s.opacity)!==0&&r.width>1&&r.height>1&&
      r.right>0&&r.left<window.innerWidth&&r.bottom>0&&r.top<window.innerHeight?r:null;
  }
  function play(n,frames,delay,length,retain=false){
    if(!n)return;
    try{
      const a=n.animate(frames,{delay:delay*scale,duration:length*scale,easing:EASE,fill:"both"});
      animations.add(a);
      // Release the native control immediately at its own endpoint. A
      // retained clip could clip its popover or focus outline until the
      // whole timeline ends. Only veils retain their transparent state.
      if(!retain)a.finished?.then(()=>{if(animations.delete(a))a.cancel();},()=>{});
    }catch(error){console.warn("[Zen Refined] Startup animation effect:",error);}
  }
  function slide(n,x,y,delay,length,opacity=true){
    // Independent translate avoids replacing an existing native transform.
    const a={translate:x+"px "+y+"px"},b={translate:"0px 0px"};
    if(opacity){a.opacity=0;b.opacity=Number(window.getComputedStyle(n).opacity)||1;}
    play(n,[a,b],delay,length);
  }
  function openFromCenter(n,delay,length){
    // Clip the native control, not its layout width. At completion the
    // effect is removed, preserving Zen's own address expansion/popover.
    play(n,[{clipPath:"inset(0 48% 0 48% round 8px)"},{clipPath:"inset(0 -2px 0 -2px round 8px)"}],delay,length);
  }
  function collectTabs(row,center){
    const list=row.querySelector(".oneplane-tab-list"),units=[];
    if(!list)return units;
    for(const n of list.querySelectorAll(".oneplane-tab,.oneplane-split-group")){
      if(n.classList.contains("oneplane-tab")&&n.closest(".oneplane-split-group"))continue;
      const r=bounds(n);if(!r)continue;
      // Avoid animating offscreen tabs in a scroll lane.
      const lane=n.closest(".oneplane-island-lane")||list,lr=lane.getBoundingClientRect();
      if(r.right<=lr.left||r.left>=lr.right)continue;
      const mid=r.left+r.width/2;units.push({n,r,mid,distance:Math.abs(mid-center)});
    }
    units.sort((a,b)=>a.distance-b.distance);
    return units;
  }
  function launch(one){
    if(dead||playing)return;playing=true;
    try{
      const row=get("oneplane-tabs"),url=get("urlbar-container"),bar=get("urlbar");
      const nav=get("nav-bar"),bookmarks=get("PersonalToolbar"),items=get("PlacesToolbarItems");
      const floating=bar?.getAttribute("zen-floating-urlbar")==="true"||bar?.hasAttribute("zen-newtab");
      const page=get("tabbrowser-tabpanels")||get("tabbrowser-tabbox");
      const ur=bounds(url),nr=bounds(nav),br=bounds(bookmarks),rr=one?bounds(row):null;
      const island=one?row?.querySelector(".oneplane-title-island"):null,ir=bounds(island);
      const center=ir?ir.left+ir.width/2:one&&rr?rr.left+rr.width/2:ur?ur.left+ur.width/2:window.innerWidth/2;
      // Read all geometry before effects start. The content veil is clipped
      // below the real toolbar; top chrome remains visible as it assembles.
      const bottom=Math.min(window.innerHeight,Math.max(nr?.bottom||0,br?.bottom||0,rr?.bottom||0));
      const pr=bounds(page);
      pageVeil=veil("zr-startup-page-veil");
      const top=Math.max(0,bottom,pr?.top||0);
      pageVeil.style.setProperty("clip-path","inset("+top+"px 0 0 0)","important");
      root.setAttribute(PHASE,"playing");
      if(ur&&(!floating||url.hasAttribute("data-op-empty")))openFromCenter(url,40,270);
      if(one&&rr){
        const tabs=collectTabs(row,center),far=Math.max(1,...tabs.map(x=>x.distance));
        for(const t of tabs){
          // Every real tab/group begins near the central anchor and fans
          // outward. Distance controls timing, not a fixed tab count.
          const dx=Math.max(-360,Math.min(360,center-t.mid));
          slide(t.n,dx,0,125+Math.min(105,t.distance/far*105),290);
        }
        const plus=row.querySelector(".oneplane-new-tab");if(bounds(plus))slide(plus,-26,0,265,240);
        if(ir)openFromCenter(island,40,270);
        const target=get("nav-bar-customization-target");
        for(const n of Array.from(target?.children||[])){
          if(n===row||n===url||n.localName==="toolbarspring"||n.id?.startsWith("oneplane-center-")||!bounds(n))continue;
          slide(n,0,-8,190,250);
        }
      }else{
        // Native Zen: never rearrange the sidebar or force horizontal tabs.
        const sidebar=get("zen-tabs-wrapper")||get("TabsToolbar");
        const sr=bounds(sidebar);
        if(sr)slide(sidebar,sr.left<window.innerWidth/2?-18:18,0,120,310);
        const target=get("nav-bar-customization-target");
        for(const n of Array.from(target?.children||[])){
          if(n===url||!bounds(n)||n.localName==="toolbarspring")continue;
          slide(n,0,-8,190,250);
        }
      }
      // Bookmarks retain their native positions and magnification logic;
      // this one-shot vertical entry does not alter margins or sizes.
      const visible=Array.from(items?.children||[]).map(n=>({n,r:bounds(n)})).filter(x=>x.r);
      const bmCenter=visible.length?(visible[0].r.left+visible.at(-1).r.right)/2:center;
      for(const {n,r} of visible){
        const offset=Math.min(65,Math.abs(r.left+r.width/2-bmCenter)*.12);
        slide(n,0,-11,310+offset,250);
      }
      if(floating&&bounds(bar))openFromCenter(bar,425,310);
      // Background reveals first; content stays veiled until chrome is in
      // motion. Nothing waits for network loads, remote DOM or a page FCP.
      play(pageVeil,[{opacity:1},{opacity:0}],390,340,true);
      play(cover,[{opacity:1},{opacity:0}],0,130,true);
      timer=window.setTimeout(finish,duration+90);
    }catch(error){console.warn("[Zen Refined] Startup reveal failed:",error);finish();}
  }
  function schedule(){
    if(dead||playing||raf)return;
    raf=window.requestAnimationFrame(tick);
  }
  function tick(){
    raf=0;if(dead||playing)return;
    if(now()>=deadline){finish();return;}
    hold();
    if(!nativeReady||!settled){schedule();return;}
    const state=root.getAttribute(READY);
    const controller=window.__oneplaneLayoutController;
    const row=get("oneplane-tabs");
    const active=root.getAttribute("oneplane-active")==="true"&&row?.getAttribute("data-ready")==="true";
    const expected=Boolean(controller||state||active);
    // Wait for optional integration only if it is actually present. Old
    // OnePlane versions are accepted if already active and visible.
    if(state==="pending"||(expected&&!active&&state!=="true")){schedule();return;}
    if(!expected&&now()-readyAt<120){schedule();return;}
    if(active&&state==="true"&&window.innerWidth>=900&&root.getAttribute("zen-compact-mode")==="true"&&!holdNode?.hasAttribute("data-op-panel-open")){schedule();return;}
    const one=Boolean(active&&bounds(row)&&window.innerWidth>=900&&(root.getAttribute("zen-compact-mode")!=="true"||holdNode?.hasAttribute("data-op-panel-open")));
    // A narrow/hidden legacy strip falls back to native UI, never forces
    // a layout preference. With pending integration, fail open on timeout.
    if(!get("nav-bar")&&!get("navigator-toolbox")){schedule();return;}
    if(timer)window.clearTimeout(timer);
    launch(one);
  }
  function onNativeReady(){
    if(dead||nativeReady)return;
    nativeReady=true;
    // These promises are native chrome/workspace initialization, not
    // network page loading. A hard deadline protects slow/broken mods.
    Promise.allSettled([window.SessionStore?.promiseAllWindowsRestored,window.gZenWorkspaces?.promiseInitialized])
      .then(()=>{if(dead)return;window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>{
        if(dead)return;settled=true;readyAt=now();schedule();
      }));});
  }
  try{
    window[KEY]?.();window[KEY]=finish;
    window.addUnloadListener(finish);window.addEventListener("unload",finish,{once:true});
    for(const type of inputs)window.addEventListener(type,interrupt,true);
    window.addEventListener("resize",onResize);
    window.addEventListener("OnePlane:StartupState",schedule);
    reduced.addEventListener("change",preferenceChanged);
    prefs.addObserver(ENABLE,preferenceChanged);
    // The early cover masks ordinary chrome. A floating native search is
    // in Gecko's top layer, so clip it during the waiting phase separately.
    style=html("style");style.textContent=':root[data-zr-startup-phase="waiting"] #urlbar:is([zen-floating-urlbar="true"],[zen-newtab]) { clip-path: inset(50% 50% 50% 50%) !important; }';
    root.append(style);root.setAttribute(PHASE,"waiting");cover=veil("zr-startup-cover");hold();
    timer=window.setTimeout(finish,2400);
    if(window.gBrowserInit?.delayedStartupFinished)onNativeReady();
    else{nativeObserver=subject=>{if(subject!==window)return;Services.obs.removeObserver(nativeObserver,"browser-delayed-startup-finished");nativeObserver=null;onNativeReady();};
      Services.obs.addObserver(nativeObserver,"browser-delayed-startup-finished");}
    schedule();
  }catch(error){console.warn("[Zen Refined] Startup controller:",error);finish();}
})();
