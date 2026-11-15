/* Generic route-aware content evidence. No page text, media URLs or hashes
 * leave the content process. Pixel-only changes never certify a SPA route. */
const route = uri => String(uri||"").split("#")[0];
const EXCLUDED = "script,style,template,noscript,header,nav,footer,button,input,textarea,select,[role=button],[role=slider],[role=progressbar],[role=navigation],[role=timer],[aria-live],video,audio,canvas,svg";
const MEDIA = "img,video,audio";
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
function structure(win,doc) {
  const keys=new Set(),media=new Map(),textNodes=new Map(),root=doc.body||doc.documentElement;
  if(!root)return {keys,media,textNodes,valid:false};
  try{
    const walker=doc.createTreeWalker(root,1);
    let el=root,visited=0;
    while(el&&visited++<LIMIT&&keys.size<MAX_KEYS){
      const tag=el.localName;
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
    return {keys,media,textNodes,valid:true};
  }catch{return {keys,media,textNodes,valid:false};}
}
function newContent(before,after){
  if(!before?.valid||!after?.valid)return null;
  // Only newly visible text or a genuinely new/changed decoded media source.
  // An existing video's frames, play/loadeddata events, canvas drawing and
  // arbitrary class/attribute changes are not evidence on their own.
  for(const [el,key] of after.textNodes){
    if(before.keys.has(key))continue;
    if(before.textNodes.get(el)===key)continue;
    return "new visible text";
  }
  for(const [el,key] of after.media){
    if(before.media.get(el)===key||before.keys.has("media:"+key))continue;
    if(el.localName==="img"&&el.complete&&el.naturalWidth>0)return "new visible image";
    if(el.localName==="video"&&el.readyState>=2)return "new visible video source";
    // Audio alone is not visual content.
  }
  return null;
}
export class ZenRefinedRouteRevealChild extends JSWindowActorChild {
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
      if(t-this.#lastWarm>1000&&!this.#softCleanup){this.#lastWarm=t;this.#saveBaseline(win);this.#send("Warm");}
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
      this.#send("Origin",{x,y,vw:win.innerWidth,vh:win.innerHeight,navigation:true,uri:win.location.href});
    }else if(event.type==="pageshow"){
      if(event.persisted)this.#send("Paint");
      else if(win.performance.getEntriesByName("first-contentful-paint").length)this.#paint();
      this.#saveBaseline(win);
    }else if(event.type==="DOMContentLoaded"){
      win.requestAnimationFrame(()=>win.requestAnimationFrame(()=>{this.#paint();this.#saveBaseline(win);}));
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
    let timer=0,hard=0,raf=0,observer,done=false;
    const same=()=>route(win.location.href)===expected;
    const clean=()=>{
      if(done)return;done=true;
      win.clearTimeout(timer);win.clearTimeout(hard);win.cancelAnimationFrame(raf);
      observer?.disconnect();
      win.removeEventListener("load",wake,true);
      win.removeEventListener("loadeddata",wake,true);
      win.removeEventListener("playing",wake,true);
      if(this.#softCleanup===clean)this.#softCleanup=null;
    };
    const check=()=>{
      timer=0;if(done||!same())return;
      const evidence=newContent(record.frame,structure(win,doc));
      if(!evidence){schedule();return;}
      // A visible content change must survive two refresh frames. The same
      // baseline is checked again, not a new animation/video frame.
      raf=win.requestAnimationFrame(()=>{raf=win.requestAnimationFrame(()=>{
        raf=0;if(done||!same()){clean();return;}
        const confirmed=newContent(record.frame,structure(win,doc));
        if(!confirmed){schedule();return;}
        this.#send("SoftPaint",{token,uri:win.location.href,oldURI,evidence:"route-content",reason:confirmed});
        clean();
      });});
    };
    const schedule=()=>{if(!done&&!timer&&!raf)timer=win.setTimeout(check,90);};
    const wake=()=>schedule();
    this.#softCleanup=clean;
    try{
      observer=new win.MutationObserver(wake);
      observer.observe(doc.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:["hidden","style","class","src","aria-hidden"]});
      win.addEventListener("load",wake,true,true);
      win.addEventListener("loadeddata",wake,true,true);
      win.addEventListener("playing",wake,true,true);
      // Polling is bounded and coalesced; this also catches already-delivered
      // changes and responsive layouts without requiring a site-specific event.
      schedule();hard=win.setTimeout(clean,3900);
    }catch{clean();}
  }
  didDestroy(){
    this.#dead=true;this.#paintObserver?.disconnect();this.#softCleanup?.();
    this.#baselines.clear();this.#inputBaseline=null;
  }
}
