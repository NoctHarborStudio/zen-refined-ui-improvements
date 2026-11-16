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
