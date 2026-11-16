/* Zen Refined — Center Disassembly. Explicit native close-window command only.
 * No interception of OS shutdown, window.close(), tab close, quit, beforeunload
 * or session persistence. All native confirmation decisions stay native.
 */
(() => {
  const KEY="__zenRefinedClosingAnimation",PREF="zen.refined.closing.animation",DURATION=520;
  const root=document.documentElement,prefs=Services.prefs;
  const MARK="data-zr-close-effect",MOVE="data-zr-close-move",CLIP="data-zr-close-clip",PROGRESS="--zr-close-progress";
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
  const get=id=>document.getElementById(id);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  if(typeof window.addUnloadListener!=="function"||root.hasAttribute("popup-window"))return;
  window[KEY]?.();
  let dead=false,owner=null,original=null,wrapped=null,observer=null,style=null,sheet=null;
  const animations=new Set(),owned=new Map();

  function makeCloseController({eligible,begin,clear,later,cancelLater,invoke}){
    let pending=null,timer=null;
    function finish(proceed){
      if(!pending)return;
      const request=pending;pending=null;
      if(timer!==null)cancelLater(timer);timer=null;
      try{clear();}catch{}
      if(proceed)return invoke(request.receiver,request.args);
    }
    return {
      request(receiver,args){
        if(pending)return finish(true);
        if(!eligible(args))return invoke(receiver,args);
        pending={receiver,args};
        try{
          if(begin()){timer=later(()=>finish(true),DURATION);return;}
        }catch{}
        return finish(true);
      },
      flush(){return finish(true);},
      dispose(){return finish(false);},
      get pending(){return pending!==null;}
    };
  }
  function visible(n){
    if(!n?.isConnected||n.hidden||n.collapsed)return null;
    const s=window.getComputedStyle(n),r=n.getBoundingClientRect();
    if(s.display==="none"||s.visibility!=="visible"||Number(s.opacity)<=0||r.width<2||r.height<2||
      r.right<=0||r.bottom<=0||r.left>=window.innerWidth||r.top>=window.innerHeight)return null;
    return {n,r,s};
  }
  function collect(){
    const row=get("oneplane-tabs"),island=row?.querySelector(".oneplane-title-island");
    const ir=visible(island),rr=visible(row),url=get("urlbar-container"),ur=visible(url);
    const center=ir?ir.r.left+ir.r.width/2:rr?rr.r.left+rr.r.width/2:ur?ur.r.left+ur.r.width/2:window.innerWidth/2;
    const result=[];
    function add(n,x=0,y=0,clip=false,delay=0,length=350){
      if(!n||result.length>=100||result.some(t=>t.n===n||t.n.contains(n)||n.contains(t.n)))return;
      const t=visible(n);if(!t)return;
      const move=t.s.translate==="none"||/^0(?:px|%)?(?: 0(?:px|%)?){0,2}$/.test(t.s.translate);
      result.push({n,x:move?x:0,y:move?y:0,clip,delay,length,opacity:Number(t.s.opacity)});
    }
    const floating=get("urlbar");
    const floatVisible=floating&&(floating.getAttribute("zen-floating-urlbar")==="true"||floating.hasAttribute("zen-newtab"));
    if(floatVisible)add(floating,0,0,true,0,280);
    for(const n of Array.from(get("PlacesToolbarItems")?.children||[])){
      const t=visible(n);if(t)add(n,0,-14,false,Math.max(0,55-Math.abs(t.r.left+t.r.width/2-center)*.09),280);
    }
    if(rr){
      const list=row.querySelector(".oneplane-tab-list");
      for(const n of list?.querySelectorAll(".oneplane-tab,.oneplane-split-group")||[]){
        if(n.classList.contains("oneplane-tab")&&n.closest(".oneplane-split-group"))continue;
        const t=visible(n),lane=n.closest(".oneplane-island-lane")||list,lr=lane?.getBoundingClientRect();
        if(!t||!lr||t.r.right<=lr.left||t.r.left>=lr.right)continue;
        const dx=clamp(center-t.r.left-t.r.width/2,-360,360);
        add(n,dx,0,false,Math.max(65,155-Math.abs(dx)*.22),320);
      }
      add(row.querySelector(".oneplane-new-tab"),-26,0,false,80,300);
      add(island,0,0,true,150,320);
    }else{
      const sidebar=get("zen-tabs-wrapper")||get("TabsToolbar");
      const t=visible(sidebar);if(t)add(sidebar,t.r.left<window.innerWidth/2?-18:18,0,false,95,330);
    }
    if(!floatVisible)add(url,0,0,true,165,330);
    const candidates=new Set();
    let captions=null;try{captions=window.gZenVerticalTabsManager?.actualWindowButtons;}catch{}
    for(const parent of [get("nav-bar-customization-target"),get("nav-bar"),captions,get("titlebar-buttonbox"),get("zen-sidebar-top-buttons")]){
      if(!parent)continue;
      for(const n of parent.querySelectorAll("toolbarbutton,button,.titlebar-button,[role=button]"))candidates.add(n);
    }
    const leaves=[...candidates].filter(n=>![...candidates].some(c=>c!==n&&n.contains(c)));
    for(const n of leaves){
      if(row?.contains(n)||url?.contains(n))continue;
      const t=visible(n);if(t)add(n,t.r.left+t.r.width/2<center?14:-14,-4,false,85+Math.min(90,Math.abs(t.r.left-center)*.12),310);
    }
    return result;
  }
  function restore(){
    for(const a of animations)try{a.cancel();}catch{}
    animations.clear();
    for(const [n,record] of owned){
      for(const [k,v] of record.styles){
        if(v.value)n.style.setProperty(k,v.value,v.priority);else n.style.removeProperty(k);
      }
      for(const [k,v] of record.attrs){
        if(v===null)n.removeAttribute(k);else n.setAttribute(k,v);
      }
    }
    owned.clear();
    if(sheet)try{window.windowUtils.removeSheet(sheet,window.windowUtils.USER_SHEET);}catch{}
    sheet=null;style?.remove();style=null;root.removeAttribute("data-zr-closing");
  }
  function set(n,k,v){
    const rec=owned.get(n);
    if(!rec.styles.has(k))rec.styles.set(k,{value:n.style.getPropertyValue(k),priority:n.style.getPropertyPriority(k)});
    n.style.setProperty(k,v);
  }
  function attr(n,k){
    const rec=owned.get(n);if(!rec.attrs.has(k))rec.attrs.set(k,n.getAttribute(k));n.setAttribute(k,"true");
  }
  function begin(){
    const targets=collect();if(!targets.length)return false;
    let registered=false;
    try{window.CSS.registerProperty({name:PROGRESS,syntax:"<number>",inherits:false,initialValue:"1"});registered=true;}
    catch(e){registered=e.name==="InvalidModificationError";}
    if(registered){
      const scope=":root[data-zr-closing] [data-zr-close-effect]"+":is(#zr-close-specificity,[data-zr-close-effect])".repeat(8);
      const edge="calc(49% * (1 - var("+PROGRESS+")) - 8px * var("+PROGRESS+"))";
      const css=scope+" {transition-property:none !important;opacity:calc(var(--zr-close-opacity) * var("+PROGRESS+")) !important;}\n"+
        scope+"[data-zr-close-move] {translate:calc(var(--zr-close-x) * (1 - var("+PROGRESS+"))) calc(var(--zr-close-y) * (1 - var("+PROGRESS+"))) !important;}\n"+
        scope+"[data-zr-close-clip] {clip-path:inset(-8px "+edge+" -8px "+edge+" round 8px) !important;}";
      try{sheet=Services.io.newURI("data:text/css;charset=utf-8,"+encodeURIComponent(css));window.windowUtils.loadSheet(sheet,window.windowUtils.USER_SHEET);}
      catch{sheet=null;style=document.createElementNS("http://www.w3.org/1999/xhtml","style");style.textContent=css;root.append(style);}
    }
    root.setAttribute("data-zr-closing","true");
    for(const {n,x,y,clip,delay,length,opacity} of targets){
      try{
        let frames;
        if(registered){
          owned.set(n,{styles:new Map(),attrs:new Map()});
          set(n,PROGRESS,"1");set(n,"--zr-close-opacity",String(opacity));attr(n,MARK);
          if(x||y){set(n,"--zr-close-x",x+"px");set(n,"--zr-close-y",y+"px");attr(n,MOVE);}
          if(clip)attr(n,CLIP);
          frames=[{[PROGRESS]:"1"},{[PROGRESS]:"0"}];
        }else{
          const from={opacity},to={opacity:0};
          if(x||y){from.translate="0px 0px";to.translate=x+"px "+y+"px";}
          if(clip){from.clipPath="inset(-8px round 8px)";to.clipPath="inset(-8px 49% -8px 49% round 8px)";}
          frames=[from,to];
        }
        animations.add(n.animate(frames,{delay,duration:length,easing:"cubic-bezier(.4,0,.35,1)",fill:"both"}));
      }catch(e){console.warn("[Zen Refined] Close effect:",e);}
    }
    return animations.size>0;
  }
  function eligible(args){
    const event=args[0];
    return !dead&&!window.closed&&!Services.startup.shuttingDown&&
      prefs.getBoolPref(PREF,true)&&!reduced.matches&&!!event?.isTrusted&&
      !root.hasAttribute("customizing")&&root.getAttribute("inDOMFullscreen")!=="true"&&
      !root.hasAttribute("data-zr-startup-phase");
  }
  const controller=makeCloseController({
    eligible,begin,clear:restore,
    later:(fn,ms)=>window.setTimeout(fn,ms),cancelLater:id=>window.clearTimeout(id),
    invoke:(receiver,args)=>Reflect.apply(original,receiver,args)
  });
  function preferenceChanged(){if(reduced.matches||!prefs.getBoolPref(PREF,true))controller.flush();}
  function install(){
    if(dead||wrapped)return;
    owner=window.BrowserCommands;
    if(typeof owner?.tryToCloseWindow!=="function")return;
    original=owner.tryToCloseWindow;
    wrapped=function(...args){return controller.request(this,args);};
    try{owner.tryToCloseWindow=wrapped;if(owner.tryToCloseWindow!==wrapped)wrapped=null;}
    catch{wrapped=null;}
  }
  function dispose(){
    if(dead)return;dead=true;controller.dispose();restore();
    if(owner&&wrapped&&owner.tryToCloseWindow===wrapped)owner.tryToCloseWindow=original;
    if(observer)try{Services.obs.removeObserver(observer,"browser-delayed-startup-finished");}catch{}
    observer=null;
    try{prefs.removeObserver(PREF,preferenceChanged);}catch{}
    reduced.removeEventListener("change",preferenceChanged);
    window.removeEventListener("unload",dispose);
    if(window[KEY]===dispose)delete window[KEY];
  }
  window[KEY]=dispose;window.addUnloadListener(dispose);window.addEventListener("unload",dispose,{once:true});
  prefs.addObserver(PREF,preferenceChanged);reduced.addEventListener("change",preferenceChanged);
  install();
  if(!wrapped&&!window.gBrowserInit?.delayedStartupFinished){
    observer=subject=>{if(subject!==window)return;Services.obs.removeObserver(observer,"browser-delayed-startup-finished");observer=null;install();};
    Services.obs.addObserver(observer,"browser-delayed-startup-finished");
  }
})();
