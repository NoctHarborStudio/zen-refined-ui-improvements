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
  let layoutFrame=0,resizeObserver=null,observedSidebar=null,anchor=null,lastClick=null,cardOpen=false,flightToken=0,latest=null;
  let updateTimer=0,hideTimer=0,readyObserver=null,layoutObserver=null,initialized=false,hydrating=false;
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
  function openDownloads(){
    try{
      if(prefs.getBoolPref("zen.library.enabled",false)){
        const lib=window.ZenLibrary||ChromeUtils.importESModule("moz-src:///zen/library/ZenLibrary.mjs").ZenLibrary;
        if(typeof lib?.toggle==="function"){lib.toggle("downloads");return;}
      }
    }catch{}
    try{if(typeof window.BrowserCommands?.downloadsUI==="function"){window.BrowserCommands.downloadsUI();return;}}catch{}
    try{window.DownloadsPanel?.showPanel(true);}catch{}
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
    const menu=get("PanelUI-button")||get("PanelUI-menu-button");
    const library=get("zen-library-button")||get("downloads-button");
    // Prefer the actual native group containing the menu/Library, not a
    // fixed top/bottom coordinate. Never insert into CustomizableUI's
    // widget list itself (it owns that list).
    const groups=["zen-sidebar-top-buttons","zen-sidebar-bottom-buttons","zen-sidebar-foot-buttons"].map(get).filter(n=>n&&toolbox.contains(n));
    return groups.find(n=>menu&&n.contains(menu))||groups.find(n=>library&&n.contains(library))||
      groups.find(n=>n.id==="zen-sidebar-top-buttons")||groups[0]||null;
  }
  function side(){return onePlane()?"left":prefs.getBoolPref(SIDE,false)?"right":"left";}
  function positionCard(){
    if(!card||!node||!cardOpen)return;
    const r=node.getBoundingClientRect(),right=node.getAttribute("data-side")==="right";
    const w=Math.min(264,Math.max(140,window.innerWidth-28)),h=card.offsetHeight||82,gap=14;
    let x=right?r.left-w-gap:r.right+gap;
    x=Math.max(14,Math.min(window.innerWidth-w-14,x));
    const y=Math.max(14,Math.min(window.innerHeight-h-14,r.top+(r.height-h)/2));
    card.style.setProperty("--zr-card-x",x+"px");card.style.setProperty("--zr-card-y",y+"px");
    card.style.setProperty("--zr-card-width",w+"px");
    card.setAttribute("data-side",right?"right":"left");
  }
  function mount(){
    if(!node||dead)return;
    const one=onePlane(),slot=one&&(host?.isConnected?host:get("oneplane-download-indicator-slot"));
    const group=!one?nativeAnchor():null;
    const toolbox=get("navigator-toolbox");
    const native=group&&group.parentElement&&visible(group)&&visible(toolbox);
    const parent=slot|| (native?group.parentElement:root);
    anchor=native?group:null;
    const changed=node.parentElement!==parent||(native&&node.nextElementSibling!==group);
    const oldSide=node.getAttribute("data-side");
    if(changed){if(native)parent.insertBefore(node,group);else parent.append(node);}
    node.toggleAttribute("data-zr-hosted",!!slot);
    node.toggleAttribute("data-zr-native",!!native);
    node.toggleAttribute("data-zr-oneplane",!!one&&!slot);
    node.setAttribute("data-side",side());
    // Native sidebar can be auto-hidden. The root fallback stays visible
    // during a transfer or notification; no phantom idle overlay.
    node.toggleAttribute("data-fallback",!slot&&!native);
    if(resizeObserver&&toolbox!==observedSidebar){
      resizeObserver.disconnect();observedSidebar=toolbox;if(toolbox)resizeObserver.observe(toolbox);
    }
    if(cardOpen)positionCard();
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
    if(n===observedSidebar||n===anchor||n===get("zen-appcontent-navbar-wrapper")||n===get("zen-main-app-wrapper"))scheduleMount();
  }
  function makeTrack(){
    const track=make("span","zr-download-track"),f=make("span","zr-download-fill");track.append(f);return [track,f];
  }
  function build(){
    node=make("button","zr-download-indicator");node.id="zr-download-indicator";node.type="button";
    node.setAttribute("aria-label","Show download details");node.setAttribute("aria-expanded","false");
    speed=make("span","zr-download-speed");
    icon=make("span","zr-download-icon");icon.setAttribute("aria-hidden","true");
    const [track,f]=makeTrack();fill=f;node.append(speed,icon,track);
    node.addEventListener("click",()=>{cancelFlight();if(cardOpen)closeCard();else openCard();});
    card=make("button","zr-download-card");card.id="zr-download-card";card.type="button";
    card.setAttribute("aria-label","Open native downloads");card.setAttribute("aria-hidden","true");card.tabIndex=-1;
    const body=make("span","zr-download-body"),line=make("span","zr-download-line"),bottom=make("span","zr-download-line");
    cardName=make("span","zr-download-name");cardSpeed=make("span","zr-download-speed");cardStatus=make("span","zr-download-status");cardBytes=make("span","zr-download-bytes");
    line.append(cardName,cardSpeed);bottom.append(cardBytes,cardStatus);
    const [ct,cf]=makeTrack();cardFill=cf;body.append(line,ct,bottom);
    cardIcon=make("span","zr-download-icon");cardIcon.setAttribute("aria-hidden","true");card.append(cardIcon,body);
    card.addEventListener("click",()=>{closeCard();openDownloads();});root.append(card);
    resizeObserver=typeof ResizeObserver==="function"?new ResizeObserver(scheduleMount):null;
    mount();
    layoutObserver=new MutationObserver(records=>{
      if(records.some(r=>{
        if(r.target===node||r.target===card||node.contains(r.target)||card.contains(r.target))return false;
        if(r.type==="attributes")return true;
        return [...r.addedNodes,...r.removedNodes].some(n=>n.nodeType===1&&n!==node&&n!==card&&!n.classList?.contains("zr-download-flight"));
      }))scheduleMount();
    });
    layoutObserver.observe(root,{attributes:true,attributeFilter:["oneplane-active","customizing","zen-compact-mode","zen-sidebar-expanded","zen-has-hover","hidden","collapsed"],childList:true});
    const toolbox=get("navigator-toolbox");
    if(toolbox)layoutObserver.observe(toolbox,{subtree:true,childList:true,attributes:true,attributeFilter:["hidden","collapsed","zen-has-hover","zen-compact-mode-active","zen-sidebar-expanded"]});
    window.addEventListener("resize",scheduleMount);window.addEventListener("OnePlane:DownloadHostChanged",scheduleMount);
    window.addEventListener("ZenCompactMode:LayoutUpdate",scheduleMount);window.addEventListener("ZenCompactMode:Toggled",scheduleMount);
    window.addEventListener("transitionend",trackLayout,true);window.addEventListener("pointerdown",trackClick,true);
    window.addEventListener("keydown",onKey,true);prefs.addObserver(SIDE,scheduleMount);
  }
  function cancelHide(){if(hideTimer)window.clearTimeout(hideTimer);hideTimer=0;}
  function onKey(e){if(e.key==="Escape"&&cardOpen)closeCard();}
  function closeCard(){
    cancelHide();cardOpen=false;card?.removeAttribute("data-open");
    card?.setAttribute("aria-hidden","true");if(card)card.tabIndex=-1;
    node?.setAttribute("aria-expanded","false");
    updateLive();
  }
  function updateLive(){node?.toggleAttribute("data-live",snapshot.active>0||cardOpen||!!flight);}
  function openCard(){
    if(!card||!node||dead)return;
    cancelHide();cardOpen=true;updateLive();positionCard();
    card.setAttribute("data-open","true");card.setAttribute("aria-hidden","false");card.tabIndex=0;
    node.setAttribute("aria-expanded","true");
    hideTimer=window.setTimeout(closeCard,HOLD);
  }
  function cancelFlight(){
    ++flightToken;
    if(flightAnimation)try{flightAnimation.cancel();}catch{}
    flightAnimation=null;flight?.remove();flight=null;updateLive();
  }
  function launchFlight(){
    if(dead||!node)return;
    cancelFlight();closeCard();mount();
    const activeWindow=!document.hasFocus||document.hasFocus();
    if(!activeWindow)return;
    node.setAttribute("data-live","true");
    if(reduced.matches||!visible(node)){openCard();return;}
    const r=icon.getBoundingClientRect(),tx=r.left+r.width/2,ty=r.top+r.height/2;
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
      flightAnimation.finished.then(()=>{if(dead||token!==flightToken)return;cancelFlight();openCard();},()=>{});
    }catch{cancelFlight();openCard();}
  }
  function paint(){
    updateTimer=0;if(dead||!node)return;
    lastRender=current();snapshot=summarize(batch.values());const s=snapshot;
    const details=(latest&&batch.get(latest))||[...batch.values()].find(x=>x.active)||[...batch.values()].at(-1);
    node.setAttribute("data-state",s.state);card.setAttribute("data-state",s.state);
    updateLive();
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
    }
  }
  function added(d){if(!hydrating)fresh.add(d);changed(d);}
  function removed(d){if(batch.delete(d)){if(latest===d)latest=null;schedule(true);}}
  function teardown(){
    ++epoch;
    if(updateTimer)window.clearTimeout(updateTimer);updateTimer=0;cancelHide();cancelFlight();closeCard();
    if(layoutFrame)window.cancelAnimationFrame(layoutFrame);layoutFrame=0;
    resizeObserver?.disconnect();resizeObserver=null;observedSidebar=anchor=null;
    if(list&&view)try{list.removeView(view);}catch{}
    list=view=null;hydrating=false;
    layoutObserver?.disconnect();layoutObserver=null;
    window.removeEventListener("resize",scheduleMount);window.removeEventListener("OnePlane:DownloadHostChanged",scheduleMount);
    window.removeEventListener("ZenCompactMode:LayoutUpdate",scheduleMount);window.removeEventListener("ZenCompactMode:Toggled",scheduleMount);
    window.removeEventListener("transitionend",trackLayout,true);window.removeEventListener("pointerdown",trackClick,true);window.removeEventListener("keydown",onKey,true);
    try{prefs.removeObserver(SIDE,scheduleMount);}catch{}
    node?.remove();card?.remove();node=fill=speed=icon=card=cardFill=cardName=cardSpeed=cardStatus=cardBytes=cardIcon=null;host=null;batch.clear();fresh=new WeakSet();latest=lastClick=null;
    snapshot=Object.freeze({active:0,progress:null,speed:0,state:"idle"});
    root.removeAttribute(ACTIVE);
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
      if(batch.size)schedule(true);
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
