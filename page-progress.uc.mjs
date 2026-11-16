/* Zen Refined — Page Progress. Native top-level network events only.
 * Estimates are never presented as exact page completion percentages. */
(() => {
  const root=document.documentElement,prefs=Services.prefs;
  const PREF="zen.refined.page-progress.enabled",KEY="__zenRefinedPageProgress";
  const NS="http://www.w3.org/1999/xhtml",F=Ci.nsIWebProgressListener;
  if(root.hasAttribute("popup-window")||typeof window.addUnloadListener!=="function")return;
  window[KEY]?.();
  let dead=false,installed=false,initialized=false,observer=null,bar=null,fill=null;
  let browser=null,states=new WeakMap(),selected=null,shown=false,showTimer=0,hideTimer=0,renderTimer=0,lastRender=0;
  const now=()=>window.performance.now();
  const enabled=()=>prefs.getBoolPref(PREF,true);
  const make=(tag,cls)=>{const n=document.createElementNS(NS,tag);n.className=cls;return n;};
  function clearTimers(){
    for(const t of [showTimer,hideTimer,renderTimer])if(t)window.clearTimeout(t);
    showTimer=hideTimer=renderTimer=0;
  }
  function hide(){
    clearTimers();shown=false;bar?.removeAttribute("data-visible");
    bar?.removeAttribute("data-indeterminate");bar?.removeAttribute("data-terminal");
  }
  function state(b){
    let s=states.get(b);
    if(!s){s={active:false,progress:null};states.set(b,s);}
    return s;
  }
  function selectedState(){return selected?states.get(selected):null;}
  function paint(){
    renderTimer=0;if(!bar||!shown)return;
    const s=selectedState();if(!s?.active)return;
    lastRender=now();
    bar.toggleAttribute("data-indeterminate",s.progress===null);
    fill.style.setProperty("--zr-page-progress",String(s.progress??.16));
  }
  function schedule(){
    if(!shown||renderTimer)return;
    renderTimer=window.setTimeout(paint,Math.max(0,120-(now()-lastRender)));
  }
  function reveal(){
    if(showTimer||shown||!bar)return;
    const b=selected;
    showTimer=window.setTimeout(()=>{
      showTimer=0;if(!installed||selected!==b||!selectedState()?.active)return;
      shown=true;bar.removeAttribute("data-terminal");paint();bar.setAttribute("data-visible","true");
    },90);
  }
  function resetFor(b){
    hide();selected=b;
    if(!b||!bar)return;
    fill.style.setProperty("--zr-page-progress","0");
    let s=states.get(b);
    if(!s&&browser.selectedTab?.hasAttribute("busy")&&!browser.selectedTab?.hasAttribute("pending")){
      s=state(b);s.active=true;
    }
    if(s?.active)reveal();
  }
  function onSelect(){if(browser)resetFor(browser.selectedBrowser);}
  function successful(status){return status===0||status===undefined||(Number(status)>>>31)===0;}
  const listener={
    onStateChange(b,webProgress,request,flags,status){
      if(!installed||!b||!webProgress?.isTopLevel||!(flags&F.STATE_IS_NETWORK))return;
      const s=state(b);
      if(flags&F.STATE_START){
        if(!s.active){s.active=true;s.progress=null;if(b===selected){hide();fill.style.setProperty("--zr-page-progress","0");reveal();}}
      }
      if(flags&F.STATE_STOP){
        if(!s.active)return;s.active=false;
        if(b!==selected)return;
        if(showTimer)window.clearTimeout(showTimer);showTimer=0;
        if(renderTimer)window.clearTimeout(renderTimer);renderTimer=0;
        if(!shown){hide();return;}
        if(successful(status)){
          bar.removeAttribute("data-indeterminate");bar.setAttribute("data-terminal","true");
          fill.style.setProperty("--zr-page-progress","1");
          hideTimer=window.setTimeout(hide,570);
        }else hide(); // canceled/error: never claim completion
      }
    },
    onProgressChange(b,webProgress,request,curSelf,maxSelf,curTotal,maxTotal){
      if(!installed||!b||!webProgress?.isTopLevel)return;
      const s=states.get(b);if(!s?.active||!Number.isFinite(maxTotal)||maxTotal<=0||!Number.isFinite(curTotal)||curTotal<0)return;
      const estimate=Math.min(.94,Math.max(.025,curTotal/maxTotal));
      s.progress=Math.max(s.progress??0,estimate);
      if(b===selected)schedule();
    }
  };
  function install(){
    if(installed||dead||!enabled()||!window.gBrowser?.addTabsProgressListener)return;
    browser=window.gBrowser;
    bar=make("div","zr-page-progress");bar.id="zr-page-progress";bar.setAttribute("aria-hidden","true");
    fill=make("div","zr-page-progress-fill");bar.append(fill);root.append(bar);
    installed=true;
    try{
      browser.addTabsProgressListener(listener);
      browser.tabContainer.addEventListener("TabSelect",onSelect);
      resetFor(browser.selectedBrowser);
    }catch(error){console.warn("[Zen Refined] Page progress:",error);uninstall();}
  }
  function uninstall(){
    hide();
    if(installed){
      try{browser.removeTabsProgressListener(listener);}catch{}
      browser?.tabContainer?.removeEventListener("TabSelect",onSelect);
    }
    installed=false;bar?.remove();bar=fill=null;browser=selected=null;states=new WeakMap();
  }
  function sync(){if(!initialized||dead)return;if(enabled())install();else uninstall();}
  function dispose(){
    if(dead)return;dead=true;uninstall();
    if(observer)try{Services.obs.removeObserver(observer,"browser-delayed-startup-finished");}catch{}
    observer=null;
    try{prefs.removeObserver(PREF,sync);}catch{}
    window.removeEventListener("unload",dispose);if(window[KEY]===dispose)delete window[KEY];
  }
  function start(){initialized=true;sync();}
  window[KEY]=dispose;window.addUnloadListener(dispose);window.addEventListener("unload",dispose,{once:true});
  prefs.addObserver(PREF,sync);
  if(window.gBrowserInit?.delayedStartupFinished)start();
  else{observer=subject=>{if(subject!==window)return;Services.obs.removeObserver(observer,"browser-delayed-startup-finished");observer=null;start();};Services.obs.addObserver(observer,"browser-delayed-startup-finished");}
})();
