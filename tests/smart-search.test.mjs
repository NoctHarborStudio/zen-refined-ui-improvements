import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../smart-search.uc.mjs",import.meta.url),"utf8");
const start=source.indexOf("function queryAllowed("),end=source.indexOf("let manager=null",start);
const api=new Function("prefs","PREF","LIMIT","NAME","TYPE",source.slice(start,end)+"return {queryAllowed,selectRecent,availableTab,eligibleUrl,collect,validTarget,remember,makeProvider};")({getBoolPref:()=>true,getIntPref:()=>4},"enable","limit","provider","zr-recent-tab");
const context={searchString:"",isPrivate:false,sources:[4]};
test("only unrestricted empty normal-window tab queries",()=>{
 assert.equal(api.queryAllowed(context,4,true,true),true);
 for(const c of [{searchString:"x"},{searchString:" "},{isPrivate:true},{searchMode:{}},{restrictSource:4},{sources:[2]}])assert.equal(api.queryAllowed({...context,...c},4,true,true),false);
 assert.equal(api.queryAllowed(context,4,false,true),false);
 assert.equal(api.queryAllowed(context,4,true,false),false);
});
test("rank current space first, preserve two native slots",()=>{
 const entries=[{id:"other",last:100,current:false,order:0},{id:"old",last:10,current:true,order:1},{id:"new",last:20,current:true,order:2},{id:"bad",last:0,current:true,order:3}];
 assert.deepEqual(api.selectRecent(entries,5,4).map(x=>x.id),["new","old","other"]);
 assert.equal(api.selectRecent(entries,3,4).length,1);
 assert.equal(api.selectRecent(entries,2,4).length,0);
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
 assert.equal(rows.length,2);assert.equal(rows[0].tab,f.a);assert.equal(rows[1].tab,f.b);
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
 await P.startQuery({...context,maxResults:5},(_,r)=>results.push(r),controller);
 assert.equal(results.length,2);
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
