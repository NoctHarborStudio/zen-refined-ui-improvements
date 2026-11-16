/* Zen Refined — Download Indicator. Native download events, no polling,
 * no interception of downloads, no file/network access. One view per window.
 * A future OnePlane Extension Dock can host the same view via setHost(). */
(() => {
  const root=document.documentElement,prefs=Services.prefs;
  const PREF="zen.refined.downloads.indicator",KEY="__zenRefinedDownloadIndicator";
  const NS="http://www.w3.org/1999/xhtml",ACTIVE="data-zr-downloads-active";
  const make=(tag,cls)=>{const n=document.createElementNS(NS,tag);if(cls)n.className=cls;return n;};
  const get=id=>document.getElementById(id);
  const RATE=200,HOLD=3000,SIDE="zen.tabs.vertical.right-side";
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
  const enabled=()=>prefs.getBoolPref(PREF,true);
  if(root.hasAttribute("popup-window")||typeof window.addUnloadListener!=="function")return;
  window[KEY]?.dispose?.();
  let dead=false,epoch=0,view=null,list=null,node=null,fill=null,speed=null,icon=null,host=null;
  let card=null,cardFill=null,cardName=null,cardSpeed=null,cardStatus=null,cardBytes=null,cardIcon=null,flight=null,flightAnimation=null;
  let layoutFrame=0,resizeObserver=null,observedSidebar=null,anchor=null,lastClick=null,cardOpen=false,flightToken=0,flightTimer=0,latest=null;
  let updateTimer=0,hideTimer=0,readyObserver=null,layoutObserver=null,initialized=false,hydrating=false;
  let lastDockRect=null,followFrame=0,followUntil=0,overlayUntil=0;
  let dock=null,dockList=null,dockEmpty=null,dockMore=null,dockBackdrop=null,dockNotice=null,dockOpen=false,limit=30;
  const history=new Map(),rows=new Map();
  let historyOrder=null,cardHeight=82,dockHeight=0;
  let lastRender=0,snapshot=Object.freeze({active:0,progress:null,speed:0,state:"idle"}),batch=new Map(),fresh=new WeakSet();
  const number=x=>Number.isFinite(x)?Math.max(0,x):0;
  const current=()=>window.performance.now();
  function sample(d){
    return {active:!d.stopped&&!d.succeeded&&!d.error&&!d.canceled,success:!!d.succeeded,
      failed:!!d.error,canceled:!!d.canceled,known:!!d.hasProgress&&number(d.totalBytes)>0,
      total:number(d.totalBytes),bytes:number(d.currentBytes),speed:number(d.speed),
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
  function openDownloads(){openDock();}
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
    return value==="true"?"right":value==="false"?"left":prefs.getBoolPref(SIDE,false)?"right":"left";
  }
  function dockRect(following=false){
    const right=side()==="right",w=window.innerWidth;
    const native=node?.hasAttribute("data-zr-native")&&observedSidebar?.isConnected;
    // The toolbox's DOMRect includes Zen's actual animated CSS translate.
    // Even when titlebar visibility is hidden its geometry is available.
    // Clamp the inner edge to the viewport instead of reusing a stale
    // expanded x coordinate. Keep native y independent of the slide.
    if(native){
      const t=observedSidebar.getBoundingClientRect();
      const edge=Math.max(0,Math.min(w,right?t.left:t.right));
      if(following&&lastDockRect?.side===side())return {...lastDockRect,edge};
      const n=node.getBoundingClientRect(),i=icon.getBoundingClientRect();
      const y=n.height>0?n.top:(lastDockRect?.top??70),height=n.height||33;
      const iconY=i.height>0?i.top+i.height/2:y+height/2;
      const iconX=i.width>0?i.left+i.width/2:edge;
      const x=Math.max(8,Math.min(w-8,iconX));
      lastDockRect={edge,top:y,height,x,y:iconY,side:side()};
      return lastDockRect;
    }
    if(node&&visible(node)){
      const n=node.getBoundingClientRect(),i=icon.getBoundingClientRect();
      lastDockRect={edge:right?n.left:n.right,top:n.top,height:n.height,x:i.left+i.width/2,y:i.top+i.height/2,side:side()};
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
    const y=clamp(r.top+(r.height-height)/2,8,h-height-8);
    // Separate positioning translate from entrance transform. No extra
    // CSS transition on the position: both surfaces follow native motion.
    setVar(n,"--zr-overlay-x",x+"px");setVar(n,"--zr-overlay-y",y+"px");
    setVar(n,"--zr-overlay-width",width+"px");
    n.setAttribute("data-side",r.side);
  }
  function positionOverlays(following=false){
    if(!node||(!cardOpen&&!dockOpen&&current()>=overlayUntil))return;
    const r=dockRect(following);
    if(cardOpen||current()<overlayUntil){
      if(!following)cardHeight=card.offsetHeight||82;
      positionOverlay(card,r,Math.min(264,Math.max(1,window.innerWidth-12)),cardHeight);
    }
    if(dockOpen||current()<overlayUntil){
      const width=Math.min(344,Math.max(1,window.innerWidth-12));
      if(!following||!dockHeight)dockHeight=dock.offsetHeight||Math.min(460,window.innerHeight-16);
      positionOverlay(dock,r,width,dockHeight);
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
    if(changed||(oldSide&&oldSide!==side()))lastDockRect=null;
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
    card=make("button","zr-download-card");card.id="zr-download-card";card.type="button";
    card.setAttribute("aria-label","Open downloads dock");card.setAttribute("aria-hidden","true");card.setAttribute("data-state","idle");card.tabIndex=-1;
    const body=make("span","zr-download-body"),line=make("span","zr-download-line"),bottom=make("span","zr-download-line");
    cardName=make("span","zr-download-name");cardSpeed=make("span","zr-download-speed");cardStatus=make("span","zr-download-status");cardBytes=make("span","zr-download-bytes");
    line.append(cardName,cardSpeed);bottom.append(cardBytes,cardStatus);
    const [ct,cf]=makeTrack();cardFill=cf;body.append(line,ct,bottom);
    cardIcon=make("span","zr-download-icon");cardIcon.setAttribute("aria-hidden","true");card.append(cardIcon,body);
    card.addEventListener("click",()=>{closeCard();openDownloads();});root.append(card);
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
    window.addEventListener("keydown",onKey,true);prefs.addObserver(SIDE,scheduleMount);
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
    const close=action("×","zr-dock-close",()=>closeDock(true));close.setAttribute("aria-label","Close downloads");
    header.append(title,close);
    dockList=make("div","zr-dock-list");dockList.setAttribute("role","list");
    dockEmpty=make("div","zr-dock-empty");dockEmpty.textContent="No downloads yet";
    dockNotice=make("div","zr-dock-notice");dockNotice.setAttribute("role","status");
    dockMore=action("Show more","zr-dock-more",()=>{limit+=30;renderDock();positionOverlays();});
    dock.append(header,dockList,dockEmpty,dockMore,dockNotice);root.append(dockBackdrop,dock);
  }
  function outsideDock(e){
    if(!dockOpen)return;
    const path=e.composedPath?.()||[];
    if(path.includes(dock)||path.includes(node)||dock.contains(e.target)||node.contains(e.target))return;
    closeDock();
  }
  function closeDock(restoreFocus=false){
    if(!dock)return;
    if(dockOpen){overlayUntil=current()+520;follow(520);}
    dockOpen=false;dock.removeAttribute("data-open");dockBackdrop?.removeAttribute("data-open");
    dock.inert=true;dock.setAttribute("aria-hidden","true");
    node?.setAttribute("aria-expanded",String(cardOpen));updateLive();
    if(restoreFocus&&visible(node))node.focus?.({preventScroll:true});
  }
  function openDock(){
    if(!dock||dead)return;
    cancelFlight();closeCard();dockOpen=true;limit=30;dockNotice.textContent="";updateLive();
    renderDock();positionOverlays();
    dock.inert=false;dock.setAttribute("aria-hidden","false");
    dock.setAttribute("data-open","true");dockBackdrop.setAttribute("data-open","true");
    node.setAttribute("aria-expanded","true");follow();
    dock.querySelector(".zr-dock-close")?.focus({preventScroll:true});
  }
  function makeRow(download){
    const el=make("div","zr-dock-row");el.setAttribute("role","listitem");
    const glyph=make("span","zr-download-icon"),body=make("div","zr-dock-row-body"),name=make("div","zr-dock-name"),meta=make("div","zr-dock-meta");
    glyph.setAttribute("aria-hidden","true");
    const [track,fill]=makeTrack();
    const folder=action("Show in folder","zr-dock-folder",async()=>{
      // Gecko owns path resolution and platform file-manager integration.
      // No shell command, arbitrary path, or executable launch.
      try{
        if(!download.succeeded||typeof download.showContainingDirectory!=="function")return;
        await download.showContainingDirectory();
      }catch{if(dockNotice&&dockOpen)dockNotice.textContent="Could not open the containing folder.";}
    });
    body.append(name,meta,track);el.append(glyph,body,folder);
    return {el,name,meta,track,fill,folder};
  }
  function renderDock(){
    if(!dockOpen||!dockList)return;
    // Keep all native session-list entries in memory; render only a
    // bounded page, active items first, then newest first. Reuse rows.
    if(!historyOrder){
      historyOrder=[...history.keys()].reverse();
      historyOrder.sort((a,b)=>Number(history.get(b).active)-Number(history.get(a).active));
    }
    const entries=historyOrder;
    const wanted=entries.slice(0,limit),keep=new Set(wanted);
    for(const [d,row] of rows)if(!keep.has(d)){row.el.remove();rows.delete(d);}
    let index=0;
    for(const d of wanted){
      const v=history.get(d);
      let row=rows.get(d);
      if(!row){row=makeRow(d);rows.set(d,row);}
      const text=v.active?sizeText(v.bytes)+(v.known?" / "+sizeText(v.total):"")+" · "+speedText(v.speed):
        v.success?"Complete · "+sizeText(v.total||v.bytes):v.failed?"Failed":"Stopped";
      if(row.name.textContent!==v.name){row.name.textContent=v.name;row.name.setAttribute("title",v.name);}
      if(row.meta.textContent!==text)row.meta.textContent=text;
      row.el.setAttribute("data-state",v.active?"active":v.success?"complete":v.failed?"failed":"stopped");
      row.el.toggleAttribute("data-indeterminate",v.active&&!v.known);
      setVar(row.fill,"--zr-download-progress",String(v.known?Math.min(1,v.bytes/v.total):0));
      row.folder.disabled=!v.success||typeof d.showContainingDirectory!=="function";
      if(dockList.children[index]!==row.el)dockList.insertBefore(row.el,dockList.children[index]||null);
      index++;
    }
    dockEmpty.hidden=entries.length>0;dockMore.hidden=entries.length<=limit;
  }
  function cancelHide(){if(hideTimer)window.clearTimeout(hideTimer);hideTimer=0;}
  function onKey(e){if(e.key==="Escape"){if(dockOpen)closeDock(true);else if(cardOpen)closeCard();}}
  function closeCard(){
    cancelHide();if(cardOpen){overlayUntil=current()+520;follow(520);}cardOpen=false;card?.removeAttribute("data-open");
    card?.setAttribute("aria-hidden","true");if(card)card.tabIndex=-1;
    node?.setAttribute("aria-expanded",String(dockOpen));
    updateLive();
  }
  function updateLive(){node?.toggleAttribute("data-live",snapshot.active>0||cardOpen||dockOpen||!!flight);}
  function openCard(){
    if(!card||!node||dead)return;
    if(dockOpen)return;
    cancelHide();cardOpen=true;updateLive();positionOverlays();follow();
    card.setAttribute("data-open","true");card.setAttribute("aria-hidden","false");card.tabIndex=0;
    node.setAttribute("aria-expanded","true");
    hideTimer=window.setTimeout(closeCard,HOLD);
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
    flight.style.setProperty("left",x+"px");flight.style.setProperty("top",y+"px");root.append(flight);
    try{
      // A short compositor-friendly curved flight; no frame callbacks,
      // no bouncing, and the card opens only after it reaches the icon.
      const frames=[
        {transform:"translate(-50%,-50%) scale(.72)",opacity:0,offset:0},
        {transform:"translate(calc(-50% + "+dx*.16+"px),calc(-50% + "+(dy*.16-arc*.52)+"px)) scale(1)",opacity:1,offset:.22},
        {transform:"translate(calc(-50% + "+dx*.72+"px),calc(-50% + "+(dy*.72-arc*.62)+"px)) scale(.86)",opacity:1,offset:.72},
        {transform:"translate(calc(-50% + "+dx+"px),calc(-50% + "+dy+"px)) scale(.4)",opacity:.12,offset:1}
      ];
      flightAnimation=flight.animate(frames,{duration:620,easing:"cubic-bezier(.32,.04,.25,1)",fill:"forwards"});
      const land=()=>{if(dead||token!==flightToken)return;cancelFlight();openCard();};
      flightTimer=window.setTimeout(land,760);
      flightAnimation.finished.then(land,land);
    }catch{cancelFlight();openCard();}
  }
  function paint(){
    updateTimer=0;if(dead||!node)return;
    lastRender=current();snapshot=summarize(batch.values());const s=snapshot;
    const details=(latest&&batch.get(latest))||[...batch.values()].find(x=>x.active)||[...batch.values()].at(-1);
    node.setAttribute("data-state",s.state);card.setAttribute("data-state",s.state);
    updateLive();
    node.toggleAttribute("data-transferring",s.active>0);
    const unknown=s.state==="active"&&s.progress===null;
    node.toggleAttribute("data-indeterminate",unknown);card.toggleAttribute("data-indeterminate",unknown);
    for(const f of [fill,cardFill]){
      if(s.progress!==null)f.style.setProperty("--zr-download-progress",String(s.progress));
      else f.style.removeProperty("--zr-download-progress");
    }
    const a=s.state==="active"?speedText(s.speed):s.state==="complete"?"Complete":s.state==="failed"?"Failed":s.state==="stopped"?"Stopped":"";
    const b=s.state==="active"?(s.progress===null?"Downloading":Math.floor(s.progress*100)+"%"):s.state==="complete"?"100%":"";
    let bytes=0,total=0,known=true;
    for(const v of batch.values())if(v.active||v.success){bytes+=v.success&&v.known?v.total:v.bytes;total+=v.total;if(!v.known)known=false;}
    const values=[[speed,s.active?speedText(s.speed):""],[cardSpeed,a],[cardStatus,b],
      [cardName,s.active>1?s.active+" downloads":details?.name||"Downloads"],
      [cardBytes,details?(sizeText(bytes)+(known&&total>0?" / "+sizeText(total):"")):"No active downloads"]];
    for(const [n,v] of values)if(n.textContent!==v)n.textContent=v;
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
    if(!history.has(d)||history.get(d).active!==next.active)historyOrder=null;
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
    }else if(dockOpen)schedule();
  }
  function added(d){if(!hydrating)fresh.add(d);changed(d);}
  function removed(d){if(history.delete(d))historyOrder=null;if(batch.delete(d)){if(latest===d)latest=null;schedule(true);}else if(dockOpen)schedule();}
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
    node?.remove();card?.remove();node=fill=speed=icon=card=cardFill=cardName=cardSpeed=cardStatus=cardBytes=cardIcon=null;host=null;batch.clear();fresh=new WeakSet();latest=lastClick=null;
    dock?.remove();dockBackdrop?.remove();dock=dockList=dockEmpty=dockMore=dockBackdrop=dockNotice=null;history.clear();rows.clear();historyOrder=null;limit=30;cardHeight=82;dockHeight=0;
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
      list.addView(view);hydrating=false;
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
