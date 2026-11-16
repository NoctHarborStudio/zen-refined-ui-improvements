import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const script=readFileSync(new URL("../bookmarks.uc.mjs",import.meta.url),"utf8");
const registrySource=script.slice(script.indexOf("function createSharedRegistry()"),script.indexOf("const lease={}"));
function setup(legacyFirst=false){
  const queue=[],events=[];
  const win={closed:false,queueMicrotask:f=>queue.push(f)};
  const make=()=>{events.push("install");return {destroy(){events.push("destroy");},syncAddressState(){events.push("sync");}};};
  if(legacyFirst)win.legacy=()=>{events.push("legacy-cleanup");delete win.legacy;};
  const registry=new Function("window","install","CONTROLLER","SHARED","REVISION",registrySource+"return createSharedRegistry();")(win,make,"legacy","shared",1);
  win.shared=registry;
  return {win,registry,events,queue};
}
test("one Magnetic Bookmarks controller survives either consumer unload order",()=>{
  for(const order of [[0,1],[1,0]])for(const legacyFirst of [false,true]){
    const {win,registry,events}=setup(legacyFirst),tokens=[{},{}];
    registry.acquire(tokens[0]);registry.acquire(tokens[1]);registry.syncAddressState();
    assert.equal(events.filter(e=>e==="install").length,1);
    assert.equal(events.filter(e=>e==="sync").length,1);
    registry.release(tokens[order[0]]);
    assert.equal(events.filter(e=>e==="destroy").length,0);
    registry.release(tokens[order[1]]);
    assert.equal(events.filter(e=>e==="destroy").length,1);
    assert.equal(win.shared,undefined);
  }
});
test("legacy late registration yields and reclaims without concurrent controllers",()=>{
  const {win,registry,events,queue}=setup(),token={};
  registry.acquire(token);win.legacy();
  assert.deepEqual(events,["install","destroy"]);
  win.legacy=()=>{events.push("legacy-cleanup");delete win.legacy;};
  queue.shift()();
  assert.deepEqual(events,["install","destroy","legacy-cleanup","install"]);
  registry.release(token);
  assert.equal(win.shared,undefined);
});
