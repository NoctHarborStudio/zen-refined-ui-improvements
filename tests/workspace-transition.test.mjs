import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../workspace-transition.uc.mjs",import.meta.url),"utf8");
const i=source.indexOf("function distance("),j=source.indexOf("function units()",i);
const {distance,eligible}=new Function(source.slice(i,j)+"return {distance,eligible};")();
test("center travel is bounded",()=>{
 assert.equal(distance(500,100),400);
 assert.equal(distance(500,900),-400);
 assert.equal(distance(1000,0),440);
});
test("transition bypasses startup, disabled and reduced-motion states",()=>{
 const state={dead:false,busy:false,reduced:false,startup:false,enabled:true,fullscreen:false};
 assert.equal(eligible(state),true);
 for(const flag of ["dead","busy","reduced","startup","fullscreen"])assert.equal(eligible({...state,[flag]:true}),false);
 assert.equal(eligible({...state,enabled:false}),false);
});
test("native switch stays single-owned and chrome-only",()=>{
 assert.ok(!source.includes("changeWorkspaceWithID="));
 assert.ok(!source.includes("tabbrowser-tabpanels"));
 assert.ok(!source.includes("zen-main-browser-background"));
 assert.ok(source.includes('phase("swap");cancelEffects(tx);'));
 assert.ok(source.includes('phase("in");'));
});

function lifecycleFixture(){
 const attrs=()=>new Map(),events=[],timers=new Map(),prefs={getBoolPref:()=>true,addObserver(){},removeObserver(){}};
 let clock=0,id=0;
 const node=()=>{const a=attrs(),styles=new Map();return {isConnected:true,children:[],hidden:false,collapsed:false,
   hasAttribute:k=>a.has(k),setAttribute:(k,v)=>a.set(k,v),removeAttribute:k=>a.delete(k),getAttribute:k=>a.get(k),
   style:{getPropertyValue:k=>styles.get(k)?.[0]||"",getPropertyPriority:k=>styles.get(k)?.[1]||"",setProperty:(k,v,p)=>styles.set(k,[v,p]),removeProperty:k=>styles.delete(k)},
   getBoundingClientRect:()=>({left:30,right:100,top:30,bottom:50,width:70,height:20}),
   animate(){return {finished:Promise.resolve(),cancel(){}};},append(){},remove(){}};};
 const root=node(),bookmarks=node(),old=node(),fresh=node();bookmarks.children=[old];
 const win={innerWidth:1200,innerHeight:800,performance:{now:()=>clock},matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),
   addUnloadListener(){},addEventListener(){},removeEventListener(){},CSS:{registerProperty(){}},
   windowUtils:{USER_SHEET:1,loadSheet(){},removeSheet(){}},getComputedStyle:()=>({display:"block",visibility:"visible",opacity:"1"}),
   CustomEvent:class{constructor(type,o){this.type=type;this.detail=o.detail;}},dispatchEvent:e=>events.push(e.detail.phase),
   MutationObserver:class{observe(){} disconnect(){}},setTimeout(fn,ms){const n=++id;timers.set(n,{fn,at:clock+ms});return n;},clearTimeout:n=>timers.delete(n)};
 const doc={documentElement:root,getElementById:k=>k==="PlacesToolbarItems"?bookmarks:null};
 new Function("window","document","Services","console",source)(win,doc,{prefs,io:{newURI:x=>x}},{warn(){}});
 async function flush(){for(let j=0;j<12;j++)await Promise.resolve();}
 async function advance(){await flush();const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(next){timers.delete(next[0]);clock=next[1].at;next[1].fn();}await flush();}
 return {win,root,bookmarks,old,fresh,events,timers,advance,flush};
}
test("workspace transition keeps native callback single, phases ordered and styles restored",async()=>{
 const f=lifecycleFixture();let calls=0;
 const result=f.win.__zenRefinedWorkspaceTransition.run(()=>{calls++;assert.equal(f.root.getAttribute("data-zr-workspace-phase"),"swap");f.bookmarks.children=[f.fresh];return "ok";});
 await f.flush();assert.equal(calls,1);await f.advance();await f.advance();assert.equal(await result,"ok");
 assert.deepEqual(f.events,["out","swap","in","idle"]);
 assert.equal(f.old.hasAttribute("data-zr-workspace-motion"),false);
 assert.equal(f.fresh.hasAttribute("data-zr-workspace-motion"),false);
 assert.equal(f.timers.size,0);f.win.__zenRefinedWorkspaceTransition.dispose();
});
test("superseding a transition does not execute the older delayed selection",async()=>{
 const f=lifecycleFixture(),calls=[];
 const a=f.win.__zenRefinedWorkspaceTransition.run(()=>calls.push("old"));
 const b=f.win.__zenRefinedWorkspaceTransition.run(()=>calls.push("new"));
 await f.flush();await f.advance();await f.advance();await Promise.all([a,b]);
 assert.deepEqual(calls,["new"]);assert.equal(f.timers.size,0);
});
test("slow native switch cannot leave the chrome hidden indefinitely",async()=>{
 const f=lifecycleFixture();let resolve;
 const result=f.win.__zenRefinedWorkspaceTransition.run(()=>new Promise(r=>resolve=r));
 await f.flush();assert.equal(f.root.getAttribute("data-zr-workspace-phase"),"swap");
 await f.advance();await f.advance();
 assert.equal(f.root.hasAttribute("data-zr-workspace-phase"),false);
 resolve("native");assert.equal(await result,"native");assert.equal(f.timers.size,0);
});
