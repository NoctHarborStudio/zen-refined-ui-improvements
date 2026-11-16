import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../smart-search.uc.mjs",import.meta.url),"utf8");
const start=source.indexOf("function outerId("),end=source.indexOf("let manager=null",start);
const api=new Function("prefs","PREF","LIMIT","NAME","TYPE",source.slice(start,end)+"return {queryAllowed,selectRecent,availableTab,eligibleUrl,collect,validTarget,remember,makeProvider,relativeTime,resultBudget,groupPlan,zeroPrefix};")({getBoolPref:()=>true,getIntPref:()=>4},"enable","limit","provider","zr-recent-tab");
const context={searchString:"",isPrivate:false,sources:[4]};
test("only unrestricted empty normal-window tab queries",()=>{
 assert.equal(api.queryAllowed(context,4,true,true),true);
 for(const c of [{searchString:"x"},{searchString:" "},{isPrivate:true},{searchMode:{}},{restrictSource:4},{sources:[2]}])assert.equal(api.queryAllowed({...context,...c},4,true,true),false);
 assert.equal(api.queryAllowed(context,4,false,true),false);
 assert.equal(api.queryAllowed(context,4,true,false),false);
});
test("prefer current space for selection, display by time, reserve six native slots",()=>{
 const entries=[{id:"other",last:100,current:false,order:0},{id:"old",last:10,current:true,order:1},{id:"new",last:20,current:true,order:2},{id:"bad",last:0,current:true,order:3}];
 assert.deepEqual(api.selectRecent(entries,9,6).map(x=>x.id),["other","new","old"]);
 assert.equal(api.selectRecent(entries,7,6)[0].id,"new");
 assert.equal(api.selectRecent(entries,6,6).length,0);
});
function fixture(){
 const win={closed:false,gBrowser:{},gZenWorkspaces:{activeWorkspace:"A",getWorkspaces:()=>[{uuid:"A",name:"Free"},{uuid:"B",name:"Work"}]}};
 const tab=(space,last,url,pending=false,container=0)=>{
   const attrs=new Map([["zen-workspace-id",space],["usercontextid",String(container)]]);
   if(pending)attrs.set("pending","true");
   return {ownerGlobal:win,isConnected:true,closing:false,linkedPanel:pending?null:"panel",lastAccessed:last,label:"Same title",hasAttribute:k=>attrs.has(k),getAttribute:k=>attrs.get(k)||null,linkedBrowser:pending?{get currentURI(){throw Error("lazy browser read")}}:{currentURI:{spec:url}},lazyUrl:url};
 };
 const a=tab("A",30,"https://same.test",false,0),b=tab("B",99,"https://same.test",true,1),selected=tab("A",90,"https://current.test"),closed=tab("A",80,"https://closed.test");closed.closing=true;
 win.gBrowser.selectedTab=selected;win.gBrowser.tabs=[a,b,selected,closed];win.gZenWorkspaces.allStoredTabs=win.gBrowser.tabs;
 const session={getLazyTabValue:(t,k)=>t.lazyUrl},utils={getUserContextData:()=>({label:"Work container"})};
 return {win,a,b,selected,closed,session,utils};
}
test("native identity, workspace and lazy metadata without remote reads",()=>{
 const f=fixture(),rows=api.collect(f.win,f.session,f.utils);
 assert.equal(rows.length,3);assert.equal(rows[0].tab,f.a);assert.equal(rows[1].tab,f.b);assert.equal(rows[2].selected,true);
 assert.equal(rows[1].container,"Work container");assert.equal(rows[1].workspace,"Work");
 assert.equal(api.validTarget(f.win,rows[1],f.session),true);
 f.b.closing=true;assert.equal(api.validTarget(f.win,rows[1],f.session),false);
});
test("tokens are bounded and never redirect a stale target",()=>{
 const state={sequence:0,targets:new Map()};
 for(let i=0;i<80;i++)api.remember(state,{url:String(i)});
 assert.equal(state.targets.size,64);assert.equal(state.targets.has("1"),false);assert.equal(state.targets.get("80").url,"79");
});
test("provider uses actual query window and switches exact duplicate URL tab",async()=>{
 const f=fixture(),registry={windows:new WeakMap()},state={sequence:0,targets:new Map()};registry.windows.set(f.win,state);
 const Shared={PROVIDER_TYPE:{PROFILE:1},RESULT_SOURCE:{TABS:4},RESULT_TYPE:{DYNAMIC:8},getIconForUrl:u=>"icon"};
 const P=api.makeProvider(class{},Shared,class{constructor(p){Object.assign(this,p)}},f.utils,f.session,registry,{getProvider:()=>({getPriority:()=>1})},{isWindowPrivate:()=>false});
 const controller={browserWindow:f.win},results=[];
 assert.equal(await P.isActive(context,controller),true);
 assert.equal(await P.isActive(context,{browserWindow:{}}),false);
 await P.startQuery({...context,maxResults:9},(_,r)=>results.push(r),controller);
 assert.equal(results.length,3);assert.equal(results[0].payload.zrCurrent,true);
 P.onEngagement(context,controller,{result:results[1],selType:"enter"});
 assert.equal(f.win.gBrowser.selectedTab,f.b);
 f.win.gBrowser.selectedTab=f.a;f.b.closing=true;
 P.onEngagement(context,controller,{result:results[1],selType:"enter"});
 assert.equal(f.win.gBrowser.selectedTab,f.a);
});

test("actual script registers with Gecko 160 SessionStore path and survives missing optional metadata",()=>{
 for(const hasStore of [true,false]){
  const names=[],providers=new Map(),logs=[];
  const manager={getProvider:n=>providers.get(n),registerProvider:p=>providers.set(p.name,p),unregisterProvider:p=>providers.delete(p.name)};
  const w={gBrowser:{},gURLBar:{},addUnloadListener(){},addEventListener(){},removeEventListener(){}};
  const shared={PROVIDER_TYPE:{PROFILE:1},RESULT_SOURCE:{TABS:4},RESULT_TYPE:{DYNAMIC:8},getIconForUrl:()=>"icon"};
  const modules={
   "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs":{ProvidersManager:{getInstanceForSap:()=>manager}},
   "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs":{UrlbarProvider:class{},UrlbarUtils:{}},
   "chrome://browser/content/urlbar/UrlbarShared.mjs":{UrlbarShared:shared},
   "chrome://browser/content/urlbar/UrlbarResult.mjs":{UrlbarResult:class{}},
   "resource://gre/modules/PrivateBrowsingUtils.sys.mjs":{PrivateBrowsingUtils:{isWindowPrivate:()=>false}},
  };
  if(hasStore)modules["moz-src:///browser/components/sessionstore/SessionStore.sys.mjs"]={SessionStore:{}};
  const chrome={importESModule(path){names.push(path);if(!modules[path])throw Error("missing "+path);return modules[path];}};
  const services={prefs:{},obs:{addObserver(){throw Error("unexpected wait")}}};
  new Function("window","document","Services","ChromeUtils","console",source)(w,{documentElement:{hasAttribute:()=>false}},services,chrome,{info:m=>logs.push(m),warn:m=>logs.push(m)});
  assert.equal(w.__zenRefinedSmartSearchStatus().registered,true);
  assert.equal(w.__zenRefinedSmartSearchStatus().stage,"ready");
  assert.equal(names.includes("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs"),true);
  assert.equal(names.includes("resource:///modules/sessionstore/SessionStore.sys.mjs"),!hasStore);
  w.__zenRefinedSmartSearch();assert.equal(providers.size,0);
 }
});

test("workspace collection can be incomplete; native tabs are still included",()=>{
 const f=fixture();f.win.gZenWorkspaces.allStoredTabs=[];
 assert.equal(api.collect(f.win,f.session,f.utils).length,3);
});
test("native view listener reports final result counts and detaches on unload",()=>{
 const w={gBrowser:{},addUnloadListener(){},addEventListener(){},removeEventListener(){}};
 const providers=new Map(),logs=[];let listener;
 const actual={registerProvider:p=>providers.set(p.name,p),getProvider:n=>providers.get(n),unregisterProvider:p=>providers.delete(p.name)};
 w.gURLBar={controller:{addListener(l){listener=l;},removeListener(l){if(listener===l)listener=null;}},parentController:{manager:actual}};
 const modules={
  "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs":{ProvidersManager:{getInstanceForSap(){throw Error("wrong manager")}}},
  "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs":{UrlbarProvider:class{},UrlbarUtils:{}},
  "chrome://browser/content/urlbar/UrlbarShared.mjs":{UrlbarShared:{PROVIDER_TYPE:{PROFILE:1}}},
  "chrome://browser/content/urlbar/UrlbarResult.mjs":{UrlbarResult:class{}},
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs":{PrivateBrowsingUtils:{isWindowPrivate:()=>false}},
  "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs":{SessionStore:{}}
 };
 new Function("window","document","Services","ChromeUtils","console",source)(w,{documentElement:{hasAttribute:()=>false}},{prefs:{},obs:{}},{importESModule:p=>modules[p]},{info:m=>logs.push(m),warn:m=>logs.push(m)});
 assert.equal(w.__zenRefinedSmartSearchStatus().registered,true);
 listener.onQueryFinished({searchString:"",results:[{providerName:"ZenRefinedRecentTabs"},{providerName:"native"}]});
 assert.equal(w.__zenRefinedSmartSearchStatus().visible,1);
 assert.equal(logs.at(-1),"[Zen Refined] Smart Search native finished: recent=1 recommended=1 total=2");
 w.__zenRefinedSmartSearch();assert.equal(listener,null);assert.equal(providers.size,0);
});

test("current tab is immediate, explicit activation outranks stale timestamp",()=>{
 const f=fixture(),activity=new WeakMap();activity.set(f.a,Date.now()-1200);
 const rows=api.selectRecent(api.collect(f.win,f.session,f.utils,activity),12,6);
 assert.equal(rows[0].tab,f.selected);assert.equal(rows[1].tab,f.a);
 assert.equal(api.relativeTime(rows[0].last,true),"Now");
 assert.equal(api.relativeTime(1000,false,181000),"3m ago");
 assert.equal(api.relativeTime(1000,false,7201000),"2h ago");
});
test("6+6 budget and group starts preserve original row order",()=>{
 const e=Array.from({length:9},(_,i)=>({last:i+1}));
 assert.equal(api.resultBudget(e),12);
 assert.equal(api.resultBudget(e.slice(0,3)),9);
 assert.equal(api.selectRecent(e,12,6).length,6);
 const recent={payload:{dynamicType:"zr-recent-tab"}},native={providerName:"native"};
 assert.deepEqual(api.groupPlan([recent,recent,recent,native,native]).map(x=>[x.group,x.first,x.top]),[["recent",true,true],["recent",false,false],["recent",false,false],["recommended",true,true],["recommended",false,false]]);
 assert.equal(api.zeroPrefix({searchString:"",sapName:"urlbar"},true,true),true);
 assert.equal(api.zeroPrefix({searchString:"typed",sapName:"urlbar"},true,true),false);
 assert.equal(api.zeroPrefix({searchString:"",isPrivate:true},true,true),false);
});

test("actual lifecycle raises only zero-prefix budget, groups native rows and performs one initial recovery",()=>{
 const fixtureData=fixture(),w=fixtureData.win,providers=new Map(),logs=[],timers=new Map(),events={};let listener,serial=0,queries=0;
 const node=(result=null)=>{const attrs=new Map();return {result,style:{},children:[],clientWidth:900,hasAttribute:k=>attrs.has(k),getAttribute:k=>attrs.get(k),setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),toggleAttribute(k,v){v?attrs.set(k,""):attrs.delete(k);}};};
 const rows=node();rows.children=[node({providerName:"ZenRefinedRecentTabs"}),node({providerName:"ZenRefinedRecentTabs"}),node({providerName:"native"})];
 const actual={registerProvider:p=>providers.set(p.name,p),getProvider:n=>providers.get(n),unregisterProvider:p=>providers.delete(p.name)};
 const original=c=>c.maxResults;
 const child={startQuery:original,addListener(l){listener=l;},removeListener(l){if(listener===l)listener=null;}};
 w.addUnloadListener=()=>{};w.addEventListener=()=>{};w.removeEventListener=()=>{};
 w.setTimeout=fn=>{const n=++serial;timers.set(n,fn);return n;};w.clearTimeout=n=>timers.delete(n);
 w.gURLBar={controller:child,parentController:{manager:actual},focused:true,value:"",view:{isOpen:true,selectedElement:null,panel:{querySelector:()=>rows},clearTopSitesCache(){}},startQuery(){queries++;},addEventListener:(k,fn)=>events[k]=fn,removeEventListener:k=>delete events[k]};
 w.gBrowser.tabContainer={addEventListener:(k,fn)=>events[k]=fn,removeEventListener:k=>delete events[k]};
 const modules={
  "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs":{ProvidersManager:{}},
  "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs":{UrlbarProvider:class{},UrlbarUtils:fixtureData.utils},
  "chrome://browser/content/urlbar/UrlbarShared.mjs":{UrlbarShared:{PROVIDER_TYPE:{PROFILE:1}}},
  "chrome://browser/content/urlbar/UrlbarResult.mjs":{UrlbarResult:class{}},
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs":{PrivateBrowsingUtils:{isWindowPrivate:()=>false}},
  "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs":{SessionStore:fixtureData.session}
 };
 const prefs={getBoolPref:()=>true,addObserver(){},removeObserver(){}};
 new Function("window","document","Services","ChromeUtils","console",source)(w,{documentElement:{hasAttribute:()=>false}},{prefs,obs:{}},{importESModule:p=>modules[p]},{info:m=>logs.push(m),warn:m=>logs.push(m)});
 assert.equal(child.startQuery({searchString:"",maxResults:5,sapName:"urlbar"}),9);
 assert.equal(child.startQuery({searchString:"typed",maxResults:5,sapName:"urlbar"}),5);
 assert.equal(child.startQuery({searchString:"",isPrivate:true,maxResults:5}),5);
 // The first-ready refresh is coalesced and not repeated.
 const fire=()=>{const pending=[...timers.values()];timers.clear();for(const fn of pending)fn();};
 fire();assert.equal(queries,1);
 listener.onQueryFinished({searchString:"",results:rows.children.map(r=>r.result)});
 events.focusin();fire();assert.equal(queries,1);
 listener.onQueryResults({searchString:"",results:rows.children.map(r=>r.result)});
 assert.equal(rows.hasAttribute("data-zr-smart-grid"),true);
 assert.equal(rows.children[0].getAttribute("data-zr-first"),"Recent tabs");
 assert.equal(rows.children[2].getAttribute("data-zr-first"),"Recommended");
 listener.onQueryStarted({searchString:"x"});
 assert.equal(rows.hasAttribute("data-zr-smart-grid"),false);
 w.__zenRefinedSmartSearch();assert.equal(child.startQuery,original);assert.equal(timers.size,0);
 assert.equal(listener,null);
});

test("column-major geometry keeps chronological DOM order and separate groups",()=>{
 const r={payload:{dynamicType:"zr-recent-tab"}},n={providerName:"native"};
 const p=api.groupPlan([...Array(6).fill(r),...Array(6).fill(n)]);
 assert.deepEqual(p.map(x=>[x.row,x.column]),[[1,1],[2,1],[3,1],[1,2],[2,2],[3,2],[4,1],[5,1],[6,1],[4,2],[5,2],[6,2]]);
 assert.deepEqual(p.map(x=>x.railLength),[3,0,0,3,0,0,0,0,0,0,0,0]);
 const q=api.groupPlan([r,r,n,n,n,n]);
 assert.deepEqual(q.map(x=>[x.row,x.column]),[[1,1],[2,1],[3,1],[4,1],[5,1],[3,2]]);
 assert.equal(q[0].railLength,2);
});
test("native grid Tab wraps rows in chronological order",()=>{
 const i=source.indexOf("function nextRow("),j=source.indexOf("function onGridTab(",i);
 const next=new Function(source.slice(i,j)+"return nextRow;")();
 assert.equal(next(-1,12,false),0);assert.equal(next(2,12,false),3);
 assert.equal(next(11,12,false),0);assert.equal(next(0,12,true),11);
 assert.equal(next(-1,12,true),11);assert.equal(next(-1,0,false),-1);
});

test("space priority chooses the pool, chronology determines display order",()=>{
 const entries=[{id:"a",last:100,current:true,order:0},{id:"b",last:50,current:true,order:1},{id:"c",last:500,current:false,order:2},{id:"d",last:400,current:false,order:3}];
 assert.deepEqual(api.selectRecent(entries,9,6).map(x=>x.id),["c","a","b"]);
 assert.deepEqual(api.selectRecent(entries,8,6).map(x=>x.id),["a","b"]);
});

test("startup recovers missing native recommendations even when Recent tabs already exist",()=>{
 const fixtureData=fixture(),w=fixtureData.win,providers=new Map(),timers=new Map(),events={},observers=new Map();let listener,serial=0,queries=0;
 const actual={registerProvider:p=>providers.set(p.name,p),getProvider:n=>providers.get(n),unregisterProvider:p=>providers.delete(p.name)};
 w.addUnloadListener=()=>{};w.addEventListener=()=>{};w.removeEventListener=()=>{};
 w.setTimeout=(fn,ms)=>{const n=++serial;timers.set(n,{fn,ms});return n;};w.clearTimeout=n=>timers.delete(n);
 w.gURLBar={controller:{startQuery(){},addListener(l){listener=l;},removeListener(){}},parentController:{manager:actual},focused:true,value:"",view:{isOpen:true,selectedElement:null,clearTopSitesCache(){}},startQuery(){queries++;},addEventListener:(k,fn)=>events[k]=fn,removeEventListener(){}};
 w.gBrowser.tabContainer={addEventListener(){},removeEventListener(){}};
 const modules={
  "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs":{ProvidersManager:{}},
  "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs":{UrlbarProvider:class{},UrlbarUtils:fixtureData.utils},
  "chrome://browser/content/urlbar/UrlbarShared.mjs":{UrlbarShared:{PROVIDER_TYPE:{PROFILE:1}}},
  "chrome://browser/content/urlbar/UrlbarResult.mjs":{UrlbarResult:class{}},
  "resource://gre/modules/PrivateBrowsingUtils.sys.mjs":{PrivateBrowsingUtils:{isWindowPrivate:()=>false}},
  "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs":{SessionStore:fixtureData.session}
 };
 const prefs={getBoolPref:()=>true,addObserver(){},removeObserver(){}};
 const obs={addObserver:(fn,t)=>observers.set(t,fn),removeObserver:(fn,t)=>observers.delete(t)};
 new Function("window","document","Services","ChromeUtils","console",source)(w,{documentElement:{hasAttribute:()=>false}},{prefs,obs},{importESModule:p=>modules[p]},{info(){},warn(){}});
 const recent={providerName:"ZenRefinedRecentTabs"},native={providerName:"UrlbarProviderTopSites"};
 const finish=results=>{listener.onQueryStarted({searchString:""});listener.onQueryFinished({searchString:"",results});};
 const fire=()=>{const p=[...timers.values()];timers.clear();for(const t of p)t.fn();};
 finish([recent]);assert.equal(timers.size,1);
 assert.equal([...timers.values()][0].ms,180);
 observers.get("topsites-refreshed")();assert.equal([...timers.values()][0].ms,60);
 fire();assert.equal(queries,1);
 finish([recent]);assert.equal([...timers.values()][0].ms,500);
 fire();assert.equal(queries,2);
 finish([recent,native]);assert.equal(timers.size,0);
 observers.get("newtab-top-sites-changed")();assert.equal(timers.size,0);
 assert.equal(w.__zenRefinedSmartSearchStatus().recommended,1);
 w.__zenRefinedSmartSearch();assert.equal(observers.size,0);
});
