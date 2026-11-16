/* Zen Refined — Download Indicator. Native download events, no polling,
 * no interception of downloads, no file/network access. One view per window.
 * A future OnePlane Extension Dock can host the same view via setHost(). */
(() => {
  const root=document.documentElement,prefs=Services.prefs;
  const PREF="zen.refined.downloads.indicator",STATS_PREF="zen.refined.downloads.statistics",KEY="__zenRefinedDownloadIndicator";
  const NS="http://www.w3.org/1999/xhtml",ACTIVE="data-zr-downloads-active";
  const make=(tag,cls)=>{const n=document.createElementNS(NS,tag);if(cls)n.className=cls;return n;};
  const get=id=>document.getElementById(id);
  const RATE=200,HOLD=2000,SIDE="zen.tabs.vertical.right-side";
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
  const enabled=()=>prefs.getBoolPref(PREF,true);
  if(root.hasAttribute("popup-window")||typeof window.addUnloadListener!=="function")return;
  window[KEY]?.dispose?.();
  let dead=false,epoch=0,view=null,list=null,node=null,fill=null,speed=null,icon=null,host=null;
  let flight=null,flightAnimation=null,panelAnimation=null,panelToken=0,entering=false,manualHold=false,sidebarOrigin=false,overlayLayer=null;
  let layoutFrame=0,resizeObserver=null,observedSidebar=null,anchor=null,lastClick=null,cardOpen=false,flightToken=0,flightTimer=0,latest=null;
  let updateTimer=0,hideTimer=0,readyObserver=null,layoutObserver=null,initialized=false,hydrating=false;
  let lastDockRect=null,followFrame=0,followUntil=0,overlayUntil=0;
  let dock=null,dockList=null,dockEmpty=null,dockMore=null,dockBackdrop=null,dockNotice=null,dockOpen=false,limit=30;
  const history=new Map(),rows=new Map();
  let historyOrder=null,recentOrder=null,dockHeight=0,allButton=null,dockTitle=null,dockSort=null;
  const OVERLAY_WIDTH=430,RECENT_LIMIT=4;
  let sortKey="time",sortDir=-1,headerNormal=null,headerConfirm=null,clearButton=null,sortTime=null,sortSize=null,yesButton=null,noButton=null,confirming=false,clearing=false;
  const CLEARABLE=d=>d.stopped&&!d.hasPartialData&&!d.hasBlockedData;
  let lastRender=0,snapshot=Object.freeze({active:0,progress:null,speed:0,state:"idle"}),batch=new Map(),fresh=new WeakSet();
  const number=x=>Number.isFinite(x)?Math.max(0,x):0;
  const current=()=>window.performance.now();
  function sample(d){
    return {active:!d.stopped&&!d.succeeded&&!d.error&&!d.canceled,success:!!d.succeeded,
      failed:!!d.error,canceled:!!d.canceled,known:!!d.hasProgress&&number(d.totalBytes)>0,
      total:number(d.totalBytes),bytes:number(d.currentBytes),speed:number(d.speed),time:number(Number(d.startTime)),
      name:String(d.target?.path||"").split(/[\\\\/]/).pop()||"Download"};
  }
  function summarize(entries){
    let active=0,known=true,total=0,bytes=0,rate=0,success=0,failed=0,canceled=0;
    for(const d of entries){
      if(d.active){active++;rate+=d.speed;}
      else if(d.success)success++;
      else if(d.failed)failed++;
      else canceled++;
      if(d.active||d.success){
        if(!d.known)known=false;
        else{total+=d.total;bytes+=d.success?d.total:Math.min(d.bytes,d.total);}
      }
    }
    return Object.freeze({active,progress:active?(known&&total>0?Math.min(.995,bytes/total):null):success&&!failed&&!canceled?1:null,
      speed:rate,state:active?"active":failed?"failed":canceled?"stopped":success?"complete":"idle",success,failed,canceled});
  }
  function sizeText(v,rate=false){
    const units=["B","KB","MB","GB","TB"];let i=0;
    while(v>=1000&&i<units.length-1){v/=1000;i++;}
    return (i&&v<100?v.toFixed(1):Math.round(v))+" "+units[i]+(rate?"/s":"");
  }
  function speedText(v){return sizeText(v,true);}
  function durationText(ms){
    if(ms<1000)return "<1 s";
    const sec=Math.round(ms/1000),h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;
    return (h?h+" h ":"")+(m?m+" min ":"")+s+" s";
  }
  function refreshStatistics(){if(cardOpen)renderRecent();if(dockOpen)renderDock();if(cardOpen||dockOpen)positionOverlays();}
  function sortBytes(v){return v.known?v.total:v.success?v.bytes:null;}
  function syncTheme(...targets){
    // Sample only on structural changes / opening, never on byte updates.
    // Zen stores actual compact palette on the toolbox; root overlays do
    // not inherit these local values. Copy the resolved theme tokens.
    const source=observedSidebar||get("navigator-toolbox")||root;
    const st=window.getComputedStyle(source);
    const surface=source.querySelector?.(".zen-toolbar-background");
    const native=surface?window.getComputedStyle(surface):null;
    const token=st.getPropertyValue("--zen-compact-mode-toolbar-background").trim();
    // Use the real rendered sidebar's paint if available, including a
    // workspace gradient. A transparent background must not obscure text.
    const color=native?.backgroundColor;
    const image=native?.backgroundImage;
    const solid=color&&color!=="transparent"&&!/^rgba\([^)]*,\s*0(?:\.0+)?\)$/.test(color);
    const paint=image&&image!=="none"?image+(solid?" "+color:""):solid?color:token;
    for(const n of targets){if(!n)continue;
      for(const [key,native] of [["--zr-native-surface","--zen-compact-mode-toolbar-background"],["--zr-native-outline","--zen-compact-mode-toolbar-outline-color"],["--zr-native-row","--zen-toolbar-element-bg"]]){
        const value=key==="--zr-native-surface"?paint:st.getPropertyValue(native).trim();
        if(value)n.style.setProperty(key,value);else n.style.removeProperty(key);
      }
      if(st.color)n.style.setProperty("--zr-native-fg",st.color);
    }
  }
    function visible(n){
    if(!n?.isConnected||n.hidden||n.collapsed)return false;
    const r=n.getBoundingClientRect(),st=window.getComputedStyle(n);
    return r.width>2&&r.height>2&&r.right>2&&r.left<window.innerWidth-2&&r.bottom>2&&r.top<window.innerHeight-2&&
      st.display!=="none"&&st.visibility!=="hidden"&&Number(st.opacity)!==0;
  }
  function onePlane(){
    return root.getAttribute("oneplane-active")==="true"&&window.innerWidth>=900&&
      !root.hasAttribute("customizing")&&root.getAttribute("inDOMFullscreen")!=="true"&&root.getAttribute("inFullscreen")!=="true";
  }
  function nativeAnchor(){
    const toolbox=get("navigator-toolbox");
    if(!toolbox)return null;
    // Never prefer Library or the menu in the footer: this control belongs
    // to the top of the native sidebar. Structural placement must not
    // depend on visibility (Compact Mode moves the entire sidebar).
    const top=get("zen-sidebar-top-buttons");
    const tabs=get("tabbrowser-tabs"),wrapper=get("zen-tabs-wrapper");
    for(const n of [top,tabs,wrapper]){
      if(n?.parentElement&&toolbox.contains(n)&&!n.closest?.("#zen-sidebar-foot-buttons,#zen-sidebar-bottom-buttons"))return {parent:n.parentElement,before:n};
    }
    // A different native layout still gets a top-of-toolbox slot.
    return {parent:toolbox,before:[...toolbox.children].find(n=>n!==node)||null};
  }
  function side(){
    if(onePlane())return "left";
    // Zen exposes the actual resolved side as a root attribute, while
    // the preference is a fallback during initialization.
    const value=root.getAttribute("zen-right-side");
    return value!==null&&value!=="false"?"right":value==="false"?"left":prefs.getBoolPref(SIDE,false)?"right":"left";
  }
  function dockRect(following=false){
    let resolved=side(),right=resolved==="right";const w=window.innerWidth;
    const native=node?.hasAttribute("data-zr-native")&&observedSidebar?.isConnected;
    // The toolbox's DOMRect includes Zen's actual animated CSS translate.
    // Even when titlebar visibility is hidden its geometry is available.
    // Clamp the inner edge to the viewport instead of reusing a stale
    // expanded x coordinate. Keep native y independent of the slide.
    if(native){
      const t=observedSidebar.getBoundingClientRect();
      // The physical toolbox side wins over a stale/empty root attribute.
      if(t.width>2&&t.width<w*.75){resolved=t.left+t.width/2>w/2?"right":"left";right=resolved==="right";}
      const edge=Math.max(0,Math.min(w,right?t.left:t.right));
      if(following&&lastDockRect?.side===resolved)return {...lastDockRect,edge,x:clamp(lastDockRect.x+edge-lastDockRect.edge,8,w-8)};
      const n=node.getBoundingClientRect(),i=icon.getBoundingClientRect();
      const y=n.height>0?n.top:(lastDockRect?.top??70),height=n.height||33;
      const iconY=i.height>0?i.top+i.height/2:y+height/2;
      const iconX=i.width>0?i.left+i.width/2:edge;
      const x=Math.max(8,Math.min(w-8,iconX));
      lastDockRect={edge,top:y,height,x,y:iconY,side:resolved,seedW:i.width||19,seedH:i.height||19};
      return lastDockRect;
    }
    if(node&&visible(node)){
      const n=node.getBoundingClientRect(),i=icon.getBoundingClientRect();
      lastDockRect={edge:right?n.left:n.right,top:n.top,height:n.height,x:i.left+i.width/2,y:i.top+i.height/2,side:side(),seedW:i.width||19,seedH:i.height||19};
      return lastDockRect;
    }
    if(lastDockRect?.side===side())return lastDockRect;
    const edge=right?w:0,top=70;
    return {edge,top,height:33,x:right?w-8:8,y:top+16.5,side:side()};
  }
  const clamp=(v,lo,hi)=>Math.max(lo,Math.min(Math.max(lo,hi),v));
  function setVar(n,k,v){if(n.style.getPropertyValue(k)!==v)n.style.setProperty(k,v);}
  function wavePath(width,side,l,r,topL,topR,bottomL,bottomR,rL,rR){
    // The approved demo's asymmetric cubic contour. All frames have
    // identical commands, so Gecko interpolates paths without JS ticks.
    const w=r-l,tl=topL,tr=topR,bl=bottomL,br=bottomR;
    const rl=Math.min(rL,w/2,Math.max(0,bl-tl)/2),rr=Math.min(rR,w/2,Math.max(0,br-tr)/2),k=.55228475;
    const point=(x,y)=>`${(side==="right"?x:width-x).toFixed(3)} ${y.toFixed(3)}`;
    const M=(x,y)=>"M "+point(x,y),C=(...p)=>"C "+point(p[0],p[1])+" "+point(p[2],p[3])+" "+point(p[4],p[5]);
    // Keep control points inside the straight-edge span. On a circular
    // seed these edges have zero length: no bulge or squared first frame.
    const h=x=>clamp(x,l+rl,r-rr),vL=y=>clamp(y,tl+rl,bl-rl),vR=y=>clamp(y,tr+rr,br-rr);
    const d=[
      M(r-rr,tr),
      C(h(r-w*.34),tr,h(l+w*.35),tl,l+rl,tl),
      C(l+rl*(1-k),tl,l,tl+rl*(1-k),l,tl+rl),
      C(l,vL(tl+(bl-tl)*.34),l,vL(bl-(bl-tl)*.25),l,bl-rl),
      C(l,bl-rl*(1-k),l+rl*(1-k),bl,l+rl,bl),
      C(h(l+w*.35),bl,h(r-w*.32),br,r-rr,br),
      C(r-rr*(1-k),br,r,br-rr*(1-k),r,br-rr),
      C(r,vR(br-(br-tr)*.33),r,vR(tr+(br-tr)*.33),r,tr+rr),
      C(r,tr+rr*(1-k),r-rr*(1-k),tr,r-rr,tr),"Z"
    ].join(" ");
    return `path("${d}")`;
  }
  const WAVE_EXTENSION=32;
  function panelGeometry(r,width,height,x,y){
    // The animated border box really includes the bridge to the sidebar.
    // Coordinates are measured from the far edge of the resting panel.
    // No translating a clipped rectangle through the gap.
    const extent=width+WAVE_EXTENSION;
    const edge=Number.isFinite(r.edge)?r.edge:r.x;
    const anchor=clamp(r.side==="right"?edge-x:x+width-edge,0,extent-13);
    const cy=clamp(r.y-y,1,Math.max(1,height-1));
    const strip=Math.min(12,cy,Math.max(0,height-cy));
    const bridge=Math.min(extent,anchor+12);
    const at="translate(0px,0px)",full="inset(0px 0px 0px 0px round 12px)";
    const dot=(p,rad,opacity)=>{
      const radius=Math.min(rad,cy,Math.max(.001,height-cy),Math.max(.001,extent-anchor));
      return [p,anchor-radius,anchor+radius,cy-radius,cy-radius,cy+radius,cy+radius,radius,radius,opacity];
    };
    const reach=(fraction)=>anchor*(1-fraction);
    const points=[
      dot(0,.35,0),
      dot(.045,1.7,1),
      dot(.095,Math.min(6,strip),1),
      [.18,reach(.22),bridge,cy-strip,cy-strip,cy+strip,cy+strip,strip,strip,1],
      [.30,reach(.67),bridge,Math.max(0,cy-strip*1.3),cy-strip,cy+strip,cy+strip,strip,strip,1],
      [.42,0,bridge,0,cy-strip,Math.max(cy+strip,height*.10),cy+strip,12,strip,1],
      [.55,0,bridge,0,Math.max(0,cy-strip)*.5,Math.max(cy+strip,height*.365),Math.max(cy+strip,height*.10),12,12,1],
      [.72,0,bridge,0,0,Math.max(cy+strip,height*.80),Math.max(cy+strip,height*.288),12,12,1],
      [.87,0,bridge,0,0,height,Math.max(cy+strip,height*.78),12,12,1],
      [.94,0,bridge,0,0,height,height,12,12,1],
      [1,0,width,0,0,height,height,12,12,1]
    ];
    const frames=points.map(([offset,l,rightEdge,tl,tr,bl,br,rl,rr,opacity])=>({
      offset,clipPath:wavePath(extent,r.side,l,rightEdge,tl,tr,Math.min(height,bl),Math.min(height,br),rl,rr),
      transform:at,opacity,easing:"cubic-bezier(.42,0,.58,1)"
    }));
    return {frames,at,full,x,y,width,height,extent,anchor,bridge};
  }
  function reverseWave(frames,progress=1){
    // Reverse the exact same contour and displacement, not a different
    // rectangular retract. When interrupted, start at the current segment.
    const p=clamp(progress,0,1);
    const out=frames.filter(f=>f.offset<p).reverse().map(f=>({...f,offset:p>0?(p-f.offset)/p:1}));
    return out;
  }
  function updateOverlayMask(r){
    if(!overlayLayer)return;
    // The wave lives in its own viewport layer. Its outer mask stops
    // exactly at the visible inner edge of native Zen's toolbox.
    // No changes to the browser's own stacking order or toolbar CSS.
    const native=!!node?.hasAttribute("data-zr-native")&&!!observedSidebar?.isConnected;
    const w=window.innerWidth,edge=clamp(r.edge,0,w);
    const left=native&&r.side==="left"?edge:0;
    const right=native&&r.side==="right"?w-edge:0;
    setVar(overlayLayer,"--zr-mask-left",left+"px");
    setVar(overlayLayer,"--zr-mask-right",right+"px");
  }
  function positionOverlays(following=false){
    if(!node||!dock||(!cardOpen&&!dockOpen&&current()>=overlayUntil))return;
    const r=dockRect(following),w=window.innerWidth,h=window.innerHeight,right=r.side==="right";
    updateOverlayMask(r);
    const width=Math.min(OVERLAY_WIDTH,Math.max(1,w-12));
    setVar(dock,"--zr-wave-extension",WAVE_EXTENSION+"px");
    const x=clamp(right?r.edge-width-8:r.edge+8,6,w-width-6);
    // Both modes share the same top and x. Full mode fills the remaining
    // viewport, including the real bottom margin, with an inner scroll area.
    const y=clamp(r.top,8,Math.max(8,h-160));
    setVar(dock,"--zr-overlay-width",width+"px");
    setVar(dock,"--zr-overlay-x",x+"px");setVar(dock,"--zr-overlay-y",y+"px");
    if(dock.getAttribute("data-side")!==r.side)dock.setAttribute("data-side",r.side);
    if(!following||!dockHeight)dockHeight=dock.offsetHeight||Math.max(1,h-y-12);
    setVar(dockBackdrop,"--zr-outside-left",(right?0:Math.max(0,r.edge))+"px");
    setVar(dockBackdrop,"--zr-outside-right",(right?Math.max(0,w-r.edge):0)+"px");
    return following?undefined:panelGeometry(r,width,dockHeight,x,y);
  }
  function cancelPanel(){
    ++panelToken;entering=false;
    if(panelAnimation){try{panelAnimation.cancel();}catch{}panelAnimation=null;}
    dock?.removeAttribute("data-entering");
  }
  function animatePanel(frames,duration,onDone){
    const token=++panelToken;
    const finish=()=>{if(token!==panelToken)return;panelAnimation=null;onDone?.();};
    if(reduced.matches||!dock?.animate){finish();return;}
    try{
      panelAnimation=dock.animate(frames,{duration,fill:"none",easing:"linear"});
      panelAnimation.finished.then(finish,()=>{});
    }catch{finish();}
  }
  function revealPanel(g){
    if(!g){entering=false;dock.removeAttribute("data-entering");armHide();return;}
    entering=true;dock.setAttribute("data-entering","true");
    animatePanel(g.frames,780,()=>{entering=false;dock?.removeAttribute("data-entering");armHide();});
  }
  function stopFollow(){
    if(followFrame)window.cancelAnimationFrame(followFrame);followFrame=0;followUntil=0;
  }
  function follow(ms=380){
    if(dead||!node||node.hasAttribute("data-fallback")||(!cardOpen&&!dockOpen&&current()>=overlayUntil))return;
    followUntil=Math.max(followUntil,current()+ms);
    if(followFrame)return;
    const tick=()=>{
      followFrame=0;
      if(dead||!node||(!cardOpen&&!dockOpen&&current()>=overlayUntil))return;
      positionOverlays(true);
      if(current()<followUntil)followFrame=window.requestAnimationFrame(tick);
    };
    followFrame=window.requestAnimationFrame(tick);
  }
  function mount(){
    if(!node||dead)return;
    const one=onePlane(),slot=one&&(host?.isConnected?host:get("oneplane-download-indicator-slot"));
    const placement=!one?nativeAnchor():null;
    const toolbox=get("navigator-toolbox");
    const native=!!placement;
    const parent=slot||placement?.parent||root;
    const before=placement?.before;
    anchor=before||null;
    const changed=node.parentElement!==parent||(native&&!!before&&before!==node&&node.nextElementSibling!==before);
    const oldSide=node.getAttribute("data-side");
    if(changed){
      if(native&&before&&before!==node)parent.insertBefore(node,before);
      else if(native&&!before)parent.append(node);
      else parent.append(node);
    }
    node.toggleAttribute("data-zr-hosted",!!slot);
    node.toggleAttribute("data-zr-native",native);
    node.toggleAttribute("data-zr-oneplane",!!one&&!slot);
    node.setAttribute("data-side",side());
    syncSidebarHold();
    // Only OnePlane without a host (or an unsupported missing toolbox)
    // uses the floating fallback. A hidden native sidebar never reparents.
    node.toggleAttribute("data-fallback",!slot&&!native);
    root.toggleAttribute("data-zr-downloads-native",native);
    if(changed||(oldSide&&oldSide!==side())){lastDockRect=null;syncTheme(node,dock); }
    if(toolbox!==observedSidebar){
      resizeObserver?.disconnect();observedSidebar=toolbox;if(toolbox)resizeObserver?.observe(toolbox);
      if(dock)resizeObserver?.observe(dock);
    }
    // Cache the last visible location on structural/visibility changes.
    if(cardOpen||dockOpen||current()<overlayUntil){positionOverlays();follow();}
    else updateOverlayMask(dockRect());
    if(flight&&(changed||(oldSide&&oldSide!==side()))){cancelFlight();openCard();}
  }
  function scheduleMount(){
    if(dead||!node||layoutFrame)return;
    layoutFrame=window.requestAnimationFrame(()=>{layoutFrame=0;mount();});
  }
  function setHost(next){
    if(next!==null&&(!next?.isConnected||next.ownerDocument!==document||node?.contains(next)))return false;
    host=next;mount();return true;
  }
  function trackClick(event){
    if(event.isTrusted===false||event.button!==0)return;
    lastClick={x:event.clientX,y:event.clientY,at:current()};
  }
  function trackLayout(event){
    const n=event.target;
    if(n===observedSidebar||n===anchor||n===get("zen-appcontent-navbar-wrapper")||n===get("zen-main-app-wrapper")){
      if(event.type==="transitionrun"||event.type==="transitionstart")follow(420);else scheduleMount();
    }
  }
  function makeTrack(){
    const track=make("span","zr-download-track"),f=make("span","zr-download-fill");track.append(f);return [track,f];
  }
  function build(){
    node=make("button","zr-download-indicator");node.id="zr-download-indicator";node.type="button";
    node.setAttribute("aria-label","Show download details");node.setAttribute("title","Downloads");node.setAttribute("aria-expanded","false");node.setAttribute("data-state","idle");
    speed=make("span","zr-download-speed");
    icon=make("span","zr-download-icon");icon.setAttribute("aria-hidden","true");
    const [track,f]=makeTrack();fill=f;node.append(speed,icon,track);
    node.addEventListener("click",()=>{
      cancelFlight();
      if(dockOpen||cardOpen&&manualHold)closeDock();
      else if(cardOpen)pinPanel(true);
      else openCard(true);
    });
    buildDock();
    resizeObserver=typeof ResizeObserver==="function"?new ResizeObserver(scheduleMount):null;
    mount();
    layoutObserver=new MutationObserver(records=>{
      if(records.some(r=>{
        if(r.target===node||r.target===dock||r.target===dockBackdrop||r.target===overlayLayer||node.contains(r.target)||dock?.contains(r.target))return false;
        const selector="#navigator-toolbox,#zen-sidebar-top-buttons,#zen-tabs-wrapper,#tabbrowser-tabs,#oneplane-download-indicator-slot";
        const relevant=n=>n?.nodeType===1&&(n.matches?.(selector)||n.querySelector?.(selector));
        if(r.type==="attributes")return r.target===root||r.target===observedSidebar||r.target===anchor||r.target.matches?.(selector);
        return [...r.addedNodes,...r.removedNodes].some(n=>n!==node&&n!==dock&&relevant(n));
      }))scheduleMount();
    });
    layoutObserver.observe(root,{attributes:true,attributeFilter:["oneplane-active","customizing","zen-right-side","zen-compact-mode","zen-compact-animating","zen-sidebar-expanded","zen-has-hover","hidden","collapsed"],childList:true});
    const toolbox=get("navigator-toolbox");
    if(toolbox)layoutObserver.observe(toolbox,{subtree:true,childList:true,attributes:true,attributeFilter:["hidden","collapsed","zen-has-hover","zen-user-show","zen-has-empty-tab","flash-popup","has-popup-menu","movingtab","zen-compact-mode-active","zen-sidebar-expanded","animate"]});
    window.addEventListener("resize",scheduleMount);window.addEventListener("OnePlane:DownloadHostChanged",scheduleMount);
    window.addEventListener("ZenCompactMode:LayoutUpdate",scheduleMount);window.addEventListener("ZenCompactMode:Toggled",scheduleMount);
    for(const type of ["transitionrun","transitionstart","transitionend","transitioncancel"])window.addEventListener(type,trackLayout,true);
    window.addEventListener("pointerdown",trackClick,true);window.addEventListener("pointerdown",outsideDock,true);
    window.addEventListener("keydown",onKey,true);prefs.addObserver(SIDE,scheduleMount);prefs.addObserver(STATS_PREF,refreshStatistics);
  }
  function action(label,cls,handler){
    const b=make("button",cls);b.type="button";b.textContent=label;b.addEventListener("click",handler);return b;
  }
  function buildDock(){
    dockBackdrop=make("div","zr-download-outside");dockBackdrop.id="zr-download-outside";
    dockBackdrop.addEventListener("pointerdown",e=>{e.preventDefault();closeDock();});
    dock=make("section","zr-download-dock");dock.id="zr-download-dock";
    dock.setAttribute("role","region");dock.setAttribute("aria-label","Recent downloads");dock.setAttribute("aria-hidden","true");dock.inert=true;
    const header=make("div","zr-dock-header");dockTitle=make("span","zr-dock-title");
    dockTitle.textContent="Recent downloads";
    headerNormal=make("div","zr-dock-header-normal");headerConfirm=make("div","zr-dock-header-confirm");headerConfirm.hidden=true;
    const actions=make("div","zr-dock-header-actions");
    allButton=action("All downloads","zr-dock-all",()=>openDock(true));
    clearButton=action("Clear","zr-dock-clear",()=>setConfirm(true));clearButton.disabled=true;clearButton.hidden=true;
    const close=action("×","zr-dock-close",()=>closeDock(true));close.setAttribute("aria-label","Close downloads");close.setAttribute("title","Close downloads");
    actions.append(allButton,clearButton,close);headerNormal.append(dockTitle,actions);
    yesButton=action("Yes","zr-dock-yes",()=>void clearHistory());
    noButton=action("No","zr-dock-no",()=>setConfirm(false,true));
    const question=make("span","zr-dock-question");question.textContent="Clear downloads?";
    question.setAttribute("title","Remove finished entries only. Files on disk are kept.");
    headerConfirm.append(yesButton,question,noButton);header.append(headerNormal,headerConfirm);
    dockSort=make("div","zr-dock-sort");dockSort.hidden=true;
    sortTime=action("Time ↓","zr-dock-sort-time",()=>changeSort("time"));
    sortSize=action("Size","zr-dock-sort-size",()=>changeSort("size"));dockSort.append(sortTime,sortSize);
    dockList=make("div","zr-dock-list");dockList.setAttribute("role","list");
    dockEmpty=make("div","zr-dock-empty");dockEmpty.textContent="No downloads yet";
    dockNotice=make("div","zr-dock-notice");dockNotice.setAttribute("role","status");
    dockMore=action("Show more","zr-dock-more",()=>{limit+=30;renderDock();positionOverlays();});
    dockMore.hidden=true;
    dock.append(header,dockSort,dockList,dockEmpty,dockMore,dockNotice);
    dock.addEventListener("click",e=>{if(cardOpen&&!e.target.closest?.("button")&&e.target.closest?.(".zr-dock-row,.zr-dock-title"))openDock(true);});
    dock.addEventListener("pointerdown",e=>{if(cardOpen&&e.button===0&&!e.target.closest?.(".zr-dock-close"))pinPanel();});
    dock.addEventListener("pointerenter",cancelHide);
    dock.addEventListener("pointerleave",()=>armHide(true));
    overlayLayer=make("div","zr-download-layer");overlayLayer.id="zr-download-layer";
    overlayLayer.append(dock);root.append(dockBackdrop,overlayLayer);updateSort();
  }
  function updateSort(){
    for(const [button,key,title] of [[sortTime,"time","Time"],[sortSize,"size","Size"]]){
      if(!button)continue;
      const active=sortKey===key;
      button.textContent=title+(active?(sortDir<0?" ↓":" ↑"):"");
      button.setAttribute("aria-pressed",String(active));
      button.setAttribute("title",active?(sortDir<0?"Descending — click for ascending":"Ascending — click for descending"):"Sort by "+title.toLowerCase());
    }
  }
  function changeSort(key){
    if(sortKey===key)sortDir=-sortDir;else{sortKey=key;sortDir=-1;}
    historyOrder=null;updateSort();renderDock();
  }
  function setConfirm(value,restore=false){
    if(!headerNormal||!headerConfirm)return;
    if(value&&(clearing||!dockOpen||![...history.keys()].some(CLEARABLE)))return;
    confirming=value;
    headerNormal.hidden=value;headerConfirm.hidden=!value;
    if(value){yesButton.disabled=false;noButton.disabled=false;noButton.focus?.({preventScroll:true});}
    else if(restore&&dockOpen)clearButton.focus?.({preventScroll:true});
  }
  async function clearHistory(){
    if(!confirming||clearing||!list)return;
    const source=list,token=epoch;
    const targets=[...history.keys()].filter(CLEARABLE);
    clearing=true;yesButton.disabled=true;noButton.disabled=true;
    let failures=0;
    try{
      // Native session list only. No Places deletion, finalize(), file
      // deletion, cancellation or manipulation of partial/blocked files.
      for(const d of targets){
        if(dead||token!==epoch||list!==source)break;
        if(!CLEARABLE(d)||!history.has(d))continue;
        try{await source.remove(d);}catch{failures++;}
      }
    }finally{
      if(!dead&&token===epoch&&list===source){
        clearing=false;setConfirm(false,true);
        if(dockNotice)dockNotice.textContent=failures?"Some entries could not be cleared.":"";
        schedule(true);
      }
    }
  }
  function outsideDock(e){
    if(!dockOpen&&!(cardOpen&&manualHold))return;
    const path=e.composedPath?.()||[];
    if(path.includes(dock)||path.includes(node)||dock.contains(e.target)||node.contains(e.target))return;
    closeDock();
  }
  function closeDock(restoreFocus=false){
    if(!dock||(!dockOpen&&!cardOpen))return;
    cancelHide();
    const previous=window.getComputedStyle(dock);
    const progress=entering&&panelAnimation?clamp(Number(panelAnimation.currentTime)/780,0,1):1;
    const startClip=previous.clipPath,startTransform=previous.transform==="none"?"translate(0px,0px)":previous.transform;
    const startOpacity=Number(previous.opacity);
    const g=positionOverlays();
    cancelPanel();
    // Keep native Compact Mode held through the ENTIRE closing wave.
    dock.setAttribute("data-closing","true");
    cardOpen=dockOpen=false;setConfirm(false);
    overlayUntil=current()+800;dock.removeAttribute("data-open");dockBackdrop?.removeAttribute("data-open");
    dock.inert=true;dock.setAttribute("aria-hidden","true");
    node?.setAttribute("aria-expanded","false");updateLive();
    if(restoreFocus&&visible(node))node.focus?.({preventScroll:true});
    const done=()=>{dock?.removeAttribute("data-closing");manualHold=false;sidebarOrigin=false;syncSidebarHold();};
    if(!g||progress<=0){done();return;}
    const reverse=reverseWave(g.frames,progress);
    const start=progress<1&&startClip.startsWith("path(")?
      {clipPath:startClip,transform:startTransform,opacity:Number.isFinite(startOpacity)?startOpacity:1}:
      {...g.frames.at(-1)};
    animatePanel([{...start,offset:0,easing:"cubic-bezier(.42,0,.58,1)"},...reverse],Math.max(1,780*progress),done);
    follow(800);
  }
  function setPanelMode(full){
    cardOpen=!full;dockOpen=full;
    dock.toggleAttribute("data-full",full);
    dockTitle.textContent=full?"Downloads":"Recent downloads";
    dock.setAttribute("aria-label",dockTitle.textContent);
    dock.setAttribute("role",full?"dialog":"region");
    allButton.hidden=full;clearButton.hidden=!full;dockSort.hidden=!full;
    dockMore.hidden=true;setConfirm(false);
    if(full)renderDock();else renderRecent();
  }
  function openDock(){
    if(!dock||dead||dockOpen)return;
    cancelHide();cancelFlight();
    // Full mode pins the downloads surface but must not acquire a native
    // sidebar hold. Preserve its original opening source.
    manualHold=true;
    const wasRecent=cardOpen;
    const before=wasRecent?{height:dock.offsetHeight,listY:dockList.getBoundingClientRect().top}:null;
    const keyboardFocus=document.activeElement===allButton;
    cancelPanel();dock.removeAttribute("data-closing");
    limit=30;sortKey="time";sortDir=-1;historyOrder=null;updateSort();
    setPanelMode(true);syncTheme(dock);updateLive();
    const g=positionOverlays();
    dock.setAttribute("data-open","true");dock.inert=false;dock.setAttribute("aria-hidden","false");
    dockBackdrop.setAttribute("data-open","true");node.setAttribute("aria-expanded","true");
    if(before&&g&&!reduced.matches){
      // One element, one row cache. Reveal the extra height without
      // restarting the entrance or changing the shared top/width.
      const bottom=Math.max(0,g.height-before.height);
      animatePanel([
        {clipPath:`inset(0px 0px ${bottom}px 0px round 12px)`,transform:g.at,opacity:1,offset:0,easing:"cubic-bezier(.3,.7,.2,1)"},
        {clipPath:g.full,transform:g.at,opacity:1,offset:1}
      ],420);
      const shift=before.listY-dockList.getBoundingClientRect().top;
      if(shift)try{dockList.animate([{transform:`translateY(${shift}px)`},{transform:"translateY(0px)"}],{duration:340,easing:"cubic-bezier(.3,.7,.2,1)"});}catch{}
      try{dockSort.animate([{opacity:0},{opacity:1}],{duration:340,easing:"ease-out"});}catch{}
    }else if(!wasRecent)revealPanel(g);
    if(keyboardFocus)clearButton.focus?.({preventScroll:true});
    follow(450);
  }
  function showActionError(message){
    const notice=dockOpen||cardOpen?dockNotice:null;
    if(notice)notice.textContent=message;
  }
  function makeRow(download){
    const el=make("div","zr-dock-row");el.setAttribute("role","listitem");
    const glyph=make("span","zr-download-icon"),body=make("div","zr-dock-row-body"),name=make("div","zr-dock-name"),meta=make("div","zr-dock-meta");
    glyph.setAttribute("aria-hidden","true");
    const [track,fill]=makeTrack();
    const stats=make("div","zr-dock-stats");stats.hidden=true;
    const actions=make("div","zr-dock-row-actions");
    const open=action("Open","zr-dock-open-file",async()=>{
      // Explicit user click only; Gecko handles the target and OS policy.
      try{
        if(!download.succeeded||download.target?.exists===false||typeof download.launch!=="function")return;
        await download.launch();
      }catch{showActionError("Could not open the downloaded file.");}
    });
    const folder=action("Show in folder","zr-dock-folder",async()=>{
      // Gecko owns path resolution and platform file-manager integration.
      // No shell command, arbitrary path, or executable launch.
      try{
        if(!download.succeeded||typeof download.showContainingDirectory!=="function")return;
        await download.showContainingDirectory();
      }catch{showActionError("Could not open the containing folder.");}
    });
    open.setAttribute("title","Open downloaded file");folder.setAttribute("title","Show in folder");
    body.append(name,meta,stats,track);actions.append(open,folder);el.append(glyph,body,actions);
    return {el,name,meta,stats,track,fill,open,folder};
  }
  function renderDock(){
    if(!dockOpen||!dockList)return;
    // Keep all native session-list entries in memory; render only a
    // bounded page, active items first, then newest first. Reuse rows.
    if(!historyOrder){
      historyOrder=[...history.keys()].reverse();
      historyOrder.sort((a,b)=>{
        const av=history.get(a),bv=history.get(b);
        if(sortKey==="size"){
          const active=Number(bv.active)-Number(av.active);if(active)return active;
          const x=sortBytes(av),y=sortBytes(bv);
          if(x===null||y===null){if(x!==y)return x===null?1:-1;}
          else if(x!==y)return sortDir*(x-y);
        }
        if(av.time!==bv.time)return (sortKey==="time"?sortDir:-1)*(av.time-bv.time);
        return 0;
      });
    }
    const entries=historyOrder;
    renderRows(dockList,rows,entries.slice(0,limit));
    dockEmpty.hidden=entries.length>0;dockMore.hidden=entries.length<=limit;
    clearButton.disabled=clearing||![...history.keys()].some(CLEARABLE);
  }
  function renderRecent(){
    if(!cardOpen||!dockList)return;
    if(!recentOrder)recentOrder=[...history.keys()].reverse().sort((a,b)=>history.get(b).time-history.get(a).time).slice(0,RECENT_LIMIT);
    renderRows(dockList,rows,recentOrder);
    dockEmpty.hidden=recentOrder.length>0;
  }
  function renderRows(container,rowCache,wanted){
    const keep=new Set(wanted);
    for(const [d,row] of rowCache)if(!keep.has(d)){row.el.remove();rowCache.delete(d);}
    const showStats=prefs.getBoolPref(STATS_PREF,true);
    let index=0;
    for(const d of wanted){
      const v=history.get(d);
      let row=rowCache.get(d);
      if(!row){row=makeRow(d);rowCache.set(d,row);}
      const text=v.active?sizeText(v.bytes)+(v.known?" / "+sizeText(v.total):"")+" · "+speedText(v.speed):
        v.success?"Complete · "+sizeText(v.total||v.bytes):v.failed?"Failed":"Stopped";
      if(row.name.textContent!==v.name)row.name.textContent=v.name;
      if(row.tooltipTime!==v.time||row.tooltipName!==v.name){
        row.tooltipTime=v.time;row.tooltipName=v.name;
        const description=v.name+(v.time?" — "+new Date(v.time).toLocaleString():"");
        row.el.setAttribute("title",description);row.name.setAttribute("title",description);
      }
      if(row.meta.textContent!==text)row.meta.textContent=text;
      row.el.setAttribute("data-state",v.active?"active":v.success?"complete":v.failed?"failed":"stopped");
      row.el.toggleAttribute("data-indeterminate",v.active&&!v.known);
      setVar(row.fill,"--zr-download-progress",String(v.known?Math.min(1,v.bytes/v.total):0));
      row.folder.disabled=!v.success||typeof d.showContainingDirectory!=="function";
      row.open.hidden=!v.success;
      row.open.disabled=!v.success||d.target?.exists===false||typeof d.launch!=="function";
      const statistics=showStats&&v.success&&v.duration>0;
      row.stats.hidden=!statistics;
      if(statistics){
        const statsText="Avg. "+speedText((v.total||v.bytes)*1000/v.duration)+" · "+durationText(v.duration);
        if(row.stats.textContent!==statsText)row.stats.textContent=statsText;
        row.stats.title="Average over elapsed time, including pauses";
      }
      if(container.children[index]!==row.el)container.insertBefore(row.el,container.children[index]||null);
      index++;
    }
  }
  function cancelHide(){if(hideTimer)window.clearTimeout(hideTimer);hideTimer=0;}
  function armHide(pointerLeft=false){
    cancelHide();
    // Pointer alone controls the recent timeout; button focus must not
    // keep it alive after the mouse leaves. Full mode never auto-dismisses.
    if(!cardOpen||manualHold||entering||(!pointerLeft&&dock?.matches(":hover")))return;
    hideTimer=window.setTimeout(()=>{hideTimer=0;if(cardOpen&&!manualHold&&!dock.matches(":hover"))closeDock();},HOLD);
  }
  function onKey(e){if(e.key==="Escape"){if(dockOpen&&confirming&&!clearing)setConfirm(false,true);else if(dockOpen||cardOpen)closeDock(true);}}
  function closeCard(){if(cardOpen)closeDock();}
  function syncSidebarHold(){
    // Zen watches native sidebar descendants with [panelopen] and
    // owns zen-compact-mode-active. We own only our button's attribute.
    const hold=!dead&&sidebarOrigin&&!!node?.hasAttribute("data-zr-native")&&!!(cardOpen||dockOpen||dock?.hasAttribute("data-closing"));
    if(node&&node.hasAttribute("panelopen")!==hold)node.toggleAttribute("panelopen",hold);
  }
  function updateLive(){
    node?.toggleAttribute("data-live",snapshot.active>0||cardOpen||dockOpen||!!flight);
    syncSidebarHold();
  }
  function pinPanel(fromIndicator=false){
    if(!cardOpen&&!dockOpen)return;
    // A click inside an auto notification pins only the downloads surface.
    // Only an explicit indicator click is allowed to acquire the sidebar.
    manualHold=true;if(fromIndicator)sidebarOrigin=true;
    cancelHide();syncSidebarHold();follow(800);
  }
  function openCard(manual=false){
    if(!dock||!node||dead||dockOpen)return;
    if(cardOpen){if(manual)pinPanel(true);renderRecent();armHide();return;}
    if(!manual&&dock.hasAttribute("data-closing"))return;
    cancelHide();cancelPanel();dock.removeAttribute("data-closing");manualHold=manual;sidebarOrigin=manual;
    dockNotice.textContent="";setPanelMode(false);syncTheme(dock);updateLive();
    const g=positionOverlays();
    dock.setAttribute("data-open","true");dock.setAttribute("aria-hidden","false");dock.inert=false;
    node.setAttribute("aria-expanded","true");
    revealPanel(g);follow(800);
  }
  function cancelFlight(){
    ++flightToken;
    if(flightTimer)window.clearTimeout(flightTimer);flightTimer=0;
    if(flightAnimation)try{flightAnimation.cancel();}catch{}
    flightAnimation=null;flight?.remove();flight=null;updateLive();
  }
  function launchFlight(){
    if(dead||!node)return;
    cancelFlight();if(dockOpen||dock?.hasAttribute("data-closing"))return;if(cardOpen){renderRecent();armHide();return;}mount();
    const activeWindow=!document.hasFocus||document.hasFocus();
    if(!activeWindow)return;
    node.setAttribute("data-live","true");
    if(reduced.matches){openCard();return;}
    const r=dockRect(),tx=r.x,ty=r.y;updateOverlayMask(r);
    const native=window.gZenUIManager?._lastClickPosition;
    const click=lastClick&&current()-lastClick.at<5000?lastClick:
      native&&Number.isFinite(native.clientX)&&Number.isFinite(native.clientY)?{x:native.clientX,y:native.clientY}:null;
    const x=Math.max(12,Math.min(window.innerWidth-12,click?.x??window.innerWidth/2));
    const y=Math.max(12,Math.min(window.innerHeight-12,click?.y??window.innerHeight*.45));
    const dx=tx-x,dy=ty-y,arc=Math.min(86,Math.hypot(dx,dy)*.14);
    const token=flightToken;
    flight=make("span","zr-download-flight");flight.setAttribute("aria-hidden","true");
    const glyph=make("span","zr-download-icon");flight.append(glyph);
    flight.style.setProperty("left",x+"px");flight.style.setProperty("top",y+"px");overlayLayer.append(flight);syncTheme(flight);
    try{
      // A short compositor-friendly curved flight; no frame callbacks,
      // no bouncing, and the card opens only after it reaches the icon.
      const frames=[
        {transform:"translate(-50%,-50%) scale(.45)",opacity:0,offset:0},
        {transform:"translate(calc(-50% + "+dx*.12+"px),calc(-50% + "+(dy*.12-arc*.42)+"px)) scale(1)",opacity:1,offset:.26},
        {transform:"translate(calc(-50% + "+dx*.72+"px),calc(-50% + "+(dy*.72-arc*.62)+"px)) scale(.86)",opacity:1,offset:.73},
        {transform:"translate(calc(-50% + "+dx+"px),calc(-50% + "+dy+"px)) scale(.4)",opacity:.12,offset:1}
      ];
      flightAnimation=flight.animate(frames,{duration:780,easing:"cubic-bezier(.32,.04,.25,1)",fill:"forwards"});
      const land=()=>{if(dead||token!==flightToken)return;cancelFlight();openCard();};
      flightTimer=window.setTimeout(land,940);
      flightAnimation.finished.then(land,land);
    }catch{cancelFlight();openCard();}
  }
  function paint(){
    updateTimer=0;if(dead||!node)return;
    lastRender=current();snapshot=summarize(batch.values());const s=snapshot;
    node.setAttribute("data-state",s.state);
    updateLive();
    node.toggleAttribute("data-transferring",s.active>0);
    node.toggleAttribute("data-indeterminate",s.state==="active"&&s.progress===null);
    if(s.progress!==null)setVar(fill,"--zr-download-progress",String(s.progress));
    else fill.style.removeProperty("--zr-download-progress");
    const text=s.active?speedText(s.speed):"";
    if(speed.textContent!==text)speed.textContent=text;
    if(cardOpen)renderRecent();
    if(dockOpen)renderDock();
    // No geometry reads on ordinary transfer updates.
  }
  function schedule(immediate=false){
    if(dead||!node||hydrating)return;
    if(immediate){if(updateTimer)window.clearTimeout(updateTimer);paint();return;}
    if(!updateTimer)updateTimer=window.setTimeout(paint,Math.max(0,RATE-(current()-lastRender)));
  }
  function changed(d){
    if(dead||!node)return;
    const previous=batch.get(d),next=sample(d);
    const old=history.get(d);
    // Completion time is observed only for new session downloads; do not
    // invent a duration for restored completed history.
    if(old?.duration>0&&next.success)next.duration=old.duration;
    else if(!hydrating&&fresh.has(d)&&next.success&&next.time>0&&(!old||!old.success)){
      const elapsed=Date.now()-next.time;
      if(elapsed>0)next.duration=elapsed;
    }
    if(!old||old.time!==next.time)recentOrder=null;
    if(!old||old.active!==next.active||old.time!==next.time||sortKey==="size"&&sortBytes(old)!==sortBytes(next))historyOrder=null;
    history.set(d,next);
    if(next.active){
      if(!previous?.active){
        // A new batch after completion starts with clean totals.
        if(![...batch.values()].some(x=>x.active)){batch.clear();cancelHide();}
        batch.set(d,next);latest=d;schedule(!hydrating);if(!hydrating)launchFlight();return;
      }
      batch.set(d,next);schedule();return;
    }
    // Initial addView replays history. Only a transfer observed active in
    // this window can become a terminal notification.
    if(previous?.active){batch.set(d,next);latest=d;schedule(true);}
    else if(!hydrating&&!previous&&(next.success||next.failed)&&fresh.has(d)){
      if(![...batch.values()].some(x=>x.active))batch.clear();
      batch.set(d,next);latest=d;schedule(true);launchFlight();
    }else if(dockOpen||cardOpen)schedule();
  }
  function added(d){if(!hydrating)fresh.add(d);changed(d);}
  function removed(d){if(history.delete(d)){historyOrder=null;recentOrder=null;}if(batch.delete(d)){if(latest===d)latest=null;schedule(true);}else if(dockOpen||cardOpen)schedule();}
  function teardown(){
    ++epoch;
    if(updateTimer)window.clearTimeout(updateTimer);updateTimer=0;cancelHide();cancelFlight();cancelPanel();cardOpen=dockOpen=false;manualHold=false;sidebarOrigin=false;dock?.removeAttribute("data-closing");syncSidebarHold();stopFollow();overlayUntil=0;
    if(layoutFrame)window.cancelAnimationFrame(layoutFrame);layoutFrame=0;
    resizeObserver?.disconnect();resizeObserver=null;observedSidebar=anchor=null;
    if(list&&view)try{list.removeView(view);}catch{}
    list=view=null;hydrating=false;
    layoutObserver?.disconnect();layoutObserver=null;
    window.removeEventListener("resize",scheduleMount);window.removeEventListener("OnePlane:DownloadHostChanged",scheduleMount);
    window.removeEventListener("ZenCompactMode:LayoutUpdate",scheduleMount);window.removeEventListener("ZenCompactMode:Toggled",scheduleMount);
    for(const type of ["transitionrun","transitionstart","transitionend","transitioncancel"])window.removeEventListener(type,trackLayout,true);
    window.removeEventListener("pointerdown",trackClick,true);window.removeEventListener("pointerdown",outsideDock,true);window.removeEventListener("keydown",onKey,true);
    try{prefs.removeObserver(SIDE,scheduleMount);}catch{}
    try{prefs.removeObserver(STATS_PREF,refreshStatistics);}catch{}
    node?.remove();node=fill=speed=icon=null;host=null;batch.clear();fresh=new WeakSet();latest=lastClick=null;
    dock?.remove();overlayLayer?.remove();dockBackdrop?.remove();dock=dockList=dockEmpty=dockMore=dockBackdrop=dockNotice=overlayLayer=null;history.clear();rows.clear();historyOrder=recentOrder=null;limit=30;dockHeight=0;allButton=dockTitle=dockSort=null;
    sortKey="time";sortDir=-1;headerNormal=headerConfirm=clearButton=sortTime=sortSize=yesButton=noButton=null;confirming=clearing=false;
    snapshot=Object.freeze({active:0,progress:null,speed:0,state:"idle"});
    root.removeAttribute(ACTIVE);root.removeAttribute("data-zr-downloads-native");lastDockRect=null;
  }
  async function install(){
    if(dead||node||!enabled())return;
    const token=++epoch;
    try{
      const Downloads=window.Downloads||ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs").Downloads;
      const PB=ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs").PrivateBrowsingUtils;
      const source=await Downloads.getList(PB.isWindowPrivate(window)?Downloads.PRIVATE:Downloads.PUBLIC);
      if(dead||token!==epoch||!enabled()||window.closed)return;
      build();list=source;hydrating=true;
      view={onDownloadAdded:added,onDownloadChanged:changed,onDownloadRemoved:removed};
      await list.addView(view);
      if(dead||token!==epoch||list!==source)return;
      hydrating=false;
      // Hide only this window's confusing native flight. Do not write the
      // global zen.downloads.download-animation preference or patch Zen.
      root.setAttribute(ACTIVE,"true");
      schedule(true);
    }catch(error){console.warn("[Zen Refined] Download indicator:",error);teardown();}
  }
  function sync(){if(!initialized||dead)return;if(enabled())void install();else teardown();}
  function start(){initialized=true;sync();}
  function dispose(){
    if(dead)return;dead=true;teardown();
    if(readyObserver)try{Services.obs.removeObserver(readyObserver,"browser-delayed-startup-finished");}catch{}
    readyObserver=null;try{prefs.removeObserver(PREF,sync);}catch{}
    window.removeEventListener("unload",dispose);
    if(window[KEY]===api)delete window[KEY];
  }
  const api={getSnapshot:()=>snapshot,setHost,dispose};
  window[KEY]=api;window.addUnloadListener(dispose);window.addEventListener("unload",dispose,{once:true});
  prefs.addObserver(PREF,sync);
  if(window.gBrowserInit?.delayedStartupFinished)start();
  else{readyObserver=subject=>{if(subject!==window)return;Services.obs.removeObserver(readyObserver,"browser-delayed-startup-finished");readyObserver=null;start();};Services.obs.addObserver(readyObserver,"browser-delayed-startup-finished");}
})();
