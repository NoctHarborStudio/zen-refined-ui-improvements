/* Browser-process bridge: exact pointer origin and navigation readiness. */
export class ZenRefinedApertureTransitionChild extends JSWindowActorChild {
  #paintObserver=null;
  #paintSent=false;
  #softCleanup=null;
  #dead=false;
  #ytStart=0;
  #ytFinish=0;
  #ytUrl="";
  #ytListeners=null;
  #lastWarm=-Infinity;
  #lastContentMutation=0;
  #mutationObserver=null;
  #lastMutationUri="";
  #lastInputAt=0;
  #mutationTimer=0;
  actorCreated() {
    const win=this.contentWindow;
    if (!win) return;
    try {
      this.#paintObserver=new win.PerformanceObserver(entries=>{
        if(entries.getEntries().some(entry=>entry.name==="first-contentful-paint"))this.#paint();
      });
      this.#paintObserver.observe({type:"paint",buffered:true});
    } catch { this.#paintObserver=null; }
    if (this.#youtube()) {
      const start=()=>{ this.#ytStart=win.performance.now(); };
      const end=()=>{ this.#ytFinish=win.performance.now(); this.#ytUrl=win.location.href; };
      win.addEventListener("yt-navigate-start",start,true,true);
      win.addEventListener("yt-navigate-finish",end,true,true);
      this.#ytListeners=()=>{win.removeEventListener("yt-navigate-start",start,true);win.removeEventListener("yt-navigate-finish",end,true);};
    }
  }
  #armMutationTracking(win){
    this.#mutationObserver?.disconnect();
    win.clearTimeout(this.#mutationTimer);
    this.#lastContentMutation=0;this.#lastMutationUri="";
      // Track actual content changes, including changes delivered before the
      // parent receives the same-document URL notification. No DOM text leaves
      // the content process.
      try{
        this.#mutationObserver=new win.MutationObserver(records=>{
          const relevant=records.some(r=>{
            const n=r.target?.nodeType===1?r.target:r.target?.parentElement;
            if(!n||n.closest?.("header,nav,[role=navigation],script,style"))return false;
            if(r.type==="characterData")return !!n.closest?.("main,article,[role=main],#content,ytd-watch-flexy");
            return r.type==="childList"&&(r.addedNodes.length||r.removedNodes.length);
          });
          if(relevant){this.#lastContentMutation=win.performance.now();this.#lastMutationUri=win.location.href;}
        });
        if(win.document.documentElement)this.#mutationObserver.observe(win.document.documentElement,{childList:true,subtree:true,characterData:true});
      }catch{}
  
    this.#mutationTimer=win.setTimeout(()=>this.#mutationObserver?.disconnect(),1800);
  }
  #youtube() {
    try { return /(^|\.)youtube\.com$/i.test(this.contentWindow.location.hostname); } catch { return false; }
  }
  #send(name,data={}) { if(!this.#dead)try{this.sendAsyncMessage(name,data);}catch{} }
  #paint(){if(this.#paintSent)return;this.#paintSent=true;this.#send("Paint");}
  handleEvent(event) {
    const win=this.contentWindow;
    if (!win) return;
    if(event.type==="pointermove" || event.type==="scroll"){
      const t=win.performance.now();if(t-this.#lastWarm>1000){this.#lastWarm=t;this.#send("Warm");}return;
    }
    if(event.type==="popstate"){this.#send("History");return;}
    if(event.type==="pointerdown" || (event.type==="click" && event.detail===0)){
      if(!event.isTrusted || event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)return;
      const path=event.composedPath();
      if(path.some(n=>n?.nodeType===1 && n.matches?.("input, textarea, select, [contenteditable=true]")))return;
      const link=path.find(n=>n?.nodeType===1 && n.matches?.("a[href], area[href], [role=link], ytd-thumbnail, yt-lockup-view-model"));
      if(!link)return;
      if(link?.hasAttribute("download") || (link?.target && !["_self","_top","_parent"].includes(link.target.toLowerCase())))return;
      let x=event.clientX,y=event.clientY;
      if(event.type==="click" && event.detail===0 && link){
        const r=link.getBoundingClientRect();x=r.x+r.width/2;y=r.y+r.height/2;
      }
      // A bounded raw snapshot crosses only local privileged actor IPC; it is never persisted.
      this.#lastInputAt=win.performance.now();
      this.#armMutationTracking(win);
      const pixels=null; // parent prewarms snapshots; no synchronous content readback
      this.#send("Origin",{x,y,vw:win.innerWidth,vh:win.innerHeight,navigation:true,pixels});
    }else if(event.type==="pageshow"){
      if(event.persisted)this.#send("Paint");
      else if(win.performance.getEntriesByName("first-contentful-paint").length)this.#paint();
    }else if(event.type==="DOMContentLoaded"){
      // FCP is preferred; DOMContentLoaded plus two refresh frames is a
      // fallback for pages/engines that omit or delay paint timing entries.
      win.requestAnimationFrame(()=>win.requestAnimationFrame(()=>this.#paint()));
    }
  }
  receiveMessage(message){
    if(message.name==="CancelSoft"){this.#softCleanup?.();return;}
    if(message.name!=="WatchSoft")return;
    this.#softCleanup?.();
    const win=this.contentWindow,doc=this.document;
    if(!win||!doc?.documentElement)return;
    const token=message.data.token, uri=message.data.uri, start=win.performance.now(),youtube=this.#youtube();
    let raf=0,hard=0,observer,done=false,ytEnd=null;
    const clean=()=>{
      if(done)return;done=true;win.cancelAnimationFrame(raf);win.clearTimeout(hard);observer?.disconnect();
      if(ytEnd)win.removeEventListener("yt-navigate-finish",ytEnd,true);
      if(this.#softCleanup===clean)this.#softCleanup=null;
    };
    const same=()=>win.location.href.split("#")[0]===String(uri||"").split("#")[0];
    const afterPaint=()=>{
      if(done||raf||!same())return;
      raf=win.requestAnimationFrame(()=>{raf=win.requestAnimationFrame(()=>{
        if(done||!same()){clean();return;}
        this.#send("SoftPaint",{token,uri:win.location.href});
        clean();
      });});
    };
    this.#softCleanup=clean;
    try{
      // A changed URL alone does not certify new content. Observe an actual
      // content update, or YouTube's route event, then allow two paints.
      observer=new win.MutationObserver(records=>{
        const relevant=records.some(r=>{
          const n=r.target?.nodeType===1?r.target:r.target?.parentElement;
          if(!n||n.closest?.("header,nav,[role=navigation],script,style"))return false;
          return r.type==="characterData"?!!n.closest?.("main,article,[role=main],#content,ytd-watch-flexy"):
            r.type==="childList"&&(r.addedNodes.length||r.removedNodes.length);
        });
        if(relevant)afterPaint();
      });
      observer.observe(doc.documentElement,{childList:true,subtree:true,characterData:true});
      if(this.#lastMutationUri===win.location.href&&this.#lastContentMutation>0&&
        this.#lastContentMutation>=this.#lastInputAt&&start-this.#lastContentMutation<700)afterPaint();
      if(youtube){
        ytEnd=()=>afterPaint();win.addEventListener("yt-navigate-finish",ytEnd,true,true);
        if(this.#ytFinish>0&&this.#ytFinish>=this.#ytStart&&this.#ytUrl===win.location.href&&start-this.#ytFinish<800)afterPaint();
      }
      hard=win.setTimeout(clean,3900);
    }catch{clean();}
  }
  didDestroy(){this.#dead=true;this.#paintObserver?.disconnect();this.#mutationObserver?.disconnect();try{this.contentWindow?.clearTimeout(this.#mutationTimer);}catch{}this.#softCleanup?.();this.#ytListeners?.();}
}
