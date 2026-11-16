/* Zen Refined — workspace transition; explicit Home/Hub integration.
 * Native workspace ownership, page surfaces and theme animation stay in Zen. */
(()=>{
  const win=window,root=document.documentElement,prefs=Services.prefs;
  const KEY="__zenRefinedWorkspaceTransition",PREF="zen.refined.workspace.transition";
  const PHASE="data-zr-workspace-phase",MARK="data-zr-workspace-motion",PROGRESS="--zr-workspace-progress";
  const get=id=>document.getElementById(id);
  if(typeof win.addUnloadListener!=="function"||root.hasAttribute("popup-window"))return;
  win[KEY]?.dispose?.();
  let dead=false,active=null,uri=null,style=null,registered=false;
  const reduced=win.matchMedia("(prefers-reduced-motion: reduce)");
  function distance(center,mid){return Math.max(-440,Math.min(440,center-mid));}
  function eligible(state){return !state.dead&&!state.busy&&!state.reduced&&!state.startup&&state.enabled&&!state.fullscreen;}
  function units(){
    const row=get("oneplane-tabs"),one=root.getAttribute("oneplane-active")==="true"&&row?.getAttribute("data-ready")==="true";
    const list=one?row.querySelector(".oneplane-tab-list"):get("tabbrowser-tabs");
    const nodes=one?list?.querySelectorAll(".oneplane-tab,.oneplane-split-group"):list?.querySelectorAll(".tabbrowser-tab:not([zen-essential])");
    const bookmarks=get("PlacesToolbarItems"),out=[];
    const bounds=n=>{if(!n||n.hidden||n.collapsed||!n.isConnected)return null;const r=n.getBoundingClientRect(),s=win.getComputedStyle(n);return r.width>1&&r.height>1&&r.right>0&&r.left<win.innerWidth&&r.bottom>0&&r.top<win.innerHeight&&s.display!=="none"&&s.visibility!=="hidden"?r:null;};
    const island=one?bounds(row.querySelector(".oneplane-title-island")):null;
    const tabCenter=island?island.left+island.width/2:one?win.innerWidth/2:null;
    const bm=bounds(bookmarks),bmCenter=bm?bm.left+bm.width/2:win.innerWidth/2;
    for(const n of nodes||[]){
      if(one&&n.classList.contains("oneplane-tab")&&n.closest(".oneplane-split-group"))continue;
      const r=bounds(n);if(!r)continue;
      if(one){const lane=n.closest(".oneplane-island-lane")||list,lr=lane.getBoundingClientRect();if(r.right<=lr.left||r.left>=lr.right)continue;}
      out.push({n,dx:one?distance(tabCenter,r.left+r.width/2):0,dy:one?0:distance(win.innerHeight/2,r.top+r.height/2)});
    }
    for(const n of bookmarks?.children||[]){const r=bounds(n);if(r)out.push({n,dx:distance(bmCenter,r.left+r.width/2),dy:0});}
    return out;
  }
  function phase(value){
    if(value)root.setAttribute(PHASE,value);else root.removeAttribute(PHASE);
    win.dispatchEvent(new win.CustomEvent("ZenRefined:WorkspaceTransition",{detail:{phase:value||"idle"}}));
  }
  function restore(tx){
    for(const [n,old] of tx.styles){
      for(const [k,v,p] of old){if(v)n.style.setProperty(k,v,p);else n.style.removeProperty(k);}
      n.removeAttribute(MARK);
    }
    tx.styles.clear();
  }
  function cancelEffects(tx){for(const a of tx.animations)try{a.cancel();}catch{}tx.animations.clear();restore(tx);}
  function cleanup(tx){
    if(active!==tx)return;
    tx.cancelled=true;
    cancelEffects(tx);
    for(const t of tx.timers)win.clearTimeout(t);
    for(const resolve of tx.waiters)resolve();
    tx.timers.clear();tx.waiters.clear();
    active=null;phase(null);
  }
  function pause(tx,ms){
    if(tx.cancelled)return Promise.resolve();
    return new Promise(resolve=>{
      const done=()=>{tx.waiters.delete(done);tx.timers.delete(t);resolve();};
      const t=win.setTimeout(done,ms);tx.timers.add(t);tx.waiters.add(done);
    });
  }
  function animate(tx,items,inward){
    const length=inward?260:430;
    const effects=[];
    for(const {n,dx,dy} of items.slice(0,90)){
      if(!n.isConnected)continue;
      const css=win.getComputedStyle(n);
      const opacity=Number(css.opacity);
      const names=[PROGRESS,"--zr-workspace-dx","--zr-workspace-dy","--zr-workspace-opacity"];
      tx.styles.set(n,names.map(k=>[k,n.style.getPropertyValue(k),n.style.getPropertyPriority(k)]));
      n.style.setProperty(PROGRESS,inward?"1":"0");
      n.style.setProperty("--zr-workspace-dx",dx+"px","important");
      n.style.setProperty("--zr-workspace-dy",dy+"px","important");
      // During the swap, the gate is on the parent, not the sampled node.
      n.style.setProperty("--zr-workspace-opacity",String(Number.isFinite(opacity)&&opacity>0?opacity:1),"important");
      n.setAttribute(MARK,"true");
      try{
        const a=n.animate([{[PROGRESS]:inward?"1":"0"},{[PROGRESS]:inward?"0":"1"}],{duration:length,easing:"cubic-bezier(.33,.05,.2,1)",fill:"both"});
        tx.animations.add(a);effects.push(a.finished.catch(()=>{}));
      }catch{}
    }
    return Promise.race([Promise.all(effects),pause(tx,length+60)]);
  }
  async function settled(tx){
    // Native Places invalidation is asynchronous. Wait for a short
    // mutation-quiet interval, with a hard upper bound.
    let changed=win.performance.now(),start=changed,observer=null;
    try{
      observer=new win.MutationObserver(()=>{changed=win.performance.now();});
      for(const n of [get("PlacesToolbarItems"),get("oneplane-tabs")?.querySelector(".oneplane-tab-list")])if(n)observer.observe(n,{childList:true,subtree:true});
      await pause(tx,70);
      while(!tx.cancelled&&win.performance.now()-start<420&&win.performance.now()-changed<70)await pause(tx,35);
    }finally{observer?.disconnect();}
  }
  async function run(nativeSwitch){
    if(typeof nativeSwitch!=="function")throw TypeError("Native workspace callback required");
    // A newer explicit request supersedes an unfinished outgoing effect.
    // Never let the older delayed callback select a workspace afterward.
    if(active){active.superseded=true;cleanup(active);}
    if(!registered||!eligible({dead,busy:!!active,reduced:reduced.matches,startup:root.hasAttribute("data-zr-startup-phase")||root.getAttribute("data-op-startup-ready")==="pending",enabled:prefs.getBoolPref(PREF,true),fullscreen:root.hasAttribute("customizing")||root.getAttribute("inDOMFullscreen")==="true"||root.getAttribute("inFullscreen")==="true"}))return nativeSwitch();
    const tx={animations:new Set(),styles:new Map(),timers:new Set(),waiters:new Set(),cancelled:false,superseded:false};active=tx;
    // Native switching owns its own promise; visual gating must never
    // remain stuck if that promise is slow or fails to settle.
    tx.timers.add(win.setTimeout(()=>cleanup(tx),2500));
    let called=false,result;
    try{
      const old=units();
      if(!old.length){cleanup(tx);called=true;return await nativeSwitch();}
      phase("out");
      await animate(tx,old,true);
      if(tx.superseded||dead&&win.closed)return;
      if(!tx.cancelled){phase("swap");cancelEffects(tx);}
      called=true;result=await nativeSwitch();
      if(tx.cancelled)return result;
      await settled(tx);
      if(tx.cancelled)return result;
      // Install incoming effects under the gate; reveal them atomically.
      const incoming=units(),motion=animate(tx,incoming,false);
      phase("in");
      await motion;
      return result;
    }catch(error){
      if(!called){called=true;cleanup(tx);return tx.superseded?undefined:nativeSwitch();}
      throw error;
    }finally{cleanup(tx);}
  }
  function abort(){if(active)cleanup(active);}
  function onKey(e){if(e.key==="Escape")abort();}
  function dispose(){
    if(dead)return;dead=true;abort();
    win.removeEventListener("unload",dispose);win.removeEventListener("keydown",onKey,true);win.removeEventListener("beforecustomization",abort);
    reduced.removeEventListener("change",abort);try{prefs.removeObserver(PREF,abort);}catch{}
    if(uri)try{win.windowUtils.removeSheet(uri,win.windowUtils.USER_SHEET);}catch{}
    style?.remove();if(win[KEY]===api)delete win[KEY];
  }
  const api={run,dispose};
  try{
    try{win.CSS.registerProperty({name:PROGRESS,syntax:"<number>",inherits:false,initialValue:"1"});registered=true;}catch(e){registered=e.name==="InvalidModificationError";}
    // Scope important overrides to the animated chrome only; Magnetic
    // Bookmarks uses important translate/transform in its normal state.
    const spec=":is(#zr-workspace-specificity,[data-zr-workspace-motion])".repeat(8);
    const motion=":root[data-zr-workspace-phase] ["+MARK+"]"+spec;
    const sheet=motion+"{transition-property:none!important;opacity:calc(var(--zr-workspace-opacity)*var("+PROGRESS+"))!important;translate:calc(var(--zr-workspace-dx)*(1 - var("+PROGRESS+"))) calc(var(--zr-workspace-dy)*(1 - var("+PROGRESS+")))!important;scale:calc(.3 + .7 * var("+PROGRESS+"))!important;pointer-events:none!important;}"+
      ':root[data-zr-workspace-phase="swap"] :is(#oneplane-tabs .oneplane-tab-list,#PlacesToolbarItems,#tabbrowser-tabs){opacity:0!important;pointer-events:none!important;}'+
      ':root[data-zr-workspace-phase] :is(#oneplane-tab-indicator,#zr-bookmark-indicator){opacity:0!important;}';
    try{uri=Services.io.newURI("data:text/css;charset=utf-8,"+encodeURIComponent(sheet));win.windowUtils.loadSheet(uri,win.windowUtils.USER_SHEET);}
    catch{uri=null;style=document.createElementNS("http://www.w3.org/1999/xhtml","style");style.textContent=sheet;root.append(style);}
    win[KEY]=api;win.addUnloadListener(dispose);win.addEventListener("unload",dispose,{once:true});
    win.addEventListener("keydown",onKey,true);win.addEventListener("beforecustomization",abort);
    reduced.addEventListener("change",abort);prefs.addObserver(PREF,abort);
  }catch(error){console.warn("[Zen Refined] Workspace transition:",error);dispose();}
})();
