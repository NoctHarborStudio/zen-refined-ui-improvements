/* Zen Refined — Download Indicator. Native download events, no polling,
 * no interception of downloads, no file/network access. One view per window.
 * A future OnePlane Extension Dock can host the same view via setHost(). */
(() => {
  const root=document.documentElement,prefs=Services.prefs;
  const PREF="zen.refined.downloads.indicator",STATS_PREF="zen.refined.downloads.statistics",KEY="__zenRefinedDownloadIndicator";
  const NS="http://www.w3.org/1999/xhtml",ACTIVE="data-zr-downloads-active";
  const make=(tag,cls)=>{const n=document.createElementNS(NS,tag);if(cls)n.className=cls;return n;};
  const get=id=>document.getElementById(id);
  const RATE=200,HOLD=3000,SIDE="zen.tabs.vertical.right-side";
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
  const enabled=()=>prefs.getBoolPref(PREF,true);
  if(root.hasAttribute("popup-window")||typeof window.addUnloadListener!=="function")return;
  window[KEY]?.dispose?.();
  let dead=false,epoch=0,view=null,list=null,node=null,fill=null,speed=null,icon=null,host=null;
  let card=null,cardList=null,cardEmpty=null,cardNotice=null,flight=null,flightAnimation=null;
  let layoutFrame=0,resizeObserver=null,observedSidebar=null,anchor=null,lastClick=null,cardOpen=false,flightToken=0,flightTimer=0,latest=null;
  let updateTimer=0,hideTimer=0,readyObserver=null,layoutObserver=null,initialized=false,hydrating=false;
  let lastDockRect=null,followFrame=0,followUntil=0,overlayUntil=0;
  let dock=null,dockList=null,dockEmpty=null,dockMore=null,dockBackdrop=null,dockNotice=null,dockOpen=false,limit=30;
  const history=new Map(),rows=new Map(),recentRows=new Map();
  let historyOrder=null,recentOrder=null,cardHeight=0,dockHeight=0,dockFromCard=false;
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
  function positionOverlay(n,r,width,height){
    const right=r.side==="right",w=window.innerWidth,h=window.innerHeight;
    const x=clamp(right?r.edge-width-8:r.edge+8,6,w-width-6);
    const y=clamp(r.top,8,h-height-8);
    // Separate positioning translate from entrance transform. No extra
    // CSS transition on the position: both surfaces follow native motion.
    setVar(n,"--zr-overlay-x",x+"px");setVar(n,"--zr-overlay-y",y+"px");
    setVar(n,"--zr-overlay-width",width+"px");
    n.setAttribute("data-side",r.side);
    return {x,y,width,height};
  }
  function seedOverlay(n,box,source){
    // Clip a seed matching the source size, then translate that seed to
    // its real origin. The full overlay layout never scales or reflows.
    const sw=Math.min(box.width,Math.max(1,source.width)),sh=Math.min(box.height,Math.max(1,source.height));
    const sx=clamp(source.x-box.x,0,box.width-sw),sy=clamp(source.y-box.y,0,box.height-sh);
    setVar(n,"--zr-seed-clip",`inset(${sy}px ${Math.max(0,box.width-sx-sw)}px ${Math.max(0,box.height-sy-sh)}px ${sx}px round ${source.radius||11}px)`);
    setVar(n,"--zr-seed-dx",(source.x-box.x-sx)+"px");
    setVar(n,"--zr-seed-dy",(source.y-box.y-sy)+"px");
  }
  function positionOverlays(following=false){
    if(!node||(!cardOpen&&!dockOpen&&current()>=overlayUntil))return;
    const r=dockRect(following);
    const width=Math.min(OVERLAY_WIDTH,Math.max(1,window.innerWidth-12));
    const sw=Math.min(19,r.seedW||19),sh=Math.min(19,r.seedH||19);
    const seed={x:r.x-sw/2,y:r.y-sh/2,width:sw,height:sh,radius:Math.min(sw,sh)/2};
    let cardBox;
    if(cardOpen||dockOpen||current()<overlayUntil){
      setVar(card,"--zr-overlay-width",width+"px");
      if(!following||!cardHeight)cardHeight=card.offsetHeight||82;
      cardBox=positionOverlay(card,r,width,cardHeight);
      seedOverlay(card,cardBox,seed);
    }
    if(dockOpen||current()<overlayUntil){
      setVar(dock,"--zr-overlay-width",width+"px");
      if(!following||!dockHeight)dockHeight=dock.offsetHeight||Math.min(500,window.innerHeight-16);
      const dockBox=positionOverlay(dock,r,width,dockHeight);
      seedOverlay(dock,dockBox,dockFromCard&&cardBox?{...cardBox,radius:11}:seed);
      // Outside click catcher covers the content side only, so it never
      // blocks native sidebar hover or prevents the user moving the dock.
      const right=r.side==="right";
      setVar(dockBackdrop,"--zr-outside-left",(right?0:Math.max(0,r.edge))+"px");
      setVar(dockBackdrop,"--zr-outside-right",(right?Math.max(0,window.innerWidth-r.edge):0)+"px");
    }
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
    // Only OnePlane without a host (or an unsupported missing toolbox)
    // uses the floating fallback. A hidden native sidebar never reparents.
    node.toggleAttribute("data-fallback",!slot&&!native);
    root.toggleAttribute("data-zr-downloads-native",native);
    if(changed||(oldSide&&oldSide!==side())){lastDockRect=null;syncTheme(node,card,dock); }
    if(toolbox!==observedSidebar){
      resizeObserver?.disconnect();observedSidebar=toolbox;if(toolbox)resizeObserver?.observe(toolbox);
      if(card)resizeObserver?.observe(card);if(dock)resizeObserver?.observe(dock);
    }
    // Cache the last visible location on structural/visibility changes.
    if(cardOpen||dockOpen||current()<overlayUntil){positionOverlays();follow();}
    else dockRect();
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
    node.setAttribute("aria-label","Show download details");node.setAttribute("aria-expanded","false");node.setAttribute("data-state","idle");
    speed=make("span","zr-download-speed");
    icon=make("span","zr-download-icon");icon.setAttribute("aria-hidden","true");
    const [track,f]=makeTrack();fill=f;node.append(speed,icon,track);
    node.addEventListener("click",()=>{cancelFlight();if(dockOpen)closeDock();else if(cardOpen)closeCard();else openCard();});
    card=make("section","zr-download-card");card.id="zr-download-card";
    card.setAttribute("role","region");card.setAttribute("aria-label","Recent downloads");card.setAttribute("aria-hidden","true");card.inert=true;
    const header=make("div","zr-dock-header"),title=make("span","zr-dock-title"),actions=make("div","zr-dock-header-actions");
    title.textContent="Recent downloads";
    const all=action("All downloads","zr-dock-all",()=>openDock(true));
    const close=action("×","zr-dock-close",()=>closeCard());close.setAttribute("aria-label","Close recent downloads");
    actions.append(all,close);header.append(title,actions);
    cardList=make("div","zr-dock-list");cardList.setAttribute("role","list");
    cardEmpty=make("div","zr-dock-empty");cardEmpty.textContent="No downloads yet";
    cardNotice=make("div","zr-dock-notice");cardNotice.setAttribute("role","status");
    card.append(header,cardList,cardEmpty,cardNotice);
    card.addEventListener("click",e=>{if(!e.target.closest?.("button"))openDock(true);});
    card.addEventListener("pointerenter",cancelHide);
    card.addEventListener("pointerleave",()=>armHide());
    card.addEventListener("focusin",cancelHide);
    card.addEventListener("focusout",e=>{if(!card?.contains(e.relatedTarget))armHide(true);});
    root.append(card);
    buildDock();
    resizeObserver=typeof ResizeObserver==="function"?new ResizeObserver(scheduleMount):null;
    mount();
    layoutObserver=new MutationObserver(records=>{
      if(records.some(r=>{
        if(r.target===node||r.target===card||r.target===dock||r.target===dockBackdrop||node.contains(r.target)||card.contains(r.target)||dock?.contains(r.target))return false;
        const selector="#navigator-toolbox,#zen-sidebar-top-buttons,#zen-tabs-wrapper,#tabbrowser-tabs,#oneplane-download-indicator-slot";
        const relevant=n=>n?.nodeType===1&&(n.matches?.(selector)||n.querySelector?.(selector));
        if(r.type==="attributes")return r.target===root||r.target===observedSidebar||r.target===anchor||r.target.matches?.(selector);
        return [...r.addedNodes,...r.removedNodes].some(n=>n!==node&&n!==card&&relevant(n));
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
    dock.setAttribute("role","dialog");dock.setAttribute("aria-label","Downloads");dock.setAttribute("aria-hidden","true");dock.inert=true;
    const header=make("div","zr-dock-header"),title=make("span","zr-dock-title");
    title.textContent="Downloads";
    headerNormal=make("div","zr-dock-header-normal");headerConfirm=make("div","zr-dock-header-confirm");headerConfirm.hidden=true;
    const actions=make("div","zr-dock-header-actions");
    clearButton=action("Clear","zr-dock-clear",()=>setConfirm(true));clearButton.disabled=true;
    const close=action("×","zr-dock-close",()=>closeDock(true));close.setAttribute("aria-label","Close downloads");
    actions.append(clearButton,close);headerNormal.append(title,actions);
    yesButton=action("Yes","zr-dock-yes",()=>void clearHistory());
    noButton=action("No","zr-dock-no",()=>setConfirm(false,true));
    const question=make("span","zr-dock-question");question.textContent="Clear downloads?";
    question.setAttribute("title","Remove finished entries only. Files on disk are kept.");
    headerConfirm.append(yesButton,question,noButton);header.append(headerNormal,headerConfirm);
    const sort=make("div","zr-dock-sort");
    sortTime=action("Time ↓","zr-dock-sort-time",()=>changeSort("time"));
    sortSize=action("Size","zr-dock-sort-size",()=>changeSort("size"));sort.append(sortTime,sortSize);
    dockList=make("div","zr-dock-list");dockList.setAttribute("role","list");
    dockEmpty=make("div","zr-dock-empty");dockEmpty.textContent="No downloads yet";
    dockNotice=make("div","zr-dock-notice");dockNotice.setAttribute("role","status");
    dockMore=action("Show more","zr-dock-more",()=>{limit+=30;renderDock();positionOverlays();});
    dock.append(header,sort,dockList,dockEmpty,dockMore,dockNotice);root.append(dockBackdrop,dock);updateSort();
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
    if(!dockOpen)return;
    const path=e.composedPath?.()||[];
    if(path.includes(dock)||path.includes(node)||dock.contains(e.target)||node.contains(e.target))return;
    closeDock();
  }
  function closeDock(restoreFocus=false){
    if(!dock)return;
    if(dockOpen){overlayUntil=current()+800;follow(800);}
    dockOpen=false;setConfirm(false);dock.removeAttribute("data-open");dockBackdrop?.removeAttribute("data-open");
    dock.inert=true;dock.setAttribute("aria-hidden","true");
    node?.setAttribute("aria-expanded",String(cardOpen));updateLive();
    if(restoreFocus&&visible(node))node.focus?.({preventScroll:true});
  }
  function openDock(fromCard=false){
    if(!dock||dead)return;
    dockFromCard=fromCard&&cardOpen;
    cancelFlight();
    dock.setAttribute("data-preparing","true");
    if(dockFromCard)card.setAttribute("data-handoff","true");
    closeCard();dockOpen=true;limit=30;dockNotice.textContent="";setConfirm(false);syncTheme(dock);updateLive();
    renderDock();positionOverlays();
    // Commit the closed seed geometry before the open transition.
    void dock.offsetWidth;void window.getComputedStyle(dock).clipPath;
    dock.removeAttribute("data-preparing");
    dock.inert=false;dock.setAttribute("aria-hidden","false");
    dock.setAttribute("data-open","true");dockBackdrop.setAttribute("data-open","true");
    node.setAttribute("aria-expanded","true");follow(800);
    dock.querySelector(".zr-dock-close")?.focus({preventScroll:true});
  }
  function showActionError(message){
    const notice=dockOpen?dockNotice:cardOpen?cardNotice:null;
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
        const active=Number(bv.active)-Number(av.active);if(active)return active;
        if(sortKey==="size"){
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
    if(!cardOpen||!cardList)return;
    if(!recentOrder)recentOrder=[...history.keys()].reverse().sort((a,b)=>history.get(b).time-history.get(a).time).slice(0,RECENT_LIMIT);
    renderRows(cardList,recentRows,recentOrder);
    cardEmpty.hidden=recentOrder.length>0;
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
        row.name.setAttribute("title",v.name+(v.time?" — "+new Date(v.time).toLocaleString():""));
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
  function armHide(ignoreFocus=false){
    cancelHide();if(!cardOpen||card?.matches(":hover")||(!ignoreFocus&&card?.contains(document.activeElement)))return;
    hideTimer=window.setTimeout(closeCard,HOLD);
  }
  function onKey(e){if(e.key==="Escape"){if(dockOpen&&confirming&&!clearing)setConfirm(false,true);else if(dockOpen)closeDock(true);else if(cardOpen)closeCard();}}
  function closeCard(){
    cancelHide();if(cardOpen){overlayUntil=current()+520;follow(520);}cardOpen=false;card?.removeAttribute("data-open");
    card?.setAttribute("aria-hidden","true");if(card)card.inert=true;
    node?.setAttribute("aria-expanded",String(dockOpen));
    updateLive();
  }
  function updateLive(){node?.toggleAttribute("data-live",snapshot.active>0||cardOpen||dockOpen||!!flight);}
  function openCard(){
    if(!card||!node||dead)return;
    if(dockOpen)return;
    cancelHide();
    const entering=!cardOpen;
    if(entering){card.setAttribute("data-preparing","true");card.removeAttribute("data-handoff");}
    cardOpen=true;cardNotice.textContent="";syncTheme(card);updateLive();renderRecent();positionOverlays();
    if(entering){
      // Commit the actual icon-sized seed without a transition from old geometry.
      void card.offsetWidth;void window.getComputedStyle(card).clipPath;
      card.removeAttribute("data-preparing");
    }
    card.setAttribute("data-open","true");card.setAttribute("aria-hidden","false");card.inert=false;
    node.setAttribute("aria-expanded","true");follow(800);armHide();
  }
  function cancelFlight(){
    ++flightToken;
    if(flightTimer)window.clearTimeout(flightTimer);flightTimer=0;
    if(flightAnimation)try{flightAnimation.cancel();}catch{}
    flightAnimation=null;flight?.remove();flight=null;updateLive();
  }
  function launchFlight(){
    if(dead||!node)return;
    cancelFlight();if(dockOpen)return;closeCard();mount();
    const activeWindow=!document.hasFocus||document.hasFocus();
    if(!activeWindow)return;
    node.setAttribute("data-live","true");
    if(reduced.matches){openCard();return;}
    const r=dockRect(),tx=r.x,ty=r.y;
    const native=window.gZenUIManager?._lastClickPosition;
    const click=lastClick&&current()-lastClick.at<5000?lastClick:
      native&&Number.isFinite(native.clientX)&&Number.isFinite(native.clientY)?{x:native.clientX,y:native.clientY}:null;
    const x=Math.max(12,Math.min(window.innerWidth-12,click?.x??window.innerWidth/2));
    const y=Math.max(12,Math.min(window.innerHeight-12,click?.y??window.innerHeight*.45));
    const dx=tx-x,dy=ty-y,arc=Math.min(86,Math.hypot(dx,dy)*.14);
    const token=flightToken;
    flight=make("span","zr-download-flight");flight.setAttribute("aria-hidden","true");
    const glyph=make("span","zr-download-icon");flight.append(glyph);
    flight.style.setProperty("left",x+"px");flight.style.setProperty("top",y+"px");root.append(flight);syncTheme(flight);
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
    if(updateTimer)window.clearTimeout(updateTimer);updateTimer=0;cancelHide();cancelFlight();closeCard();closeDock();stopFollow();overlayUntil=0;
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
    node?.remove();card?.remove();node=fill=speed=icon=card=cardList=cardEmpty=cardNotice=null;host=null;batch.clear();fresh=new WeakSet();latest=lastClick=null;
    dock?.remove();dockBackdrop?.remove();dock=dockList=dockEmpty=dockMore=dockBackdrop=dockNotice=null;history.clear();rows.clear();recentRows.clear();historyOrder=recentOrder=null;limit=30;cardHeight=0;dockHeight=0;dockFromCard=false;
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
