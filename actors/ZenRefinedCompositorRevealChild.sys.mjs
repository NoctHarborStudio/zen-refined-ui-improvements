/* Gecko compositor pipeline: no destination snapshots or site-specific rules.
 * Only privileged paint events, document state and bounded route evidence.
 * Source: Firefox LoginManagerChild uses contentWindow.windowRoot for MozAfterPaint.
 */
const route=u=>String(u||"").split("#")[0];
const PRIMARY="main,[role=main],article";
const OMIT="header,nav,footer,script,style,template,noscript,button,input,textarea,select,[role=button],[role=navigation],[aria-live],[role=timer],[role=slider]";
const DYNAMIC="video,canvas,iframe,object,embed";
function state(win){
  try{const u=win.windowUtils;return {suppressed:u.paintingSuppressed,pending:u.isMozAfterPaintPending,transaction:Number(u.lastTransactionId)||0};}
  catch{return {suppressed:null,pending:null,transaction:0};}
}
function fcp(win){try{return win.performance.getEntriesByName("first-contentful-paint")[0]||null;}catch{return null;}}
function compositeTime(win){try{return Number(win.performance.timing?.timeToContentfulPaint)||0;}catch{return 0;}}
function visible(el,win){
  try{
    if(!el?.isConnected||el.closest("[hidden],[aria-hidden=true],[inert]"))return false;
    const r=el.getBoundingClientRect();
    if(r.width<2||r.height<2||r.right<=0||r.bottom<=0||r.left>=win.innerWidth||r.top>=win.innerHeight)return false;
    if(typeof el.checkVisibility==="function"&&!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true,contentVisibilityAuto:true}))return false;
    const cs=win.getComputedStyle(el);return cs.visibility!=="hidden"&&cs.display!=="none"&&Number(cs.opacity)>0;
  }catch{return false;}
}
function mediaKey(el){return String(el.currentSrc||el.getAttribute?.("src")||"");}
function directText(el){return Array.from(el.childNodes||[]).filter(n=>n.nodeType===3).map(n=>n.nodeValue||"").join(" ").replace(/\s+/g," ").trim().slice(0,180);}
function snapshotRoute(win,doc){
  const items=new Map(),dynamic=new Map(),roots=new Set(),keys=new Set();
  try{
    const vw=win.innerWidth,vh=win.innerHeight;if(!doc.body||vw<=0||vh<=0)return null;
    const primary=[...doc.querySelectorAll(PRIMARY)].slice(0,80).filter(el=>visible(el,win)&&el.getBoundingClientRect().width>=vw*.25&&el.getBoundingClientRect().height>=vh*.18);
    for(const el of primary)if(!primary.some(p=>p!==el&&p.contains(el)))roots.add(el);
    let visited=0;
    for(const root of roots.size?[...roots]:[doc.body]){
      const walker=doc.createTreeWalker(root,1);let el=root;
      while(el&&visited++<1800&&items.size<180){
        if(!el.closest?.(OMIT)){
          let key="";
          if(el.localName==="img"||el.localName==="video")key=mediaKey(el)?el.localName+":"+mediaKey(el):"";
          else if(!el.closest?.("video,audio,canvas,svg")){const t=directText(el);if(t.length>=4&&/\p{L}/u.test(t))key="text:"+t;}
          if(key&&visible(el,win)){items.set(el,key);keys.add(key);}
        }
        el=walker.nextNode();
      }
      if(visited>=1800||items.size>=180)break;
    }
    for(const el of [...doc.querySelectorAll(DYNAMIC)].slice(0,120))if(visible(el,win))dynamic.set(el,mediaKey(el));
    const center=[];
    for(const [x,y] of [[.5,.5],[.35,.35],[.65,.35],[.35,.65],[.65,.65]]){
      const el=doc.elementFromPoint(vw*x,vh*y);
      if(el&&!el.closest?.(OMIT))center.push({el,key:items.get(el)||directText(el)});
    }
    return {items,dynamic,roots,keys,center};
  }catch{return null;}
}
function routeEvidence(before,after,win){
  if(!before||!after)return false;
  for(const [el,key] of before.dynamic){
    if(!visible(el,win))continue;
    if(el.localName==="video"&&key&&mediaKey(el)!==key&&mediaKey(el)&&el.readyState>=2)continue;
    return false;
  }
  let novel=0,retired=0;
  for(const [el,key] of after.items){
    if(before.keys.has(key))continue;
    if(el.localName==="img"&&el.naturalWidth<=0)continue;
    if(el.localName==="video"&&el.readyState<2)continue;
    novel++;
  }
  for(const [el,key] of before.items)if(!after.items.has(el)||after.items.get(el)!==key)retired++;
  const rootsGone=before.roots.size>0&&[...before.roots].every(el=>!visible(el,win));
  const centerGone=before.center.some(({el,key})=>!visible(el,win)||(key&&after.items.has(el)&&after.items.get(el)!==key));
  const substantial=before.items.size>=3&&retired/before.items.size>=.55;
  return novel>0&&((rootsGone&&centerGone)||(substantial&&centerGone));
}
function paintForWindow(event,win){
  if(!event?.isTrusted)return false;
  try{
    const target=event.originalTarget||event.target;
    return (target===win||target===win.document||target?.defaultView===win)&&Number(event.transactionId)>0&&Number(event.paintTimeStamp)>=0;
  }catch{return false;}
}
function hardEvidence(win,observed){
  const st=state(win);if(st.suppressed!==false)return null;
  if(compositeTime(win)>0)return {reason:"contentful-composite",transaction:st.transaction};
  const entry=fcp(win);if(!entry)return null;
  if(observed&&observed.stamp+4>=entry.startTime&&observed.transaction>0)return {reason:"contentful-after-paint",transaction:observed.transaction};
  return null;
}
export class ZenRefinedCompositorRevealChild extends JSWindowActorChild {
  #dead=false;#cleanup=null;#watchToken=null;#watchKey="";#ready=null;#baseline=null;#lastWarm=-Infinity;#paint=null;#initialCleanup=null;
  #send(name,data){if(!this.#dead)try{this.sendAsyncMessage(name,data);}catch{}}
  actorCreated(){
    const win=this.contentWindow;if(!win)return;
    let timer=0,done=false;const root=win.windowRoot;
    const clean=()=>{if(done)return;done=true;win.clearTimeout(timer);try{root?.removeEventListener("MozAfterPaint",paint,true);}catch{}if(this.#initialCleanup===clean)this.#initialCleanup=null;};
    const paint=e=>{if(!paintForWindow(e,win))return;this.#paint={stamp:Number(e.paintTimeStamp),transaction:Number(e.transactionId)};if(hardEvidence(win,this.#paint))clean();};
    this.#initialCleanup=clean;
    try{root?.addEventListener("MozAfterPaint",paint,true);timer=win.setTimeout(clean,4500);}catch{clean();}
  }
  handleEvent(event){
    const win=this.contentWindow;if(!win)return;
    if(event.type==="pointermove"||event.type==="scroll"){const t=win.performance.now();if(t-this.#lastWarm>1000){this.#lastWarm=t;this.#send("Warm",{});}return;}
    if(event.type==="popstate"){if(event.isTrusted)this.#send("History",{});return;}
    if(event.type==="pageshow"||event.type==="DOMContentLoaded"){this.#send("Warm",{});return;}
    if(event.type!=="pointerdown"&&!(event.type==="click"&&event.detail===0))return;
    if(!event.isTrusted||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    const path=event.composedPath();
    if(path.some(n=>n?.nodeType===1&&n.matches?.("input,textarea,select,[contenteditable=true]")))return;
    const link=path.find(n=>n?.nodeType===1&&n.matches?.("a[href],area[href],[role=link]"));
    if(!link||link.hasAttribute("download")||(link.target&&!["_self","_top","_parent"].includes(link.target.toLowerCase())))return;
    let x=event.clientX,y=event.clientY;
    if(event.type==="click"&&event.detail===0){const r=link.getBoundingClientRect();x=r.x+r.width/2;y=r.y+r.height/2;}
    this.#baseline={uri:route(win.location.href),frame:snapshotRoute(win,this.document),at:win.performance.now(),transaction:state(win).transaction};
    this.#send("Origin",{x,y,vw:win.innerWidth,vh:win.innerHeight,navigation:true,uri:win.location.href});
  }
  receiveMessage(message){
    if(message.name==="Cancel"){if(message.data.token===this.#watchToken){this.#cleanup?.();this.#ready=null;this.#watchToken=null;this.#watchKey="";}return;}
    if(message.name!=="Watch")return;
    const win=this.contentWindow,doc=this.document;if(!win||!doc)return;
    const {token,kind,uri,oldURI}=message.data,key=token+":"+kind+":"+route(uri),base={token,uri,oldURI};
    if(this.#watchKey===key){if(this.#ready)this.#send("FrameReady",this.#ready);return;}
    this.#cleanup?.();this.#watchToken=token;this.#watchKey=key;this.#ready=null;
    const initial=kind==="soft"?this.#baseline:null;
    if(kind==="soft"&&(!initial?.frame||initial.uri!==route(oldURI)||win.performance.now()-initial.at>2500)){
      this.#send("Unsupported",{...base,reason:"no-pre-navigation-content"});return;
    }
    let timer=0,raf=0,hard=0,observer,done=false,paintObserver,lastStatus="",candidate=null,observed=this.#paint,dirty=true,drainedAt=null,mutationAt=initial?.at||0;
    const root=win.windowRoot,same=()=>route(win.location.href)===route(uri);
    const clean=()=>{
      if(done)return;done=true;win.clearTimeout(timer);win.clearTimeout(hard);win.cancelAnimationFrame(raf);
      observer?.disconnect();paintObserver?.disconnect();try{root?.removeEventListener("MozAfterPaint",onPaint,true);}catch{}if(this.#cleanup===clean)this.#cleanup=null;
    };
    const report=st=>{
      const data={...base,suppressed:st.suppressed,pending:st.pending,transaction:st.transaction,fcp:!!fcp(win)};
      const k=JSON.stringify([data.suppressed,data.fcp,data.pending]);if(k!==lastStatus){lastStatus=k;this.#send("PaintState",data);}
    };
    const ready=(proof,replaced=false)=>{
      if(done||!same()||state(win).suppressed!==false)return;
      this.#ready={...base,...proof,suppressed:false,routeReplaced:replaced};this.#send("FrameReady",this.#ready);clean();this.#initialCleanup?.();
    };
    const schedule=(delay=40)=>{if(!done&&!timer)timer=win.setTimeout(check,delay);};
    const check=()=>{
      timer=0;if(done)return;
      if(!same()){schedule();return;}
      const st=state(win);report(st);
      if(st.suppressed!==false){drainedAt=null;schedule();return;}
      if(kind==="hard"){
        const proof=hardEvidence(win,observed);if(proof){ready(proof);return;}
        // Weaker fallback for a paint completed before the listener was installed.
        // Require a recorded FCP and a drained, stable nonzero transaction.
        if(fcp(win)&&st.pending===false&&st.transaction>0){
          if(drainedAt===st.transaction){ready({reason:"contentful-drained",transaction:st.transaction});return;}
          drainedAt=st.transaction;
          if(!raf)raf=win.requestAnimationFrame(()=>{raf=win.requestAnimationFrame(()=>{raf=0;schedule(0);});});
        }else drainedAt=null;
      }else if(dirty){
        dirty=false;
        const after=snapshotRoute(win,doc);
        if(routeEvidence(initial.frame,after,win)){
          candidate={transaction:Math.max(initial.transaction+1,st.transaction),at:mutationAt};
          // Catch a paint which arrived just before the bounded DOM check.
          if(observed&&observed.transaction>=candidate.transaction&&observed.stamp>=candidate.at&&st.pending===false){
            ready({reason:"route-after-paint",transaction:observed.transaction},true);return;
          }
        }else candidate=null;
      }
      schedule(kind==="hard"?45:65);
    };
    const onPaint=e=>{
      if(!paintForWindow(e,win))return;
      observed={stamp:Number(e.paintTimeStamp),transaction:Number(e.transactionId)};this.#paint=observed;
      if(!same()||state(win).suppressed!==false)return;
      if(kind==="hard"){const proof=hardEvidence(win,observed);if(proof)ready(proof);else schedule(0);return;}
      if(!candidate){dirty=true;schedule(0);return;}
      if(observed.transaction>=candidate.transaction&&observed.stamp>=candidate.at){
        if(routeEvidence(initial.frame,snapshotRoute(win,doc),win))ready({reason:"route-after-paint",transaction:observed.transaction},true);
        else{candidate=null;dirty=true;schedule(0);}
      }
    };
    this.#cleanup=clean;
    try{
      root?.addEventListener("MozAfterPaint",onPaint,true);
      if(kind==="hard"){try{paintObserver=new win.PerformanceObserver(()=>schedule(0));paintObserver.observe({type:"paint",buffered:true});}catch{}}
      else{observer=new win.MutationObserver(()=>{dirty=true;mutationAt=win.performance.now();schedule(0);});observer.observe(doc.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["hidden","aria-hidden","style","class","src"]});}
      schedule(0);hard=win.setTimeout(clean,4200);
    }catch{clean();}
  }
  didDestroy(){this.#dead=true;this.#cleanup?.();this.#initialCleanup?.();this.#baseline=null;this.#ready=null;}
}
