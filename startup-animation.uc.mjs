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
  function canStartBeforePaint(utils,readyState){
    // Never hide controls that Gecko has already painted.
    try{
      const count=utils?.paintCount;
      if(count!==undefined&&count!==null&&Number.isFinite(Number(count)))return Number(count)===0;
    }catch{}
    try{if(utils?.paintingSuppressed===true)return true;}catch{}
    return readyState==="loading";
  }
  // No replay on Sine hot update, private popup, or an established window.
  // A late loader cannot conceal an already-displayed interface seamlessly.
  if(typeof window.addUnloadListener!=="function"||window[SEEN]||root.hasAttribute("popup-window"))return;
  window[SEEN]=true;
  function startupEligible(painted,delayed,oneState,age){
    return age<6500&&(!painted||!delayed||oneState==="pending");
  }
  let lateStart=!canStartBeforePaint(window.windowUtils,document.readyState);
  if(!prefs.getBoolPref(ENABLE,true)||reduced.matches||window.closed||
      root.hasAttribute("customizing")||root.getAttribute("inDOMFullscreen")==="true"||
      !startupEligible(lateStart,window.gBrowserInit?.delayedStartupFinished,root.getAttribute(READY),now()))return;
  // Sine saves the previous default as a user value. Upgrade that exact
  // 760ms default once; preserve every other choice, and allow users to
  // select 760ms again after the migration.
  const MIGRATED="zen.refined.startup.duration-v2-migrated";
  try{
    if(!prefs.getBoolPref(MIGRATED,false)){
      if(prefs.getIntPref(DURATION,1050)===760)prefs.setIntPref(DURATION,1050);
      prefs.setBoolPref(MIGRATED,true);
    }
  }catch{}
  const duration=Math.max(400,Math.min(1500,prefs.getIntPref(DURATION,1050)));
  const scale=duration/1050;
  const started=now(),deadline=started+5000;
  let dead=false,playing=false,settling=false,raf=0,timer=0,settled=false,nativeReady=false,readyAt=0,holdNode=null;
  let nativeObserver=null,style=null,lateObserver=null,lateResize=null,lateFrame=0,playStart=0,finishAt=0,sheetURI=null;
  const animations=new Map(),owned=new Map(),seen=new Set(),baseline=new Set();
  const EXISTING="data-zr-startup-existing";
  const MANAGED="data-zr-startup-managed",EFFECT="data-zr-startup-effect",MOVE="data-zr-startup-move",CLIP="data-zr-startup-clip",PROGRESS="--zr-startup-progress";
  let registered=false;
  try{window.CSS.registerProperty({name:PROGRESS,syntax:"<number>",inherits:false,initialValue:"1"});registered=true;}
  catch(e){registered=e.name==="InvalidModificationError";}
  const inputs=["pointerdown","keydown","wheel","dragstart","beforecustomization"];
  const EASE="cubic-bezier(.33,0,.22,1)";
  const FADE="cubic-bezier(.32,.12,.3,1)";
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
    if(lateFrame)window.cancelAnimationFrame(lateFrame);
    lateObserver?.disconnect();lateObserver=null;lateResize?.disconnect();lateResize=null;
    if(nativeObserver)try{Services.obs.removeObserver(nativeObserver,"browser-delayed-startup-finished");}catch{}
    nativeObserver=null;
    for(const a of animations.keys())try{a.cancel();}catch{}
    animations.clear();
    for(const n of [...owned.keys()])restore(n);
    for(const n of seen)n.removeAttribute(MANAGED);
    seen.clear();
    for(const n of baseline)n.removeAttribute(EXISTING);baseline.clear();
    if(sheetURI)try{window.windowUtils.removeSheet(sheetURI,window.windowUtils.USER_SHEET);}catch{}
    sheetURI=null;
    style?.remove();
    root.removeAttribute(PHASE);holdNode?.removeAttribute(HOLD);
    for(const type of inputs)window.removeEventListener(type,interrupt,true);
    window.removeEventListener("resize",onResize);
    window.removeEventListener("unload",finish);
    window.removeEventListener("OnePlane:StartupState",schedule);
    reduced.removeEventListener("change",preferenceChanged);
    try{prefs.removeObserver(ENABLE,preferenceChanged);}catch{}
    if(window[KEY]===finish)delete window[KEY];
  }
  function settle(){
    if(dead||settling)return;
    if(!playing||reduced.matches||!animations.size){finish();return;}
    settling=true;
    // The native background and page have never been touched.
    // Finish active effects from current values, not a different frame.
    root.setAttribute(PHASE,"settling");
    lateObserver?.disconnect();lateObserver=null;lateResize?.disconnect();lateResize=null;
    if(lateFrame)window.cancelAnimationFrame(lateFrame);lateFrame=0;
    if(timer)window.clearTimeout(timer);
    const pending=[];
    for(const [a,record] of animations){
      try{
        const cs=window.getComputedStyle(record.n),to=record.frames.at(-1),from={};
        for(const k of Object.keys(to)){
          const value=k.startsWith("--")?cs.getPropertyValue(k).trim():cs[k];
          from[k]=value!==undefined&&value!==""?value:to[k];
        }
        pending.push({a,record,from,to});
      }catch{pending.push({a,record,from:null,to:null});}
    }
    for(const {a,record,from,to} of pending){
      animations.delete(a);try{a.cancel();}catch{}
      if(!from||!play(record.n,[from,to],0,120,false,FADE,record.complete))record.complete?.();
    }
    timer=window.setTimeout(finish,155);
  }
  function interrupt(){settle();}
  function onResize(){if(playing)settle();}
  function preferenceChanged(){if(reduced.matches)finish();else if(!prefs.getBoolPref(ENABLE,true))settle();}
  function bounds(n,ignoreOpacity=false){
    if(!n||n.hidden||n.collapsed)return null;
    const s=window.getComputedStyle(n),r=n.getBoundingClientRect();
    return s.display!=="none"&&s.visibility!=="hidden"&&(ignoreOpacity||Number(s.opacity)!==0)&&r.width>1&&r.height>1&&
      r.right>0&&r.left<window.innerWidth&&r.bottom>0&&r.top<window.innerHeight?r:null;
  }
  function play(n,frames,delay,length,retain=false,easing=EASE,complete=null){
    if(!n)return false;
    try{
      const a=n.animate(frames,{delay,duration:length,easing,fill:"both"});
      animations.set(a,{n,frames,complete});
      a.finished?.then(()=>{
        if(dead||!animations.has(a)||retain)return;
        animations.delete(a);
        try{a.cancel();}catch{}
        complete?.();
      },()=>{});
      return true;
    }catch(error){console.warn("[Zen Refined] Startup animation effect:",error);return false;}
  }
  function save(n,k,value){
    let record=owned.get(n);
    if(!record){record=new Map();owned.set(n,record);}
    if(!record.has(k))record.set(k,{value:n.style.getPropertyValue(k),priority:n.style.getPropertyPriority(k)});
    n.style.setProperty(k,value,"important");
  }
  function restore(n){
    const record=owned.get(n);if(!record)return;
    for(const [k,v] of record){
      if(v.value)n.style.setProperty(k,v.value,v.priority);else n.style.removeProperty(k);
    }
    n.removeAttribute(EFFECT);n.removeAttribute(MOVE);n.removeAttribute(CLIP);
    owned.delete(n);
  }
  function reveal(n,{x=0,y=0,clip=false,delay=0,length=350,easing=EASE,late=false}={}){
    if(!n||seen.has(n)||!bounds(n,true))return false;
    // Remove the pending gate before sampling native opacity. All changes
    // occur synchronously, before the next paint.
    n.setAttribute(MANAGED,"true");
    const cs=window.getComputedStyle(n),opacity=Number(cs.opacity);
    if(!Number.isFinite(opacity)||opacity<=0){n.removeAttribute(MANAGED);return false;}
    seen.add(n);
    const alreadyPainted=baseline.has(n)||late&&!clip&&!n.matches?.("#PlacesToolbarItems > *");
    const initial=alreadyPainted ? .72 : 0;
    if(alreadyPainted)clip=false;
    const nativeTranslate=cs.translate||"none";
    const canMove=nativeTranslate==="none"||/^0(?:px|%)?(?: 0(?:px|%)?){0,2}$/.test(nativeTranslate);
    // Do not replace a nonzero native translation (notably the floating
    // URL bar). Clip and fade the actual popup instead.
    if(!canMove){x=0;y=0;}
    const start=late?Math.max(0,playStart+delay*scale-now()):Math.max(0,delay*scale);
    const time=late?Math.max(240,Math.min(length*scale,finishAt-now()-start-60)):length*scale;
    if(late)extendFinish(now()+start+time+65);
    if(registered){
      // Important theme opacity/translate/clip-path declarations defeat
      // ordinary animation effects. Animate a registered number instead;
      // important inline properties consume that same interpolated value.
      // The custom property itself must NOT be important.
      let record=owned.get(n);if(!record){record=new Map();owned.set(n,record);}
      record.set(PROGRESS,{value:n.style.getPropertyValue(PROGRESS),priority:n.style.getPropertyPriority(PROGRESS)});
      n.style.setProperty(PROGRESS,"1");
      save(n,"--zr-startup-base-opacity",String(opacity));
      n.setAttribute(EFFECT,"true");
      if(x||y){save(n,"--zr-startup-dx",x+"px");save(n,"--zr-startup-dy",y+"px");n.setAttribute(MOVE,"true");}
      if(clip)n.setAttribute(CLIP,"true");
      if(!play(n,[{[PROGRESS]:String(initial)},{[PROGRESS]:"1"}],start,time,false,easing,()=>restore(n)))restore(n);
    }else{
      const from={opacity:opacity*initial},to={opacity};
      if(x||y){from.translate=x*(1-initial)+"px "+y*(1-initial)+"px";to.translate="0px 0px";}
      if(clip){from.clipPath="inset(0 49% 0 49% round 8px)";to.clipPath="inset(-8px round 8px)";}
      play(n,[from,to],start,time,false,easing);
    }
    return true;
  }
  function extendFinish(until){
    // Late chrome may get a short reveal but cannot keep the startup hold
    // forever. All cleanup is still guaranteed by the final timer.
    const end=Math.min(playStart+duration+420,Math.max(finishAt,until));
    if(end===finishAt)return;
    finishAt=end;
    if(timer)window.clearTimeout(timer);
    timer=window.setTimeout(finish,Math.max(0,finishAt-now()));
  }
  function slide(n,x,y,delay,length){return reveal(n,{x,y,delay,length});}
  function openFromCenter(n,delay,length,late=false){return reveal(n,{clip:true,delay,length,late,easing:FADE});}
  function floatingBar(){
    const bar=get("urlbar");
    if(!bar)return null;
    const r=bounds(bar,true);
    // Some Zen builds mark the floating bar later than the actual layout.
    // A real input centered well below the toolbar is also a valid target.
    return bar.getAttribute("zen-floating-urlbar")==="true"||bar.hasAttribute("zen-newtab")||
      (r&&r.top>100&&r.width>100)?bar:null;
  }
  function controls(row,url,center,late=false){
    const nav=get("nav-bar"),target=get("nav-bar-customization-target"),candidates=new Set();
    const eligible=n=>n&&n!==row&&n!==url&&!row?.contains(n)&&!url?.contains(n)&&
      n.localName!=="toolbarspring"&&!n.id?.startsWith("oneplane-center-")&&bounds(n,true);
    // Native captions are moved outside customization-target by OnePlane.
    // Include the actual buttons, not the parent and child simultaneously.
    let captions=null;try{captions=window.gZenVerticalTabsManager?.actualWindowButtons;}catch{}
    const buttonSelector="toolbarbutton,button,.titlebar-button,[role=button],#titlebar-min,#titlebar-max,#titlebar-restore,#titlebar-close";
    const roots=[target,nav,captions,get("titlebar-buttonbox"),get("titlebar-buttonbox-container"),get("zen-window-controls"),get("zen-sidebar-top-buttons")].filter(Boolean);
    for(const parent of roots){
      for(const n of parent.querySelectorAll(buttonSelector))if(eligible(n))candidates.add(n);
    }
    // Animate controls, never whole toolbar wrappers or background surfaces.
    const leaves=[...candidates].filter(n=>![...candidates].some(c=>c!==n&&n.contains(c)));
    const left=[],right=[];
    for(const n of leaves){
      const r=bounds(n,true);if(!r)continue;
      (r.left+r.width/2<center?left:right).push({n,r});
    }
    left.sort((a,b)=>b.r.left-a.r.left);right.sort((a,b)=>a.r.left-b.r.left);
    for(const [side,group] of [[-1,left],[1,right]])for(let i=0;i<group.length;i++){
      const {n}=group[i];
      if(seen.has(n)||[...seen].some(other=>other.contains(n)||n.contains(other)))continue;
      reveal(n,{x:-side*14,y:-4,delay:260+Math.min(i*32,160),length:390,late});
    }
  }
  function revealBookmarks(center,late=false){
    const items=get("PlacesToolbarItems");
    const visible=Array.from(items?.children||[]).map(n=>({n,r:bounds(n,true)})).filter(x=>x.r);
    if(!visible.length)return;
    const bmCenter=(Math.min(...visible.map(x=>x.r.left))+Math.max(...visible.map(x=>x.r.right)))/2;
    const max=Math.max(1,...visible.map(x=>Math.abs(x.r.left+x.r.width/2-bmCenter)));
    for(const {n,r} of visible){
      const dx=Math.abs(r.left+r.width/2-bmCenter);
      reveal(n,{x:0,y:-16,delay:430+dx/max*115,length:430,easing:FADE,late});
    }
  }
  function scheduleLate(){
    if(dead||!playing||settling||lateFrame)return;
    lateFrame=window.requestAnimationFrame(()=>{
      lateFrame=0;if(dead||settling)return;
      const bar=floatingBar();
      if(bar&&!seen.has(bar))openFromCenter(bar,590,440,true);
      revealBookmarks(window.innerWidth/2,true);
      const row=get("oneplane-tabs"),url=get("urlbar-container"),center=window.innerWidth/2;
      controls(row,url,center,true);
      if(row&&root.getAttribute("oneplane-active")==="true")for(const t of collectTabs(row,center))if(!seen.has(t.n))reveal(t.n,{x:Math.max(-360,Math.min(360,center-t.mid)),delay:155,length:435,late:true});
    });
  }
  function collectTabs(row,center){
    const list=row.querySelector(".oneplane-tab-list"),units=[];
    if(!list)return units;
    for(const n of list.querySelectorAll(".oneplane-tab,.oneplane-split-group")){
      if(n.classList.contains("oneplane-tab")&&n.closest(".oneplane-split-group"))continue;
      const r=bounds(n,true);if(!r)continue;
      // Avoid animating offscreen tabs in a scroll lane.
      const lane=n.closest(".oneplane-island-lane")||list,lr=lane.getBoundingClientRect();
      if(r.right<=lr.left||r.left>=lr.right)continue;
      const mid=r.left+r.width/2;units.push({n,r,mid,distance:Math.abs(mid-center)});
    }
    units.sort((a,b)=>a.distance-b.distance);
    return units;
  }
  function launch(one){
    if(dead||playing||settling)return;playing=true;
    try{
      const row=get("oneplane-tabs"),url=get("urlbar-container");
      const bookmarks=get("PersonalToolbar"),items=get("PlacesToolbarItems");
      const floating=floatingBar();
      // Release early control gates before sampling native opacity, in one task.
      root.setAttribute(PHASE,"playing");
      const ur=bounds(url),rr=one?bounds(row):null;
      const island=one?row?.querySelector(".oneplane-title-island"):null,ir=bounds(island);
      const center=ir?ir.left+ir.width/2:one&&rr?rr.left+rr.width/2:ur?ur.left+ur.width/2:window.innerWidth/2;
      playStart=now();finishAt=playStart+duration+80;
      // The native floating field may be a top-layer popover; never clip
      // its parent during its independent entrance.
      if(ur&&!floating)openFromCenter(url,45,410);
      if(one&&rr){
        const tabs=collectTabs(row,center),far=Math.max(1,...tabs.map(x=>x.distance));
        for(const t of tabs){
          // Every real tab/group begins near the central anchor and fans
          // outward. Distance controls timing, not a fixed tab count.
          const dx=Math.max(-360,Math.min(360,center-t.mid));
          slide(t.n,dx,0,155+Math.min(150,t.distance/far*150),435);
        }
        const plus=row.querySelector(".oneplane-new-tab");if(bounds(plus))slide(plus,-26,0,340,390);
        if(ir)openFromCenter(island,45,410);
      }else{
        // Move actual native tabs instead of fading the acrylic sidebar.
        const sidebar=get("zen-tabs-wrapper")||get("TabsToolbar"),sr=bounds(sidebar,true);
        const dx=sr&&sr.left>=window.innerWidth/2?18:-18;
        let i=0;
        for(const tab of get("tabbrowser-tabs")?.querySelectorAll(".tabbrowser-tab")||[]){
          if(!bounds(tab))continue;
          slide(tab,dx,0,155+Math.min(i++*12,120),445);
        }
      }
      controls(row,url,center);
      revealBookmarks(center);
      if(floating)openFromCenter(floating,590,440);
      // Places and Zen's floating input can initialize after chrome-ready.
      // Keep only these late nodes gated until they receive their effect.
      lateObserver=new MutationObserver(scheduleLate);
      lateObserver.observe(root,{subtree:true,childList:true,attributes:true,
        attributeFilter:["zen-floating-urlbar","zen-newtab","hidden","collapsed","open","popover-open"]});
      if(typeof ResizeObserver==="function"){
        lateResize=new ResizeObserver(scheduleLate);
        for(const n of [get("urlbar"),items,bookmarks])if(n)lateResize.observe(n);
      }
      scheduleLate();
      // The page and native Zen background stay painted throughout.
      timer=window.setTimeout(finish,Math.max(0,finishAt-now()));
    }catch(error){console.warn("[Zen Refined] Startup reveal failed:",error);finish();}
  }
  function schedule(){
    if(dead||playing||settling||raf)return;
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
    if(active&&state==="true"&&root.getAttribute("zen-compact-mode")==="true"&&!holdNode?.hasAttribute("data-op-panel-open")){schedule();return;}
    const one=Boolean(active&&bounds(row)&&(root.getAttribute("zen-compact-mode")!=="true"||holdNode?.hasAttribute("data-op-panel-open")));
    // A narrow/hidden legacy strip falls back to native UI, never forces
    // a layout preference. With pending integration, fail open on timeout.
    if(!get("nav-bar")&&!get("navigator-toolbox")){schedule();return;}
    if(timer)window.clearTimeout(timer);
    console.info("[Zen Refined] Center Assembly launch: "+(one?"OnePlane":"native"));
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
    // Early startup gates only animated controls, never a window-sized layer.
    // Sine applies its chrome CSS at USER_SHEET origin. A user-important
    // declaration wins over author-important inline styles. Scope our
    // temporary user sheet to owned nodes and use deliberate specificity
    // to win over OnePlane's nested IDs. No global prefs or permanent CSS.
    const specificity=":is(#zr-startup-specificity,[data-zr-startup-effect])".repeat(8);
    const gate=":is(#zr-startup-specificity,:not([data-zr-startup-managed]))".repeat(8);
    const base=":root[data-zr-startup-phase] [data-zr-startup-effect]"+specificity;
    const edge="calc(49% * (1 - var("+PROGRESS+")) - 8px * var("+PROGRESS+"))";
    const waiting=':root[data-zr-startup-phase="waiting"]';
    const active=':root[data-zr-startup-phase="playing"]';
    const earlyTargets=[
      "#urlbar-container",
      '#urlbar:is([zen-floating-urlbar="true"],[zen-newtab])',
      "#oneplane-tabs :is(.oneplane-tab,.oneplane-split-group,.oneplane-title-island,.oneplane-new-tab)",
      "#tabbrowser-tabs .tabbrowser-tab",
      "#PlacesToolbarItems > *",
      "#nav-bar :is(toolbarbutton,button,.titlebar-button,[role=button])",
      "#zen-sidebar-top-buttons :is(toolbarbutton,button,.titlebar-button,[role=button])",
      ":is(#titlebar-buttonbox,#titlebar-buttonbox-container,#zen-window-controls,.titlebar-buttonbox-container) .titlebar-button"
    ];
    const waitingGate=earlyTargets.map(s=>waiting+" "+s+":not([data-zr-startup-managed],[data-zr-startup-existing])"+gate).join(",\n");
    const cssText=`
      ${waitingGate},
      ${active} #urlbar:is([zen-floating-urlbar="true"],[zen-newtab]):not([data-zr-startup-managed],[data-zr-startup-existing])${gate},
      ${active} #PlacesToolbarItems > :not([data-zr-startup-managed],[data-zr-startup-existing])${gate} {
        opacity: 0 !important;
        transition-property: none !important;
      }
      ${base} {
        /* Do not let a native CSS transition chase each sampled value. */
        transition-property: none !important;
        opacity: calc(var(--zr-startup-base-opacity) * var(${PROGRESS})) !important;
      }
      ${base}[data-zr-startup-move] {
        translate: calc(var(--zr-startup-dx) * (1 - var(${PROGRESS}))) calc(var(--zr-startup-dy) * (1 - var(${PROGRESS}))) !important;
      }
      ${base}[data-zr-startup-clip] {
        clip-path: inset(-8px ${edge} -8px ${edge} round 8px) !important;
      }
    `;
    try{
      sheetURI=Services.io.newURI("data:text/css;charset=utf-8,"+encodeURIComponent(cssText));
      window.windowUtils.loadSheet(sheetURI,window.windowUtils.USER_SHEET);
    }catch{
      sheetURI=null;style=html("style");style.textContent=cssText;root.append(style);
    }
    // Already-painted controls are never hidden by a late loader. Newly
    // inserted controls remain eligible for the full center reveal.
    lateStart=lateStart||!canStartBeforePaint(window.windowUtils,document.readyState);
    if(lateStart)for(const selector of earlyTargets)for(const n of document.querySelectorAll(selector))if(!baseline.has(n)){baseline.add(n);n.setAttribute(EXISTING,"true");}
    root.setAttribute(PHASE,"waiting");hold();
    console.info("[Zen Refined] Center Assembly: "+(lateStart?"late chrome startup":"prepaint startup"));
    timer=window.setTimeout(finish,Math.max(0,deadline-now()));
    if(window.gBrowserInit?.delayedStartupFinished)onNativeReady();
    else{nativeObserver=subject=>{if(subject!==window)return;Services.obs.removeObserver(nativeObserver,"browser-delayed-startup-finished");nativeObserver=null;onNativeReady();};
      Services.obs.addObserver(nativeObserver,"browser-delayed-startup-finished");}
    schedule();
  }catch(error){console.warn("[Zen Refined] Startup controller:",error);finish();}
})();
