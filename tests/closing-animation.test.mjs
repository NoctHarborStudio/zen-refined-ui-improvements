import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../closing-animation.uc.mjs",import.meta.url),"utf8");
const start=source.indexOf("function makeCloseController("),end=source.indexOf("function visible(",start);
const factory=new Function("DURATION",source.slice(start,end)+"return makeCloseController;")(520);
function harness({eligible=true,begin=true,throws=false}={}){
 let timer=null,events=[],receiver=null,args=null;
 const gate=factory({eligible:()=>eligible,begin:()=>{events.push("begin");if(throws)throw Error("animation");return begin;},clear:()=>events.push("restore"),later:(fn,ms)=>{assert.equal(ms,520);timer=fn;return 1;},cancelLater:()=>{timer=null;},invoke:(r,a)=>{events.push("native");receiver=r;args=a;return "native-result";}});
 return {gate,events,fire:()=>timer?.(),get receiver(){return receiver;},get args(){return args;}};
}
test("restores chrome before one native close",()=>{const h=harness(),r={},a=[{}];h.gate.request(r,a);assert.deepEqual(h.events,["begin"]);h.fire();h.fire();assert.deepEqual(h.events,["begin","restore","native"]);assert.equal(h.receiver,r);assert.equal(h.args,a);});
test("ineligible command bypasses motion",()=>{const h=harness({eligible:false});assert.equal(h.gate.request({},[]),"native-result");assert.deepEqual(h.events,["native"]);});
test("second close skips remaining animation",()=>{const h=harness();h.gate.request({},[]);h.gate.request({},[]);h.fire();assert.deepEqual(h.events,["begin","restore","native"]);});
test("unload cancels without issuing another close",()=>{const h=harness();h.gate.request({},[]);h.gate.dispose();h.fire();assert.deepEqual(h.events,["begin","restore"]);});
test("failed or empty visual effect fails open",()=>{for(const options of [{begin:false},{throws:true}]){const h=harness(options);h.gate.request({},[]);assert.deepEqual(h.events,["begin","restore","native"]);}});
test("preference change completes pending native command",()=>{const h=harness();h.gate.request({},[]);h.gate.flush();h.fire();assert.deepEqual(h.events,["begin","restore","native"]);});
