import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../downloads-indicator.uc.mjs",import.meta.url),"utf8");
function section(a,b){return source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)+a.length));}
const geometry=new Function("r","w","h","x","y",`const clamp=(v,lo,hi)=>Math.max(lo,Math.min(Math.max(lo,hi),v));${section("function wavePath(","function updateOverlayMask(")}return {g:panelGeometry(r,w,h,x,y),reverseWave};`);
test("wave stays connected, expands diagonally, and mirrors",()=>{
 const a=geometry({side:"right",edge:768,x:800,y:31},430,380,330,12).g;
 const b=geometry({side:"left",edge:67,x:35,y:31},430,380,75,12).g;
 assert.equal(a.frames.length,11);assert.equal(a.frames[0].opacity,0);
 for(let i=0;i<a.frames.length;i++){
   const parse=f=>[...f.clipPath.matchAll(/-?\d+\.\d+/g)].map(m=>Number(m[0]));
   const x=parse(a.frames[i]),y=parse(b.frames[i]);assert.equal(x.length,y.length);
   for(let k=0;k<x.length;k++)assert.ok(Math.abs((k%2?x[k]-y[k]:x[k]+y[k]-a.extent))<.002);
 }
 assert.equal(a.frames.at(-1).transform,"translate(0px,0px)");
 assert.ok(a.frames[5].clipPath.includes("0.000"));
});
test("close exactly reverses opening keyframes",()=>{
 const {g,reverseWave}=geometry({side:"right",x:800,y:31},430,380,330,12);
 const reversed=reverseWave(g.frames);
 assert.deepEqual(reversed.map(f=>f.clipPath),g.frames.slice(0,-1).reverse().map(f=>f.clipPath));
 assert.equal(reversed.at(-1).offset,1);
 assert.equal(reversed.at(-1).transform,g.frames[0].transform);
});
test("native hold survives closing, and releases only own attribute",()=>{
 const run=new Function(`${section("function syncSidebarHold()","function updateLive()")}
 let dead=false,cardOpen=false,dockOpen=false,closing=false,manualHold=false,sidebarOrigin=false;
 const attrs=new Set(["data-zr-native","unrelated"]);
 const node={hasAttribute:k=>attrs.has(k),toggleAttribute:(k,on)=>on?attrs.add(k):attrs.delete(k)};
 const dock={hasAttribute:k=>k==="data-closing"&&closing};
 const states=[];const sample=()=>{syncSidebarHold();states.push(attrs.has("panelopen"));};
 sample();cardOpen=true;sample();manualHold=true;sample();cardOpen=false;dockOpen=true;sample();dockOpen=false;closing=true;sample();closing=false;manualHold=false;sample();cardOpen=true;manualHold=true;sidebarOrigin=true;sample();cardOpen=false;dockOpen=true;sample();dockOpen=false;closing=true;sample();closing=false;sidebarOrigin=false;sample();cardOpen=true;sidebarOrigin=true;sample();dead=true;sample();
 return {states,unrelated:attrs.has("unrelated")};`);
 assert.deepEqual(run(),{states:[false,false,false,false,false,false,true,true,true,false,true,false],unrelated:true});
});

test("sidebar mask is mirrored and absent for a hosted indicator",()=>{
 const run=new Function(`${section("function updateOverlayMask(","function positionOverlays(")}
 const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));const window={innerWidth:1000},overlayLayer={},observedSidebar={isConnected:true};
 let native=true;const node={hasAttribute:()=>native};const values={};const setVar=(n,k,v)=>values[k]=v;
 updateOverlayMask({side:"right",edge:850});const right={...values};updateOverlayMask({side:"left",edge:150});const left={...values};native=false;updateOverlayMask({side:"left",edge:150});return {right,left,hosted:values};`);
 assert.deepEqual(run(),{right:{"--zr-mask-left":"0px","--zr-mask-right":"150px"},left:{"--zr-mask-left":"150px","--zr-mask-right":"0px"},hosted:{"--zr-mask-left":"0px","--zr-mask-right":"0px"}});
});
test("first seed is a subpixel circle at the sidebar boundary and grows continuously",()=>{
 const {g}=geometry({side:"right",edge:768,x:800,y:31},430,380,330,12);
 const points=f=>[...f.clipPath.matchAll(/-?\d+\.\d+/g)].map(m=>Number(m[0]));
 const box=f=>{const p=points(f),xs=p.filter((_,i)=>i%2===0),ys=p.filter((_,i)=>i%2===1);return {l:Math.min(...xs),r:Math.max(...xs),t:Math.min(...ys),b:Math.max(...ys)};};
 const a=box(g.frames[0]),b=box(g.frames[1]),c=box(g.frames[2]);
 assert.ok(a.r-a.l<1);assert.ok(Math.abs((a.l+a.r)/2-g.anchor)<.002);
 assert.ok(Math.abs((a.r-a.l)-(a.b-a.t))<.002);
 assert.ok(b.r-b.l>a.r-a.l&&c.r-c.l>b.r-b.l);
 assert.equal(g.frames[1].opacity,1);
 for(const f of g.frames.slice(3,-1)){const v=box(f);assert.ok(v.l<g.anchor&&v.r>g.anchor);}
 assert.equal(box(g.frames.at(-1)).r,430);
 assert.equal(g.extent,462);
 assert.equal(g.anchor,438);
});

test("pinning from a download row does not acquire the sidebar",()=>{
 const run=new Function(`${section("function syncSidebarHold()","function updateLive()")}${section("function pinPanel(","function openCard(")}
 let dead=false,cardOpen=true,dockOpen=false,manualHold=false,sidebarOrigin=false;
 const attrs=new Set(["data-zr-native"]);
 const node={hasAttribute:k=>attrs.has(k),toggleAttribute:(k,on)=>on?attrs.add(k):attrs.delete(k)};
 const dock={hasAttribute:()=>false};function cancelHide(){}function follow(){}
 pinPanel();const fromRow={pinned:manualHold,sidebar:attrs.has("panelopen")};
 pinPanel(true);const fromIndicator={pinned:manualHold,sidebar:attrs.has("panelopen")};
 pinPanel();const preserved=attrs.has("panelopen");
 return {fromRow,fromIndicator,preserved};`);
 assert.deepEqual(run(),{fromRow:{pinned:true,sidebar:false},fromIndicator:{pinned:true,sidebar:true},preserved:true});
});
