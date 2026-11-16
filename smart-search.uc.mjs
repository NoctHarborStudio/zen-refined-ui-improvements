/* Zen Refined — Smart Search.
 * Native URL-bar provider. Recent active tabs are computed on demand;
 * no history database, tab cloning, network requests, or custom input.
 */
(() => {
  const KEY="__zenRefinedSmartSearch",REGISTRY="__zenRefinedSmartSearchRegistry";
  const NAME="ZenRefinedRecentTabs",TYPE="zr-recent-tab",STATUS="__zenRefinedSmartSearchStatus";
  const PREF="zen.refined.smart-search.enabled",LIMIT="zen.refined.smart-search.limit";
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
    const budget=Math.max(0,Math.min(6,Math.floor(requested)||4,Math.floor(maxResults)-2));
    // Keep at least two native suggestion slots. Current space first, then
    // other spaces, each sorted by actual last activation, not visit frequency.
    return entries.filter(e=>Number.isFinite(e.last)&&e.last>0)
      .sort((a,b)=>Number(b.current)-Number(a.current)||b.last-a.last||a.order-b.order)
      .slice(0,budget);
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
  function collect(win,sessionStore,utils){
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
      if(seen.has(tab)||tab===browser.selectedTab||!availableTab(win,tab))continue;
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
        const last=Number(tab.lastAccessed);
        entries.push({tab,url,title,last,current,spaceId,containerId,order:entries.length,
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
        const candidates=collect(win,sessionStore,utils);
        const entries=selectRecent(candidates,context.maxResults,prefs.getIntPref(LIMIT,4));
        if(state.diagnostic){state.diagnostic.started=true;state.diagnostic.candidates=candidates.length;state.diagnostic.emitted=0;}
        for(let i=0;i<entries.length;i++){
          const e=entries[i],token=remember(state,e);
          const detail=[i===0?"Recent tabs":"Recent tab",e.workspace,e.container].filter(Boolean).join(" · ");
          try{add(this,new Result({
            type:Shared.RESULT_TYPE.DYNAMIC,source:Shared.RESULT_SOURCE.TABS,
            suggestedIndex:i,
            payload:{dynamicType:TYPE,zrToken:token,zrTitle:e.title,zrDetail:detail,
              zrIcon:Shared.getIconForUrl(e.url)}
          }));if(state.diagnostic)state.diagnostic.emitted++;}
          catch(e){if(state.diagnostic)state.diagnostic.error=String(e);console.warn("[Zen Refined] Smart Search result:",e);}
        }
        if(state.diagnostic)console.info("[Zen Refined] Smart Search results: candidates="+state.diagnostic.candidates+" emitted="+state.diagnostic.emitted+" limit="+context.maxResults);
      }
      getViewTemplate(){
        return {attributes:{selectable:true},children:[
          {name:"icon",tag:"img",classList:["urlbarView-favicon"]},
          {name:"title",tag:"span",classList:["urlbarView-title"],overflowable:true},
          {name:"detail",tag:"span",classList:["urlbarView-url"],overflowable:true},
          {name:"action",tag:"span",classList:["urlbarView-action","urlbarView-switchToTab"]}
        ]};
      }
      getViewUpdate(result){
        const p=result.payload;
        return {
          icon:{attributes:{src:p.zrIcon||"chrome://global/skin/icons/defaultFavicon.svg"}},
          title:{textContent:p.zrTitle,attributes:{dir:"auto"}},
          detail:{textContent:p.zrDetail,attributes:{dir:"auto"}},
          action:{textContent:"Switch to Tab"}
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
  const diagnostic={version:3,stage:"waiting",queries:0,eligible:false,empty:false,hasTabSource:false,candidates:0,emitted:0,error:null};
  const status=()=>({...diagnostic,registered:!!joined&&manager?.getProvider?.(NAME)===registry?.provider});
  window[STATUS]=status;
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
      const state={win:window,sequence:0,targets:new Map(),diagnostic};
      registry.windows.set(window,state);windowId=outerId(window);
      if(windowId!==null)registry.byId.set(windowId,state);
      if(parent&&(typeof parent==="object"||typeof parent==="function"))registry.controllers.set(parent,state);
      registry.count++;joined=true;
      diagnostic.stage="ready";diagnostic.error=null;
      // Only counts and flags; never log URLs, titles or typed text.
      listener={
        onQueryStarted(context){
          if(context.isPrivate||context.searchString!=="")return;
          diagnostic.viewQueries=(diagnostic.viewQueries||0)+1;
          console.info("[Zen Refined] Smart Search native query started");
        },
        onQueryFinished(context){
          if(context.isPrivate||context.searchString!=="")return;
          const rows=context.results||[];
          diagnostic.visible=rows.filter(r=>r.providerName===NAME||r.payload?.dynamicType===TYPE).length;
          console.info("[Zen Refined] Smart Search native finished: recent="+diagnostic.visible+" total="+rows.length);
        }
      };
      try{child?.addListener?.(listener);}catch{}
      console.info("[Zen Refined] Smart Search provider ready (preview.19, manager="+(direct===manager?"address-bar":"singleton")+")");
    }catch(e){diagnostic.stage="error";diagnostic.error=String(e);console.warn("[Zen Refined] Smart Search unavailable:",e);}
  }
  function dispose(){
    if(disposed)return;disposed=true;
    if(observer)try{Services.obs.removeObserver(observer,"browser-delayed-startup-finished");}catch{}
    observer=null;
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
