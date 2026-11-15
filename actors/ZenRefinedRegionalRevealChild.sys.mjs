/* Generic route-aware content evidence. No page text, media URLs or hashes
 * leave the content process. Pixel-only changes never certify a SPA route. */
const route = uri => String(uri||"").split("#")[0];
const EXCLUDED = "script,style,template,noscript,header,nav,footer,button,input,textarea,select,[role=button],[role=slider],[role=progressbar],[role=navigation],[role=timer],[aria-live],video,audio,canvas,svg";
const MEDIA = "img,video,audio";
const MAIN = "main,[role=main],article";
const LIMIT = 3200, MAX_KEYS = 500;
function normalizedText(raw) {
  return String(raw||"").replace(/\s+/g," ").trim();
}
function meaningfulText(raw) {
  const s=normalizedText(raw);
  // Timers, counters, percentages and standalone icons are not route content.
  return s.length>=5 && /\p{L}/u.test(s) && !/^\d[\d\s:.,/%+\-]*$/u.test(s);
}
function visible(el,win) {
  try {
    if(el.closest("[hidden],[aria-hidden=true],[inert]"))return false;
    const r=el.getBoundingClientRect();
    if(r.width<2||r.height<2||r.right<=0||r.bottom<=0||r.left>=win.innerWidth||r.top>=win.innerHeight)return false;
    if(typeof el.checkVisibility==="function"&&!el.checkVisibility({checkOpacity:true,checkVisibilityCSS:true,contentVisibilityAuto:true}))return false;
    const style=win.getComputedStyle(el);
    return style.visibility!=="hidden"&&style.display!=="none"&&Number(style.opacity)>0;
  }catch{return false;}
}
function mediaKey(el){
  const tag=el.localName;
  if(!["img","video","audio"].includes(tag))return null;
  // Same node/source, even with a new decoded frame, is the same content.
  const src=el.currentSrc||el.getAttribute("src")||"";
  if(!src)return null;
  return tag+":"+src;
}
function dynamicRects(win,doc){
  const rects=[],seen=new Set();
  const add=el=>{
    if(!el||seen.has(el)||rects.length>=128)return;
    seen.add(el);
    try{
      if(!visible(el,win))return;
      const r=el.getBoundingClientRect(),w=win.innerWidth,h=win.innerHeight;
      if(w<1||h<1)return;
      const n=[r.left/w,r.top/h,r.right/w,r.bottom/h].map(v=>Math.max(0,Math.min(1,v)));
      if(n[2]>n[0]&&n[3]>n[1])rects.push(n);
    }catch{}
  };
  try{
    const elements=doc.querySelectorAll("video,canvas,iframe,object,embed,[aria-live],[role=timer],svg,img");
    for(let i=0;i<Math.min(elements.length,1600)&&rects.length<128;i++){
      const el=elements[i];
      // Unknown image formats are covered by temporal stability. Do not mask
      // every static thumbnail or the fallback would miss an entire image feed.
      if(el.localName==="img"&&!/\.(gif|apng|webp|avif)(?:[?#]|$)/i.test(el.currentSrc||el.getAttribute("src")||""))continue;
      add(el);
    }
    for(const anim of (doc.getAnimations?.()||[]).slice(0,128)){
      if(anim.playState==="running")add(anim.effect?.target);
    }
  }catch{}
  return rects;
}
function structure(win,doc) {
  const keys=new Set(),media=new Map(),textNodes=new Map(),dynamic=new Map(),main=new Set(),root=doc.body||doc.documentElement;
  if(!root)return {keys,media,textNodes,dynamic,main,valid:false};
  try{
    const walker=doc.createTreeWalker(root,1);
    let el=root,visited=0;
    while(el&&visited++<LIMIT&&keys.size<MAX_KEYS){
      const tag=el.localName;
      if(el.matches?.(MAIN)&&visible(el,win))main.add(el);
      if(el.matches?.("video,canvas,iframe,object,embed")&&visible(el,win))dynamic.set(el,mediaKey(el)||tag);
      if(el.matches?.(MEDIA)){
        const key=mediaKey(el);
        if(key&&visible(el,win)){
          media.set(el,key);
          // Track identities before loading as well, so an already-existing
          // image/video becoming ready cannot masquerade as a new route.
          keys.add("media:"+key);
        }
      }else if(!el.closest?.(EXCLUDED)){
        const raw=Array.from(el.childNodes||[]).filter(n=>n.nodeType===3).map(n=>n.nodeValue).join(" ");
        if(meaningfulText(raw)&&visible(el,win)){
          const value=normalizedText(raw).slice(0,240);
          const key="text:"+value;
          keys.add(key);textNodes.set(el,key);
        }
      }
      el=walker.nextNode();
    }
    return {keys,media,textNodes,dynamic,main,valid:true};
  }catch{return {keys,media,textNodes,dynamic,main,valid:false};}
}
function rectFor(el,win,doc,hit=true){
  try{
    if(!visible(el,win))return null;
    const r=el.getBoundingClientRect(),w=win.innerWidth,h=win.innerHeight;
    const a=Math.max(0,r.left),b=Math.max(0,r.top),c=Math.min(w,r.right),d=Math.min(h,r.bottom);
    if(c<=a||d<=b||w<=0||h<=0)return null;
    if(hit&&typeof doc.elementFromPoint==="function"){
      const top=doc.elementFromPoint((a+c)/2,(b+d)/2);
      if(top&&top!==el&&!el.contains(top))return null;
    }
    return [a/w,b/h,c/w,d/h];
  }catch{return null;}
}
function textRects(el,win,doc){
  const list=[];
  try{
    for(const n of el.childNodes){
      if(n.nodeType!==3||!meaningfulText(n.nodeValue))continue;
      const range=doc.createRange();range.selectNodeContents(n);
      for(const r of range.getClientRects()){
        const w=win.innerWidth,h=win.innerHeight,a=Math.max(0,r.left),b=Math.max(0,r.top),c=Math.min(w,r.right),d=Math.min(h,r.bottom);
        if(c<=a||d<=b)continue;
        const top=doc.elementFromPoint((a+c)/2,(b+d)/2);
        if(top&&top!==el&&!el.contains(top))continue;
        list.push([a/w,b/h,c/w,d/h]);
        if(list.length>=12)return list;
      }
    }
  }catch{}
  return list;
}
function regionalContent(before,after,win,doc){
  const rects=[],blocked=[];
  if(!before?.valid||!after?.valid)return {rects,blocked,replaced:false};
  // Protect all still-visible outgoing dynamic nodes, even paused video.
  // A changed decoded source is new; same identity at a new position is old.
  for(const [el,key] of before.dynamic){
    if(!el.isConnected||!visible(el,win))continue;
    if(el.localName==="video"&&mediaKey(el)&&mediaKey(el)!==key&&el.readyState>=2)continue;
    const r=rectFor(el,win,doc,false);if(r)blocked.push(r);
  }
  let primaryNew=0,mainNew=0;
  const mainOf=el=>el.closest?.(MAIN);
  for(const [el,key] of after.textNodes){
    if(before.keys.has(key)||before.textNodes.get(el)===key)continue;
    const r=textRects(el,win,doc);if(!r.length)continue;
    rects.push(...r);if(mainOf(el))primaryNew++;
    if(rects.length>=280)break;
  }
  if(rects.length<280)for(const [el,key] of after.media){
    if(before.media.get(el)===key||before.keys.has("media:"+key))continue;
    if(el.localName==="img"&&el.naturalWidth<=0)continue;
    if(el.localName==="video"&&el.readyState<2)continue;
    if(el.localName==="audio")continue;
    const r=rectFor(el,win,doc);if(!r)continue;
    rects.push(r);if(mainOf(el))primaryNew++;
    if(rects.length>=300)break;
  }
  // A new, populated main container may safely expose its background as
  // well. Never interpret an unchanged persistent main shell as replacement.
  for(const el of after.main){
    if(before.main.has(el))continue;
    const hasNew=[...after.textNodes].some(([n,k])=>!before.keys.has(k)&&el.contains(n))||
      [...after.media].some(([n,k])=>!before.keys.has("media:"+k)&&el.contains(n)&&
        ((n.localName==="img"&&n.naturalWidth>0)||(n.localName==="video"&&n.readyState>=2)));
    if(!hasNew)continue;
    const r=rectFor(el,win,doc);if(r){rects.push(r);mainNew++;}
    if(rects.length>=310)break;
  }
  // Whole reveal is conservative: replacement of old main containers OR
  // substantial retirement of old primary content, and no old dynamic node.
  let oldCount=0,remaining=0;
  for(const [el,key] of before.textNodes){
    if(!mainOf(el)&&before.main.size)continue;
    oldCount++;if(after.textNodes.get(el)===key)remaining++;
  }
  for(const [el,key] of before.media){
    if(!mainOf(el)&&before.main.size)continue;
    oldCount++;if(after.media.get(el)===key)remaining++;
  }
  const oldMainGone=before.main.size>0&&[...before.main].every(el=>!el.isConnected||!visible(el,win));
  const retired=oldCount>=4&&remaining/oldCount<=.2;
  const replaced=rects.length>0&&blocked.length===0&&((oldMainGone&&mainNew>0)||(retired&&primaryNew>=2));
  return {rects:rects.slice(0,320),blocked:blocked.slice(0,128),replaced};
}
export class ZenRefinedRegionalRevealChild extends JSWindowActorChild {
  #paintObserver=null;
  #paintSent=false;
  #softCleanup=null;
  #dead=false;
  #lastWarm=-Infinity;
  #baselines=new Map();
  #inputBaseline=null;
  actorCreated(){
    const win=this.contentWindow;
    if(!win)return;
    try{
      this.#paintObserver=new win.PerformanceObserver(entries=>{
        if(entries.getEntries().some(entry=>entry.name==="first-contentful-paint"))this.#paint();
      });
      this.#paintObserver.observe({type:"paint",buffered:true});
    }catch{this.#paintObserver=null;}
  }
  #saveBaseline(win,explicit=false){
    try{
      const uri=route(win.location.href),frame=structure(win,this.document);
      if(!frame.valid)return;
      const record={uri,frame,at:win.performance.now()};
      this.#baselines.delete(uri);this.#baselines.set(uri,record);
      while(this.#baselines.size>3)this.#baselines.delete(this.#baselines.keys().next().value);
      if(explicit)this.#inputBaseline=record;
    }catch{}
  }
  #send(name,data={}){if(!this.#dead)try{this.sendAsyncMessage(name,data);}catch{}}
  #paint(){if(this.#paintSent)return;this.#paintSent=true;this.#send("Paint");}
  handleEvent(event){
    const win=this.contentWindow;if(!win)return;
    if(event.type==="pointermove"||event.type==="scroll"){
      const t=win.performance.now();
      if(t-this.#lastWarm>1000&&!this.#softCleanup){this.#lastWarm=t;this.#saveBaseline(win);this.#send("Warm",{uri:win.location.href,dynamic:dynamicRects(win,this.document)});}
      return;
    }
    if(event.type==="popstate"){this.#send("History");return;}
    if(event.type==="pointerdown"||(event.type==="click"&&event.detail===0)){
      if(!event.isTrusted||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
      const path=event.composedPath();
      if(path.some(n=>n?.nodeType===1&&n.matches?.("input,textarea,select,[contenteditable=true]")))return;
      const link=path.find(n=>n?.nodeType===1&&n.matches?.("a[href],area[href],[role=link],ytd-thumbnail,yt-lockup-view-model"));
      if(!link||link.hasAttribute("download")||(link.target&&!["_self","_top","_parent"].includes(link.target.toLowerCase())))return;
      let x=event.clientX,y=event.clientY;
      if(event.type==="click"&&event.detail===0){const r=link.getBoundingClientRect();x=r.x+r.width/2;y=r.y+r.height/2;}
      // Capture identities BEFORE the site's normal click changes its route.
      this.#saveBaseline(win,true);
      this.#send("Origin",{x,y,vw:win.innerWidth,vh:win.innerHeight,navigation:true,uri:win.location.href,dynamic:dynamicRects(win,this.document)});
    }else if(event.type==="pageshow"){
      if(event.persisted)this.#send("Paint");
      else if(win.performance.getEntriesByName("first-contentful-paint").length)this.#paint();
      this.#saveBaseline(win);
      this.#send("Warm",{uri:win.location.href,dynamic:dynamicRects(win,this.document)});
    }else if(event.type==="DOMContentLoaded"){
      win.requestAnimationFrame(()=>win.requestAnimationFrame(()=>{this.#paint();this.#saveBaseline(win);this.#send("Warm",{uri:win.location.href,dynamic:dynamicRects(win,this.document)});}));
    }
  }
  receiveMessage(message){
    if(message.name==="CancelSoft"){this.#softCleanup?.();return;}
    if(message.name!=="WatchSoft")return;
    this.#softCleanup?.();
    const win=this.contentWindow,doc=this.document;if(!win||!doc?.documentElement)return;
    const {token,uri,oldURI}=message.data,expected=route(uri),previous=route(oldURI),start=win.performance.now();
    const input=this.#inputBaseline;
    const record=input?.uri===previous&&start-input.at<2500?input:this.#baselines.get(previous);
    if(!record||!record.frame.valid||start-record.at>120000||previous===expected){
      this.#send("SoftBaselineMissing",{token});
      return;
    }
    let timer=0,hard=0,raf=0,paintTimer=0,observer,done=false,lastKey="",candidate=null;
    const same=()=>route(win.location.href)===expected;
    const clean=()=>{
      if(done)return;done=true;
      win.clearTimeout(timer);win.clearTimeout(hard);win.clearTimeout(paintTimer);win.cancelAnimationFrame(raf);
      observer?.disconnect();
      win.removeEventListener("load",wake,true);
      win.removeEventListener("loadeddata",wake,true);
      win.removeEventListener("playing",wake,true);
      win.removeEventListener("MozAfterPaint",paint,true);
      if(this.#softCleanup===clean)this.#softCleanup=null;
    };
    const emit=()=>{
      if(done||!same()||!candidate)return;
      win.clearTimeout(paintTimer);paintTimer=0;win.cancelAnimationFrame(raf);raf=0;
      const data=candidate;candidate=null;
      const key=JSON.stringify(data);
      if(key!==lastKey){
        lastKey=key;
        this.#send("SoftRegions",{token,uri:win.location.href,oldURI,...data});
      }
      if(data.replaced){clean();return;}
      schedule(100);
    };
    const paint=()=>{if(candidate)emit();};
    const check=()=>{
      timer=0;if(done)return;
      if(!same()){schedule(100);return;}
      candidate=regionalContent(record.frame,structure(win,doc),win,doc);
      // Prefer actual Gecko paint notification where delivered. Two refresh
      // frames plus a bounded fallback avoid depending on a privileged event.
      raf=win.requestAnimationFrame(()=>{raf=win.requestAnimationFrame(emit);});
      paintTimer=win.setTimeout(emit,70);
    };
    const schedule=(delay=35)=>{if(!done&&!timer&&!candidate&&!raf)timer=win.setTimeout(check,delay);};
    const wake=()=>schedule();
    this.#softCleanup=clean;
    try{
      observer=new win.MutationObserver(wake);
      observer.observe(doc.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["hidden","style","class","src","aria-hidden"]});
      win.addEventListener("load",wake,true,true);
      win.addEventListener("loadeddata",wake,true,true);
      win.addEventListener("playing",wake,true,true);
      win.addEventListener("MozAfterPaint",paint,true);
      schedule(0);hard=win.setTimeout(clean,3900);
    }catch{clean();}
  }
  didDestroy(){
    this.#dead=true;this.#paintObserver?.disconnect();this.#softCleanup?.();
    this.#baselines.clear();this.#inputBaseline=null;
  }
}
