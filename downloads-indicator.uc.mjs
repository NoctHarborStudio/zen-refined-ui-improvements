/* Zen Refined — Download Indicator. Native download events, no polling,
 * no interception of downloads, no file/network access. One view per window.
 * A future OnePlane Extension Dock can host the same view via setHost(). */
(() => {
  const root=document.documentElement,prefs=Services.prefs;
  const PREF="zen.refined.downloads.indicator",KEY="__zenRefinedDownloadIndicator";
  const NS="http://www.w3.org/1999/xhtml",ACTIVE="data-zr-downloads-active";
  const make=(tag,cls)=>{const n=document.createElementNS(NS,tag);if(cls)n.className=cls;return n;};
  const get=id=>document.getElementById(id);
  const RATE=200,HOLD=1900;
  const enabled=()=>prefs.getBoolPref(PREF,true);
  if(root.hasAttribute("popup-window")||typeof window.addUnloadListener!=="function")return;
  window[KEY]?.dispose?.();
  let dead=false,epoch=0,view=null,list=null,node=null,fill=null,speed=null,status=null,icon=null,host=null;
  let updateTimer=0,hideTimer=0,readyObserver=null,layoutObserver=null,initialized=false,hydrating=false;
  let lastRender=0,snapshot=Object.freeze({active:0,progress:null,speed:0,state:"idle"}),batch=new Map();
  const number=x=>Number.isFinite(x)?Math.max(0,x):0;
  const current=()=>window.performance.now();
  function sample(d){
    return {active:!d.stopped&&!d.succeeded&&!d.error&&!d.canceled,success:!!d.succeeded,
      failed:!!d.error,canceled:!!d.canceled,known:!!d.hasProgress&&number(d.totalBytes)>0,
      total:number(d.totalBytes),bytes:number(d.currentBytes),speed:number(d.speed)};
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
  function speedText(v){
    if(v>=1e9)return (v/1e9).toFixed(1)+" GB/s";
    if(v>=1e6)return (v/1e6).toFixed(1)+" MB/s";
    if(v>=1e3)return (v/1e3).toFixed(0)+" KB/s";
    return Math.round(v)+" B/s";
  }
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
  function mount(){
    if(!node)return;
    const one=root.getAttribute("oneplane-active")==="true"&&window.innerWidth>=900;
    const slot=one&&(host?.isConnected?host:get("oneplane-download-indicator-slot"));
    const parent=slot||root;
    if(node.parentElement!==parent)parent.append(node);
    node.toggleAttribute("data-zr-hosted",!!slot);
    node.toggleAttribute("data-zr-oneplane",!!one&&!slot);
  }
  function setHost(next){
    if(next!==null&&(!next?.isConnected||next.ownerDocument!==document||node?.contains(next)))return false;
    host=next;mount();return true;
  }
  function build(){
    node=make("button","zr-download-indicator");node.id="zr-download-indicator";node.type="button";
    node.setAttribute("aria-label","Open downloads");node.setAttribute("title","Open downloads");
    const body=make("span","zr-download-body"),line=make("span","zr-download-line");
    speed=make("span","zr-download-speed");status=make("span","zr-download-status");
    line.append(speed,status);
    const track=make("span","zr-download-track");fill=make("span","zr-download-fill");track.append(fill);
    body.append(line,track);
    icon=make("span","zr-download-icon");icon.setAttribute("aria-hidden","true");
    node.append(body,icon);node.addEventListener("click",openDownloads);mount();
    layoutObserver=new MutationObserver(mount);
    layoutObserver.observe(root,{attributes:true,attributeFilter:["oneplane-active","customizing"]});
    window.addEventListener("resize",mount);window.addEventListener("OnePlane:DownloadHostChanged",mount);
  }
  function cancelHide(){if(hideTimer)window.clearTimeout(hideTimer);hideTimer=0;}
  function paint(){
    updateTimer=0;if(dead||!node)return;
    lastRender=current();mount();snapshot=summarize(batch.values());
    const s=snapshot;
    if(s.state==="idle"){node.removeAttribute("data-visible");return;}
    node.setAttribute("data-state",s.state);
    node.toggleAttribute("data-indeterminate",s.state==="active"&&s.progress===null);
    if(s.progress!==null)fill.style.setProperty("--zr-download-progress",String(s.progress));
    else fill.style.removeProperty("--zr-download-progress");
    const a=s.state==="active"?speedText(s.speed):s.state==="complete"?"Complete":s.state==="failed"?"Failed":"Stopped";
    const b=s.state==="active"?(s.active>1?s.active+" files":s.progress===null?"Downloading":Math.floor(s.progress*100)+"%"):"";
    if(speed.textContent!==a)speed.textContent=a;if(status.textContent!==b)status.textContent=b;
    node.setAttribute("data-visible","true");
    if(s.active)cancelHide();
    else if(!hideTimer)hideTimer=window.setTimeout(()=>{
      hideTimer=0;batch.clear();snapshot=Object.freeze({active:0,progress:null,speed:0,state:"idle"});
      node?.removeAttribute("data-visible");
    },HOLD);
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
        batch.set(d,next);schedule(!hydrating);return;
      }
      batch.set(d,next);schedule();return;
    }
    // Initial addView replays history. Only a transfer observed active in
    // this window can become a terminal notification.
    if(previous?.active){batch.set(d,next);schedule(true);}
  }
  function removed(d){
    if(batch.delete(d))schedule(true);
  }
  function teardown(){
    ++epoch;
    if(updateTimer)window.clearTimeout(updateTimer);updateTimer=0;cancelHide();
    if(list&&view)try{list.removeView(view);}catch{}
    list=view=null;hydrating=false;
    layoutObserver?.disconnect();layoutObserver=null;
    window.removeEventListener("resize",mount);window.removeEventListener("OnePlane:DownloadHostChanged",mount);
    node?.remove();node=fill=speed=status=icon=null;host=null;batch.clear();
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
      view={onDownloadAdded:changed,onDownloadChanged:changed,onDownloadRemoved:removed};
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
