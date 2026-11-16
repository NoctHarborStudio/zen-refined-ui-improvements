/* Zen Refined — Smart Search.
 * Native URL-bar provider. Recent active tabs are computed on demand;
 * no history database, tab cloning, network requests, or custom input.
 */
(() => {
  const KEY="__zenRefinedSmartSearch",REGISTRY="__zenRefinedSmartSearchRegistry";
  const NAME="ZenRefinedRecentTabs",TYPE="zr-recent-tab",STATUS="__zenRefinedSmartSearchStatus";
  const PREF="zen.refined.smart-search.enabled";
  const TOPICS=["topsites-refreshed","newtab-top-sites-changed"],RETRY_DELAYS=[180,500,1000,1800];
  const prefs=Services.prefs;
  const root=document.documentElement;
  if(typeof window.addUnloadListener!=="function"||root.hasAttribute("popup-window"))return;
  window[KEY]?.();

  // Scope every query to its actual chrome window. Never use the global
  // most-recent window as a fallback; a background/private window may differ.
  function outerId(win){try{return win?.windowUtils?.outerWindowID||null;}catch{return null;}}
  function queryAllowed(context,source,enabled,openpage){
    return enabled&&openpage&&!context.isPrivate&&
      typeof context.searchString==="string"&&context.searchString.length===0&&
      !context.searchMode&&!context.restrictSource&&!context.restrictInSearchMode?.()&&
      !!context.sources?.includes(source);
  }
  function selectRecent(entries,maxResults,requested){
    const budget=Math.max(0,Math.min(6,Math.floor(requested)||6,Math.floor(maxResults)-6));
    // Prefer current-space candidates when choosing the six slots. Then
    // sort the selected pool chronologically so both columns are readable
    // top to bottom, even when the pool includes other workspaces.
    const byTime=(a,b)=>Number(!!b.selected)-Number(!!a.selected)||b.last-a.last||a.order-b.order;
    return entries.filter(e=>Number.isFinite(e.last)&&e.last>0)
      .sort((a,b)=>Number(!!b.selected)-Number(!!a.selected)||Number(b.current)-Number(a.current)||byTime(a,b))
      .slice(0,budget).sort(byTime);
  }
  function availableTab(win,tab){
    return !!tab&&(tab.ownerGlobal===win||tab.ownerDocument===win.document&&!!win.document)&&tab.isConnected&&!tab.closing&&
      !tab.hasAttribute("zen-empty-tab")&&!tab.hasAttribute("zen-glance-tab")&&
      !tab.hasAttribute("glance-id")&&!!tab.linkedBrowser;
  }
  function eligibleUrl(url){
    return typeof url==="string"&&/^(https?:|file:|about:)/i.test(url)&&
      !/^about:(blank|newtab|home|privatebrowsing)([?#]|$)/i.test(url);
  }
  function collect(win,sessionStore,utils,activity){
    const browser=win.gBrowser,spaces=win.gZenWorkspaces;
    if(!browser||!browser.selectedTab)return [];
    const active=spaces?.activeWorkspace||"";
    const tabs=new Set();
    // The workspace cache may not yet contain all native tabs.
    try{for(const t of spaces?.allStoredTabs||[])tabs.add(t);}catch{}
    try{for(const t of browser.tabs||[])tabs.add(t);}catch{}
    const names=new Map();
    try{for(const s of spaces?.getWorkspaces?.()||[])names.set(s.uuid,s.name);}catch{}
    const entries=[],seen=new Set();
    for(const tab of tabs){
      if(seen.has(tab)||!availableTab(win,tab))continue;
      seen.add(tab);
      try{
        // Use the session-store lazy value rather than touching remote
        // browser state for a pending/unloaded tab.
        const lazy=!tab.linkedPanel||tab.hasAttribute("pending");
        const url=lazy?sessionStore?.getLazyTabValue?.(tab,"url"):tab.linkedBrowser.currentURI?.spec;
        if(!eligibleUrl(url))continue;
        const essential=tab.hasAttribute("zen-essential");
        const spaceId=tab.getAttribute("zen-workspace-id")||"";
        const current=essential||!active||spaceId===active||(!spaceId&&!tab.hidden);
        // If a tab belongs to an unknown/missing space, do not offer a
        // possibly invalid cross-workspace selection.
        if(!current&&(!spaceId||!names.has(spaceId)))continue;
        const containerId=Number(tab.getAttribute("usercontextid")||0);
        let container="";
        try{if(containerId)container=utils.getUserContextData(containerId)?.label||String(containerId);}catch{}
        const title=String(tab.getAttribute("zen-static-label")||tab.label||url).slice(0,300);
        const selected=tab===browser.selectedTab;
        const last=selected?Date.now():activity?.get(tab)||Number(tab.lastSeenActive||tab.lastAccessed);
        entries.push({tab,url,title,last,selected,current,spaceId,containerId,order:entries.length,
          workspace:essential?"Essentials":String(names.get(spaceId)||""),container});
      }catch{}
    }
    return entries;
  }
  function validTarget(win,entry,sessionStore){
    if(!entry||!availableTab(win,entry.tab))return false;
    const tab=entry.tab;
    try{
      const lazy=!tab.linkedPanel||tab.hasAttribute("pending");
      const url=lazy?sessionStore?.getLazyTabValue?.(tab,"url"):tab.linkedBrowser.currentURI?.spec;
      return eligibleUrl(url)&&url===entry.url&&
        Number(tab.getAttribute("usercontextid")||0)===entry.containerId&&
        (tab.getAttribute("zen-workspace-id")||"")===entry.spaceId;
    }catch{return false;}
  }
  function relativeTime(last,selected,now=Date.now()){
    const seconds=Math.max(0,Math.floor((now-last)/1000));
    if(selected||seconds<60)return "Now";
    if(seconds<3600)return Math.floor(seconds/60)+"m ago";
    if(seconds<86400)return Math.floor(seconds/3600)+"h ago";
    return Math.floor(seconds/86400)+"d ago";
  }
  function domain(url){
    try{const u=new URL(url);return u.hostname||u.protocol+u.pathname;}catch{return url;}
  }
  function zeroPrefix(context,enabled,openpage){
    return enabled&&openpage&&!context.isPrivate&&context.searchString===""&&
      (!context.sapName||context.sapName==="urlbar")&&!context.searchMode&&!context.restrictSource&&
      !context.restrictInSearchMode?.()&&(!context.sources?.length||context.sources.length!==1);
  }
  function resultBudget(entries){
    return Math.min(6,entries.filter(e=>Number.isFinite(e.last)&&e.last>0).length)+6;
  }
  function groupPlan(rows){
    const classify=r=>r?.providerName===NAME||r?.payload?.dynamicType===TYPE?"recent":"recommended";
    const recentCount=rows.filter(r=>classify(r)==="recent").length;
    const counts={recent:0,recommended:0};
    return rows.map(r=>{
      const group=classify(r),index=counts[group]++;
      const column=Math.floor(index/3)+1,local=index%3;
      const row=(group==="recent"?0:Math.min(3,recentCount))+local+1;
      const railLength=group==="recent"&&local===0?Math.min(3,recentCount-index):0;
      return {group,index,first:index===0,top:local===0,column,row,railLength};
    });
  }
  function remember(state,entry){
    const token=String(++state.sequence);
    state.targets.set(token,{...entry});
    // Keep old visible rows usable during native result handoff, but bound
    // references. Closed/moved/navigated targets are always revalidated.
    while(state.targets.size>64)state.targets.delete(state.targets.keys().next().value);
    return token;
  }
  function makeProvider(Base,Shared,Result,utils,sessionStore,registry,manager,privateUtils){
    return new class extends Base {
      get name(){return NAME;}
      get type(){return Shared.PROVIDER_TYPE.PROFILE;}
      getPriority(context){
        const top=manager.getProvider?.("UrlbarProviderTopSites");
        try{return top?.getPriority(context)??1;}catch{return 1;}
      }
      state(controller){
        let win=null,state=null;
        try{
          win=controller?.browserWindow||controller?.input?.browserWindow;
          state=registry.windows.get(win)||registry.byId?.get(outerId(win))||registry.controllers?.get(controller);
          if(state?.win)win=state.win;
          if(!win||win.closed||!state||privateUtils.isWindowPrivate(win))return null;
        }catch{return null;}
        return {win,state};
      }
      async isActive(context,controller){
        const scope=this.state(controller);
        const allowed=!!scope&&queryAllowed(context,Shared.RESULT_SOURCE.TABS,
          prefs.getBoolPref(PREF,true),prefs.getBoolPref("browser.urlbar.suggest.openpage",true));
        if(scope?.state.diagnostic){
          const d=scope.state.diagnostic;
          d.queries++;d.eligible=allowed;
          d.empty=context.searchString==="";d.hasTabSource=context.sources?.includes(Shared.RESULT_SOURCE.TABS)??false;
          if(!allowed)d.emitted=0;
        }
        if(!context.isPrivate&&context.searchString===""){
          if(scope?.state.diagnostic){
            const d=scope.state.diagnostic;d.started=false;d.candidates=0;d.emitted=0;
            console.info("[Zen Refined] Smart Search query: eligible="+allowed+
              " tabsSource="+d.hasTabSource+" enabled="+prefs.getBoolPref(PREF,true)+
              " openpage="+prefs.getBoolPref("browser.urlbar.suggest.openpage",true)+
              " restricted="+!!(context.searchMode||context.restrictSource||context.restrictInSearchMode?.()));
          }else if(!scope)console.info("[Zen Refined] Smart Search query: no matching browser window");
        }
        return allowed;
      }
      async startQuery(context,add,controller){
        const scope=this.state(controller);
        if(!scope||!queryAllowed(context,Shared.RESULT_SOURCE.TABS,prefs.getBoolPref(PREF,true),prefs.getBoolPref("browser.urlbar.suggest.openpage",true)))return;
        const {win,state}=scope;
        const candidates=collect(win,sessionStore,utils,state.activity);
        const entries=selectRecent(candidates,context.maxResults,6);
        if(state.diagnostic){state.diagnostic.started=true;state.diagnostic.candidates=candidates.length;state.diagnostic.emitted=0;}
        for(let i=0;i<entries.length;i++){
          const e=entries[i],token=remember(state,e);
          const detail=[domain(e.url),!e.current?e.workspace:"",e.container].filter(Boolean).join(" · ");
          try{add(this,new Result({
            type:Shared.RESULT_TYPE.DYNAMIC,source:Shared.RESULT_SOURCE.TABS,
            suggestedIndex:i,
            payload:{dynamicType:TYPE,zrToken:token,zrTitle:e.title,zrDetail:detail,
              zrIcon:Shared.getIconForUrl(e.url),zrTime:relativeTime(e.last,e.selected),zrCurrent:!!e.selected}
          }));if(state.diagnostic)state.diagnostic.emitted++;}
          catch(e){if(state.diagnostic)state.diagnostic.error=String(e);console.warn("[Zen Refined] Smart Search result:",e);}
        }
        if(state.diagnostic)console.info("[Zen Refined] Smart Search results: candidates="+state.diagnostic.candidates+" emitted="+state.diagnostic.emitted+" limit="+context.maxResults);
      }
      getViewTemplate(){
        return {attributes:{selectable:true},children:[
          {name:"time",tag:"span",classList:["zr-smart-time"]},
          {name:"icon",tag:"img",classList:["urlbarView-favicon"]},
          {name:"body",tag:"span",classList:["zr-smart-body"],children:[
            {name:"title",tag:"span",classList:["urlbarView-title"],overflowable:true},
            {name:"detail",tag:"span",classList:["urlbarView-url"],overflowable:true}
          ]},
          {name:"action",tag:"span",classList:["urlbarView-action","urlbarView-switchToTab"]}
        ]};
      }
      getViewUpdate(result){
        const p=result.payload;
        return {
          time:{textContent:p.zrTime},
          icon:{attributes:{src:p.zrIcon||"chrome://global/skin/icons/defaultFavicon.svg"}},
          title:{textContent:p.zrTitle,attributes:{dir:"auto"}},
          detail:{textContent:p.zrDetail,attributes:{dir:"auto"}},
          action:{textContent:p.zrCurrent?"Current tab":"Switch to Tab"}
        };
      }
      onEngagement(context,controller,details){
        if(details?.result?.payload?.dynamicType!==TYPE||["dismiss","help"].includes(details.selType))return;
        const scope=this.state(controller);
        if(!scope||context.isPrivate||!prefs.getBoolPref(PREF,true))return;
        const {win,state}=scope,entry=state.targets.get(details.result.payload.zrToken);
        if(!validTarget(win,entry,sessionStore))return;
        // Select the exact existing tab, not a URL. Zen's native
        // onBeforeTabSelect handles changing workspace when necessary.
        // A closed result never falls back to navigation or creates a tab.
        try{
          win.gBrowser.selectedTab=entry.tab;
          if(win.gBrowser.selectedTab===entry.tab)entry.tab.linkedBrowser.focus?.();
        }catch(e){console.warn("[Zen Refined] Recent tab selection:",e);}
      }
    };
  }
  let manager=null,registry=null,disposed=false,observer=null,joined=false,listener=null,child=null,parent=null,windowId=null;
  let bar=null,tabContainer=null,originalQuery=null,wrappedQuery=null,layoutRows=null,resizeObserver=null,openObserver=null,readyObserver=null,prefObserver=null,refreshTimer=0,inFlight=false,initialRecovered=false,ready=false,activeContext=null,windowState=null;
  let recoveryAttempts=0,topSitesObserver=null,wasOpen=false,refreshIsInitial=false;
  const diagnostic={version:6,stage:"waiting",queries:0,eligible:false,empty:false,hasTabSource:false,candidates:0,emitted:0,error:null};
  const status=()=>({...diagnostic,registered:!!joined&&manager?.getProvider?.(NAME)===registry?.provider});
  window[STATUS]=status;
  const ROW_ATTRS=["data-zr-group","data-zr-first","data-zr-top","data-zr-cell","data-zr-rail","data-zr-column"];
  function clearLayout(){
    if(!layoutRows)return;
    layoutRows.removeAttribute("data-zr-smart-grid");
    layoutRows.removeAttribute("data-zr-narrow");
    layoutRows.removeAttribute("data-zr-timeline");
    for(const row of layoutRows.children)for(const a of ROW_ATTRS)row.removeAttribute(a);
  }
  function layout(context){
    if(!bar?.view?.isOpen||!context||!zeroPrefix(context,prefs.getBoolPref(PREF,true),prefs.getBoolPref("browser.urlbar.suggest.openpage",true))){clearLayout();return;}
    const rows=bar.view.panel?.querySelector(".urlbarView-results")||bar.querySelector?.(".urlbarView-results");
    if(!rows)return;
    if(layoutRows!==rows){clearLayout();resizeObserver?.disconnect();layoutRows=rows;
      if(window.ResizeObserver){resizeObserver=new window.ResizeObserver(()=>{if(layoutRows===rows&&rows.hasAttribute("data-zr-smart-grid"))rows.toggleAttribute("data-zr-narrow",rows.clientWidth<530);});resizeObserver.observe(rows);}
    }
    const visible=Array.from(rows.children).filter(row=>row.result&&!row.hidden&&!row.hasAttribute("hidden")&&!row.hasAttribute("stale")&&row.style.display!=="none");
    // Never insert or reorder native children: Gecko owns rowIndex and all
    // keyboard/ARIA selection. During stale handoff keep its native layout.
    if(!visible.length||Array.from(rows.children).some(r=>r.hasAttribute("stale"))){clearLayout();return;}
    const plan=groupPlan(visible.map(r=>r.result));
    let nativeSeen=false;
    for(const p of plan){if(p.group==="recommended")nativeSeen=true;else if(nativeSeen){clearLayout();return;}}
    // Keep existing attributes intact on repeated notifications so the rail
    // animation is not restarted during the same open search.
    for(const row of rows.children)if(!visible.includes(row))for(const a of ROW_ATTRS)row.removeAttribute(a);
    visible.forEach((row,i)=>{
      const p=plan[i];row.setAttribute("data-zr-group",p.group);
      row.toggleAttribute("data-zr-top",p.top);
      row.setAttribute("data-zr-cell",p.row+"-"+p.column);
      row.setAttribute("data-zr-column",String(p.column));
      if(p.railLength)row.setAttribute("data-zr-rail",String(p.railLength));else row.removeAttribute("data-zr-rail");
      if(p.first)row.setAttribute("data-zr-first",p.group==="recent"?"Recent tabs":"Recommended");else row.removeAttribute("data-zr-first");
    });
    rows.toggleAttribute("data-zr-narrow",rows.clientWidth<530);
    rows.setAttribute("data-zr-smart-grid","true");
    if(!rows.hasAttribute("data-zr-timeline"))rows.setAttribute("data-zr-timeline","true");
  }
  function eligibleInput(){
    return !!bar?.focused&&!bar.searchMode&&!bar._suppressStartQuery&&
      (bar.value===""||bar.getAttribute?.("pageproxystate")==="valid")&&
      prefs.getBoolPref(PREF,true)&&prefs.getBoolPref("browser.urlbar.suggest.openpage",true)&&
      !bar.inOverflowPanel&&(bar.view?.isOpen||bar.hasAttribute?.("zen-newtab")||bar.hasAttribute?.("breakout-extend"));
  }
  function recommendationsEnabled(){
    return prefs.getBoolPref?.("browser.urlbar.suggest.topsites",true)!==false&&
      prefs.getBoolPref?.("browser.newtabpage.activity-stream.feeds.system.topsites",true)!==false;
  }
  function countResults(rows){
    const recent=rows.filter(r=>r.providerName===NAME||r.payload?.dynamicType===TYPE).length;
    return {recent,recommended:rows.length-recent};
  }
  function recoveryNeeded(){
    return !initialRecovered&&ready&&recoveryAttempts<RETRY_DELAYS.length&&
      (!(diagnostic.visible>0)||recommendationsEnabled()&&!(diagnostic.recommended>0));
  }
  function cancelRefresh(){if(refreshTimer)window.clearTimeout(refreshTimer);refreshTimer=0;refreshIsInitial=false;}
  function finishRecovery(){initialRecovered=true;if(refreshIsInitial)cancelRefresh();}
  function scheduleRefresh(initial=false,fromTopSites=false){
    if(disposed||!joined||!window.setTimeout||!eligibleInput()||initial&&!recoveryNeeded())return;
    // A native readiness signal can shorten a pending retry. Normal focus
    // and attribute notifications must not keep pushing its deadline back.
    if(refreshTimer&&initial&&refreshIsInitial&&!fromTopSites)return;
    cancelRefresh();refreshIsInitial=initial;
    const delay=initial?(fromTopSites?60:RETRY_DELAYS[recoveryAttempts]):65;
    refreshTimer=window.setTimeout(()=>{
      refreshTimer=0;refreshIsInitial=false;
      if(disposed||!eligibleInput()||inFlight||bar.view?.selectedElement||initial&&!recoveryNeeded())return;
      if(initial){
        recoveryAttempts++;diagnostic.recoveryAttempts=recoveryAttempts;
        console.info("[Zen Refined] Smart Search startup refresh: attempt="+recoveryAttempts);
      }
      try{bar.view?.clearTopSitesCache?.();bar.startQuery({allowAutofill:false,resetSearchState:false});}
      catch(e){console.warn("[Zen Refined] Smart Search refresh:",e);}
    },delay);
  }
  function onActivation(e){
    const tab=e?.target||window.gBrowser?.selectedTab;
    if(tab&&availableTab(window,tab))windowState?.activity.set(tab,Date.now());
    try{bar?.view?.clearTopSitesCache?.();}catch{}
    if(bar?.view?.isOpen&&!bar.view.selectedElement)scheduleRefresh(false);
  }
  function onFocus(){scheduleRefresh(true);}
  function nextRow(index,count,reverse){
    if(count<1)return -1;
    if(index<0)return reverse?count-1:0;
    return (index+(reverse?-1:1)+count)%count;
  }
  function onGridTab(e){
    if(e.key!=="Tab"||e.ctrlKey||e.altKey||e.metaKey||e.defaultPrevented||e.isComposing||
       !bar?.focused||!bar.view?.isOpen||!layoutRows?.hasAttribute("data-zr-smart-grid")||
       !activeContext||activeContext.searchString!==""||!prefs.getBoolPref(PREF,true)||
       !(e.target===bar.inputField||bar.contains?.(e.target)))return;
    const view=bar.view,n=view.visibleRowCount;
    if(!Number.isInteger(n)||n<1)return;
    try{
      const next=nextRow(view.selectedRowIndex,n,e.shiftKey);
      // Select the native row, not its secondary action or search-mode button.
      // Leave Enter, Escape, Ctrl+Tab and ordinary typed queries untouched.
      view.selectedRowIndex=next;
      e.preventDefault();e.stopImmediatePropagation();
    }catch(e){console.warn("[Zen Refined] Smart Search Tab:",e);}
  }
  function onEscape(e){if(["Escape","Tab","ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Enter"].includes(e.key)){cancelRefresh();finishRecovery();}}
  function onResultPointer(e){if(e.target?.closest?.(".urlbarView-row")){cancelRefresh();finishRecovery();}}
  function onTopSitesReady(){
    if(disposed||!joined||!recommendationsEnabled())return;
    try{bar?.view?.clearTopSitesCache?.();}catch{}
    if(recoveryNeeded()&&bar?.view?.isOpen&&!inFlight)scheduleRefresh(true,true);
  }
  function onReady(){
    ready=true;onActivation();scheduleRefresh(true);
  }
  function install(){
    if(disposed||joined)return;
    try{
      const base="moz-src:///browser/components/urlbar/";
      const {ProvidersManager}=ChromeUtils.importESModule(base+"UrlbarProvidersManager.sys.mjs");
      const {UrlbarProvider,UrlbarUtils}=ChromeUtils.importESModule(base+"UrlbarUtils.sys.mjs");
      const {UrlbarShared}=ChromeUtils.importESModule("chrome://browser/content/urlbar/UrlbarShared.mjs");
      const {UrlbarResult}=ChromeUtils.importESModule("chrome://browser/content/urlbar/UrlbarResult.mjs");
      // Zen 1.24.2b / Gecko 160: use the same module path as native Library.
      // Older Firefox used a resource:/// alias; do not let optional lazy
      // metadata support prevent the provider itself from registering.
      let SessionStore=null;
      try{({SessionStore}=ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs"));}
      catch{try{({SessionStore}=ChromeUtils.importESModule("resource:///modules/sessionstore/SessionStore.sys.mjs"));}catch{diagnostic.lazyMetadataUnavailable=true;}}
      const {PrivateBrowsingUtils}=ChromeUtils.importESModule("resource://gre/modules/PrivateBrowsingUtils.sys.mjs");
      if(PrivateBrowsingUtils.isWindowPrivate(window)){diagnostic.stage="private";return;}
      child=window.gURLBar?.controller;
      parent=window.gURLBar?.parentController||child?.parentController;
      const direct=parent?.manager;
      manager=direct?.registerProvider&&direct?.getProvider?direct:ProvidersManager?.getInstanceForSap?.("urlbar");
      if(!manager?.registerProvider||!manager?.unregisterProvider||!manager?.getProvider)throw Error("Native urlbar provider manager unavailable");
      registry=manager[REGISTRY];
      if(!registry){
        if(manager.getProvider(NAME))throw Error("Provider name already registered");
        registry={windows:new WeakMap(),byId:new Map(),controllers:new WeakMap(),count:0,provider:null};
        registry.provider=makeProvider(UrlbarProvider,UrlbarShared,UrlbarResult,UrlbarUtils,SessionStore,registry,manager,PrivateBrowsingUtils);
        manager.registerProvider(registry.provider);
        manager[REGISTRY]=registry;
      }
      registry.byId??=new Map();registry.controllers??=new WeakMap();
      const state={win:window,sequence:0,targets:new Map(),activity:new WeakMap(),diagnostic};
      windowState=state;
      registry.windows.set(window,state);windowId=outerId(window);
      if(windowId!==null)registry.byId.set(windowId,state);
      if(parent&&(typeof parent==="object"||typeof parent==="function"))registry.controllers.set(parent,state);
      registry.count++;joined=true;
      diagnostic.stage="ready";diagnostic.error=null;
      // Only counts and flags; never log URLs, titles or typed text.
      bar=window.gURLBar;
      // Mutate only this native zero-prefix context, before its parent
      // dispatch. Never change maxRichResults or the typed-query budget.
      if(typeof child?.startQuery==="function"){
        originalQuery=child.startQuery;
        wrappedQuery=function(context,...args){
          if(zeroPrefix(context,prefs.getBoolPref(PREF,true),prefs.getBoolPref("browser.urlbar.suggest.openpage",true))){
            const entries=collect(window,SessionStore,UrlbarUtils,state.activity);
            context.maxResults=resultBudget(entries);
          }
          return Reflect.apply(originalQuery,this,[context,...args]);
        };
        child.startQuery=wrappedQuery;
      }
      listener={
        onQueryStarted(context){
          inFlight=true;activeContext=context;cancelRefresh();
          if(context.isPrivate||context.searchString!==""){finishRecovery();clearLayout();return;}
          diagnostic.viewQueries=(diagnostic.viewQueries||0)+1;
          console.info("[Zen Refined] Smart Search native query started");
        },
        onQueryResults(context){activeContext=context;layout(context);},
        onQueryCancelled(){inFlight=false;},
        onQueryFinished(context){
          inFlight=false;activeContext=context;layout(context);
          if(context.isPrivate||context.searchString!=="")return;
          const rows=context.results||[];
          const counts=countResults(rows);
          diagnostic.visible=counts.recent;diagnostic.recommended=counts.recommended;
          console.info("[Zen Refined] Smart Search native finished: recent="+counts.recent+" recommended="+counts.recommended+" total="+rows.length);
          // Recent tabs can be ready before native Top Sites are populated.
          // Do not mark startup recovered just because our rows exist.
          if(counts.recommended>0&&(counts.recent>0||diagnostic.candidates===0)||
             counts.recent>0&&!recommendationsEnabled())finishRecovery();
          else if(recoveryNeeded())scheduleRefresh(true);
          else if(recoveryAttempts>=RETRY_DELAYS.length)finishRecovery();
        }
      };
      try{child?.addListener?.(listener);}catch{}
      tabContainer=window.gBrowser?.tabContainer;
      tabContainer?.addEventListener?.("TabSelect",onActivation);
      bar?.addEventListener?.("focusin",onFocus);
      bar?.addEventListener?.("keydown",onEscape,true);
      bar?.addEventListener?.("pointerdown",onResultPointer,true);
      topSitesObserver=()=>onTopSitesReady();
      for(const topic of TOPICS)try{Services.obs.addObserver(topSitesObserver,topic);}catch{}
      window.addEventListener("keydown",onGridTab,true);
      if(window.MutationObserver&&bar?.nodeType){
        openObserver=new window.MutationObserver(()=>{
          const open=!!bar.view?.isOpen;
          if(!open){clearLayout();if(wasOpen){cancelRefresh();finishRecovery();}}
          else if(activeContext)layout(activeContext);
          wasOpen=open;
          scheduleRefresh(true);
        });
        openObserver.observe(bar,{attributes:true,attributeFilter:["open","zen-newtab","breakout-extend"]});
      }
      wasOpen=!!bar?.view?.isOpen;
      prefObserver=()=>{cancelRefresh();clearLayout();try{bar?.view?.clearTopSitesCache?.();}catch{}};
      prefs.addObserver?.(PREF,prefObserver);
      if(window.gBrowserInit&& !window.gBrowserInit.delayedStartupFinished){
        readyObserver=subject=>{if(subject!==window)return;Services.obs.removeObserver(readyObserver,"browser-delayed-startup-finished");readyObserver=null;onReady();};
        Services.obs.addObserver(readyObserver,"browser-delayed-startup-finished");
      }else onReady();
      console.info("[Zen Refined] Smart Search provider ready (preview.22, manager="+(direct===manager?"address-bar":"singleton")+")");
    }catch(e){diagnostic.stage="error";diagnostic.error=String(e);console.warn("[Zen Refined] Smart Search unavailable:",e);}
  }
  function dispose(){
    if(disposed)return;disposed=true;
    if(observer)try{Services.obs.removeObserver(observer,"browser-delayed-startup-finished");}catch{}
    observer=null;
    cancelRefresh();clearLayout();resizeObserver?.disconnect();openObserver?.disconnect();
    if(readyObserver)try{Services.obs.removeObserver(readyObserver,"browser-delayed-startup-finished");}catch{}
    if(prefObserver)try{prefs.removeObserver?.(PREF,prefObserver);}catch{}
    tabContainer?.removeEventListener?.("TabSelect",onActivation);
    bar?.removeEventListener?.("focusin",onFocus);
    bar?.removeEventListener?.("keydown",onEscape,true);
    bar?.removeEventListener?.("pointerdown",onResultPointer,true);
    if(topSitesObserver)for(const topic of TOPICS)try{Services.obs.removeObserver(topSitesObserver,topic);}catch{}
    topSitesObserver=null;
    window.removeEventListener("keydown",onGridTab,true);
    if(child&&wrappedQuery&&child.startQuery===wrappedQuery)child.startQuery=originalQuery;
    try{bar?.view?.clearTopSitesCache?.();}catch{}
    try{if(listener)child?.removeListener?.(listener);}catch{}
    listener=null;
    if(joined&&registry){
      registry.windows.get(window)?.targets.clear();registry.windows.delete(window);
      if(windowId!==null)registry.byId?.delete(windowId);if(parent)registry.controllers?.delete(parent);
      registry.count--;joined=false;
      if(registry.count===0&&manager?.[REGISTRY]===registry){
        try{if(manager.getProvider(NAME)===registry.provider)manager.unregisterProvider(registry.provider);}catch{}
        delete manager[REGISTRY];
      }
    }
    window.removeEventListener("unload",dispose);
    if(window[KEY]===dispose)delete window[KEY];
    if(window[STATUS]===status)delete window[STATUS];
  }
  window[KEY]=dispose;window.addUnloadListener(dispose);window.addEventListener("unload",dispose,{once:true});
  if(window.gBrowserInit?.delayedStartupFinished||(window.gBrowser&&window.gURLBar))install();
  else{
    observer=subject=>{if(subject!==window)return;Services.obs.removeObserver(observer,"browser-delayed-startup-finished");observer=null;install();};
    Services.obs.addObserver(observer,"browser-delayed-startup-finished");
  }
})();
