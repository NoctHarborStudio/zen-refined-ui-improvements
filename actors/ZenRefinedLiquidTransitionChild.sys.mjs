/* Browser-process bridge: exact pointer origin and navigation readiness. */
export class ZenRefinedLiquidTransitionChild extends JSWindowActorChild {
  #paintObserver=null;
  #paintSent=false;
  #softCleanup=null;
  #dead=false;
  #ytStart=0;
  #ytFinish=0;
  #ytUrl="";
  #ytListeners=null;
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
  #youtube() {
    try { return /(^|\.)youtube\.com$/i.test(this.contentWindow.location.hostname); } catch { return false; }
  }
  #send(name,data={}) { if(!this.#dead)try{this.sendAsyncMessage(name,data);}catch{} }
  #paint(){if(this.#paintSent)return;this.#paintSent=true;this.#send("Paint");}
  handleEvent(event) {
    const win=this.contentWindow;
    if (!win) return;
    if(event.type==="pointerdown" || (event.type==="click" && event.detail===0)){
      if(!event.isTrusted || event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)return;
      const path=event.composedPath();
      if(path.some(n=>n?.nodeType===1 && n.matches?.("input, textarea, select, [contenteditable=true]")))return;
      const link=path.find(n=>n?.nodeType===1 && n.matches?.("a[href], area[href], [role=link], ytd-thumbnail, yt-lockup-view-model"));
      if(link?.hasAttribute("download") || (link?.target && !["_self","_top","_parent"].includes(link.target.toLowerCase())))return;
      let x=event.clientX,y=event.clientY;
      if(event.type==="click" && event.detail===0 && link){
        const r=link.getBoundingClientRect();x=r.x+r.width/2;y=r.y+r.height/2;
      }
      // Only geometry and a boolean cross the process boundary, never content.
      this.#send("Origin",{x,y,vw:win.innerWidth,vh:win.innerHeight,navigation:!!link});
    }else if(event.type==="pageshow"){
      if(event.persisted)this.#send("Paint");
      else if(win.performance.getEntriesByName("first-contentful-paint").length)this.#paint();
    }else if(event.type==="DOMContentLoaded"&&!this.#paintObserver){
      win.requestAnimationFrame(()=>win.requestAnimationFrame(()=>this.#paint()));
    }
  }
  receiveMessage(message){
    if(message.name==="CancelSoft"){this.#softCleanup?.();return;}
    if(message.name!=="WatchSoft")return;
    this.#softCleanup?.();
    const win=this.contentWindow,doc=this.document;
    if(!win||!doc?.documentElement)return;
    const token=message.data.token, start=win.performance.now(), youtube=this.#youtube();
    let timer=0,hard=0,raf=0,observer,done=false,ytEnd=null;
    const cleanup=()=>{
      if(done)return;done=true;
      win.clearTimeout(timer);win.clearTimeout(hard);win.cancelAnimationFrame(raf);observer?.disconnect();
      if(ytEnd)win.removeEventListener("yt-navigate-finish",ytEnd,true);
      if(this.#softCleanup===cleanup)this.#softCleanup=null;
    };
    const finish=()=>{if(done)return;cleanup();this.#send("SoftReady",{token});};
    const afterPaint=()=>{
      win.cancelAnimationFrame(raf);
      raf=win.requestAnimationFrame(()=>{raf=win.requestAnimationFrame(finish);});
    };
    this.#softCleanup=cleanup;
    try {
      if(youtube){
        ytEnd=()=>afterPaint();
        win.addEventListener("yt-navigate-finish",ytEnd,true,true);
        if(this.#ytFinish>=this.#ytStart && this.#ytUrl===win.location.href && start-this.#ytFinish<800)afterPaint();
        // Proprietary event can change; do not wait indefinitely.
        hard=win.setTimeout(afterPaint,2600);
      }else{
        const settle=()=>{
          win.clearTimeout(timer);win.cancelAnimationFrame(raf);
          timer=win.setTimeout(afterPaint,110);
        };
        observer=new win.MutationObserver(settle);
        observer.observe(doc.documentElement,{childList:true,subtree:true,characterData:true});
        settle();hard=win.setTimeout(afterPaint,1150);
      }
    }catch{finish();}
  }
  didDestroy(){this.#dead=true;this.#paintObserver?.disconnect();this.#softCleanup?.();this.#ytListeners?.();}
}
