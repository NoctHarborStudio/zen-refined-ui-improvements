/* Zen Refined — Magnetic Bookmarks
 * Native bookmarks only. No page content, network requests or browser preference
 * changes. Reads its own settings and OnePlane's contour preferences.
 */
const PREFIX = "zen.refined.bookmarks.";
const CONTROLLER = "__zenRefinedMagneticBookmarks";
const SHARED = "__zenMagneticBookmarksShared";
const REVISION = 1;
const root = document.documentElement;
const prefs = Services.prefs;
let disposed = false;
let startupObserver = null;

function install() {
  const toolbar = document.getElementById("PersonalToolbar");
  const list = document.getElementById("PlacesToolbarItems");
  const navbar = document.getElementById("nav-bar");
  if (!toolbar || !list || !toolbar.contains(list)) return null;

  const indicator = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
  indicator.id = "zr-bookmark-indicator";
  indicator.setAttribute("aria-hidden", "true");
  indicator.setAttribute("skipintoolbarset", "true");
  indicator.setAttribute("removable", "false");
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const number = (key, fallback, lo, hi) => clamp(prefs.getIntPref(PREFIX + key, fallback), lo, hi);
  const bool = (key, fallback) => prefs.getBoolPref(PREFIX + key, fallback);
  const state = new Map();
  let active = null, pointerX = null, dragging = false, dead = false;
  const openPopups = new Set();
  let raf = 0, last = 0, until = 0, cx = 0, cy = 0, w = 14, h = 3, vx = 0;
  let shown = false, toolbarWidth = 0, refreshFrame = 0;
  let leaveTimer=0, flipTimer=0, flipEpoch=0, motionPlan=null, contourFrame=0, contourSurface=null, contourKey="";
  const flips=new Map(),flipNodes=new Set(),cards=new Map(),contentLocks=new Map();
  let pointerFrame=0,pendingPointer=null,lastIndicatorTransform="",lastPointer=null;
  const FLIP_EASE="cubic-bezier(.333333,0,.666667,1)";
  let baseHeight=0,basePadding=0,reserve=0;
  const busy=()=>state.size>0||flips.size>0||cards.size>0&&!active;
  const wrapper = document.getElementById("zen-appcontent-navbar-wrapper");
  const contourPrefix = "zen.oneplane.fade-";
  const GAP_GRACE_MS = 180;
  let settings = {};
  let addressSuspended=false, addressPointer=null;
  function syncAddressState(){
    const next=root.hasAttribute("data-op-bookmark-wave");
    if(next===addressSuspended)return;
    addressSuspended=next;
    if(next){
      addressPointer=lastPointer;
      clear(true);
    }else{
      // Do not retarget from layout-generated pointer events.
      lastPointer=addressPointer;
      addressPointer=null;
      updateReserve();
      scheduleContour();
    }
  }

  // Measure the native row before enabling our fixed bottom reserve.
  // The old +8px top padding pushed the bookmark row downward.
  function measureBase(){
    const style=window.getComputedStyle(toolbar);
    baseHeight=Math.max(0,toolbar.getBoundingClientRect().height);
    basePadding=parseFloat(style.paddingBottom)||0;
  }
  measureBase();
  function desiredY(){return Math.min(1.36,Math.max(1.08,1+(settings.scale-1)*.86));}
  function verticalReserve(height,scale){return Math.ceil(height*Math.max(0,scale-1)+8);}
  function updateReserve(){
    if(!settings.enabled)return;
    let height=0;
    for(const item of candidates()){
      const h=state.get(item)?.height||item.getBoundingClientRect().height;
      height=Math.max(height,h);
    }
    // The reserve is structural, not hover-dependent. It includes the
    // underline below the expanded card, and never grows per frame.
    const next=verticalReserve(Math.max(24,height),desiredY());
    if(next===reserve&&toolbar.style.getPropertyValue("--zr-bm-base-height"))return;
    reserve=next;
    toolbar.style.setProperty("--zr-bm-base-height",Math.max(24,baseHeight)+"px");
    toolbar.style.setProperty("--zr-bm-base-pad-bottom",basePadding+"px");
    toolbar.style.setProperty("--zr-bm-reserve",reserve+"px");
  }
  function contourSettings(){
    const read=(name,min,max,def)=>clamp(prefs.getIntPref(contourPrefix+name,def),min,max);
    const length=read("length",10,160,69);
    return {transparency:read("transparency",0,40,4),strength:read("strength",0,100,100),
      length,hold:Math.min(length-1,read("hold",0,45,30)),curve:read("curve",25,300,65),
      radius:read("radius",4,24,24),padding:read("padding",0,20,0)};
  }
  // Same contour geometry as OnePlane preview.32. The input is a fixed
  // envelope of the RESTING bookmarks plus the maximum expansion budget,
  // not the animated getBoundingClientRect() values.
  function contourPath(width,base,deep,left,right,radius){
    const r=Math.max(0,Math.min(radius,(deep-base)/2)),outside=radius+4;
    if(!r||left===null||right===null)return "M"+(-outside)+" "+base+"H"+(width+outside);
    const start=Math.min(-outside,left-2*r-outside),end=Math.max(width+outside,right+2*r+outside);
    return "M"+start+" "+base+"H"+(left-2*r)+" A"+r+" "+r+" 0 0 1 "+(left-r)+" "+(base+r)+
      " V"+(deep-r)+" A"+r+" "+r+" 0 0 0 "+left+" "+deep+" H"+right+
      " A"+r+" "+r+" 0 0 0 "+(right+r)+" "+(deep-r)+" V"+(base+r)+
      " A"+r+" "+r+" 0 0 1 "+(right+2*r)+" "+base+" H"+end;
  }
  function contourImage(width,height,base,deep,left,right,opt){
    const edge=contourPath(width,base,deep,left,right,opt.radius),start=Number(edge.match(/^M(-?[\d.]+)/)[1]);
    const positions=Array.from({length:65},(_,i)=>opt.length*i/64);positions.push(opt.hold);positions.sort((a,b)=>a-b);
    const stops=positions.map(y=>{
      const t=clamp((y-opt.hold)/(opt.length-opt.hold),0,1);
      const alpha=opt.strength/100*Math.pow(Math.max(0,1-t*t*(3-2*t)),opt.curve/100);
      return '<stop offset="'+(y/opt.length).toFixed(6)+'" stop-color="black" stop-opacity="'+alpha.toFixed(6)+'"/>';
    }).join("");
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'">'+
      '<defs><linearGradient id="fade" gradientUnits="userSpaceOnUse" x1="0" y1="'+base+'" x2="0" y2="'+(base+opt.length)+'">'+stops+'</linearGradient></defs>'+
      '<g opacity="'+(1-opt.transparency/100)+'"><rect x="0" y="'+base+'" width="'+width+'" height="'+opt.length+'" fill="url(#fade)"/>'+
      '<path fill="black" d="'+edge+'V-100H'+start+'Z"/></g></svg>';
    return 'url("data:image/svg+xml,'+encodeURIComponent(svg)+'")';
  }
  function releaseContour(){
    if(contourSurface){
      contourSurface.removeAttribute("data-zr-bm-stable-contour");
      contourSurface.style.removeProperty("--zr-bm-contour-mask");
      contourSurface.style.removeProperty("--zr-bm-contour-height");
    }
    contourSurface=null;contourKey="";
  }
  function updateContour(){
    if(dead||addressSuspended||root.hasAttribute("data-op-bookmark-wave"))return;
    const surface=document.getElementById("oneplane-toolbar-surface"),row=document.getElementById("oneplane-tabs");
    if(!settings.enabled||!settings.stableBackground||!root.hasAttribute("oneplane-active")||
      root.getAttribute("zen-compact-mode")!=="true"||row?.getAttribute("data-ready")!=="true"||
      !wrapper||!surface||!row||toolbar.hidden||toolbar.collapsed||root.hasAttribute("customizing")||
      root.hasAttribute("inDOMFullscreen")){
      releaseContour();return;
    }
    if(contourSurface!==surface)releaseContour();
    // Never recalculate the mask from an animated card, even if a resize or
    // mutation notification arrives during a transition.
    if(busy())return;
    const wr=wrapper.getBoundingClientRect(),nav=navbar?.getBoundingClientRect(),rr=row.getBoundingClientRect(),bm=toolbar.getBoundingClientRect();
    if(wr.width<1||!nav||nav.height<1||bm.height<1)return;
    const container=document.getElementById("zen-appcontent-navbar-container");
    const tr=container?window.getComputedStyle(container).translate:"none";
    const shift=tr&&tr!=="none"?(parseFloat(tr.split(/\s+/)[1])||0):0;
    const width=Math.max(1,Math.round(wr.width)),opt=contourSettings();
    const base=Math.max(1,Math.round(Math.max(nav.bottom,rr.bottom)-wr.top-shift-5));
    let left=null,right=null,deep=base,largest=0;
    const controls=new Set([...list.children,...toolbar.querySelectorAll("toolbarbutton.bookmark-item, #PlacesChevron, #OtherBookmarks")]);
    for(const node of controls){
      if(node.hidden||node.collapsed||node.getAttribute("hidden")==="true"||node.getAttribute("collapsed")==="true")continue;
      const style=window.getComputedStyle(node),r=node.getBoundingClientRect();
      if(style.display==="none"||style.visibility!=="visible"||Number(style.opacity)===0||r.width<1||r.height<1||
        r.right<=bm.left||r.left>=bm.right||r.bottom<=bm.top||r.top>=bm.bottom)continue;
      left=left===null?r.left-wr.left:Math.min(left,r.left-wr.left);
      right=right===null?r.right-wr.left:Math.max(right,r.right-wr.left);
      const growth=eligible(node)?r.height*(desiredY()-1)+7:0;
      deep=Math.max(deep,r.bottom-wr.top-shift+growth+opt.padding);
      if(eligible(node))largest=Math.max(largest,r.width*(settings.scale-1));
    }
    if(left!==null){
      // Centered OnePlane rows shift both ends. A full budget on each side
      // is conservative for native alignment changes and moving neighbors.
      const extra=Math.min(largest,availableGrowth());
      left=Math.floor(Math.max(0,left-extra)-opt.padding);
      right=Math.ceil(Math.min(width,right+extra)+opt.padding);
      deep=Math.ceil(deep);
      if(deep<=base){left=right=null;deep=base;}
    }
    const height=Math.max(1,Math.ceil(Math.max(deep,base+opt.length)+1));
    const key=[width,height,base,deep,left,right,...Object.values(opt)].join(":");
    if(contourSurface===surface&&contourKey===key)return;
    contourSurface=surface;contourKey=key;
    surface.style.setProperty("--zr-bm-contour-height",height+"px");
    surface.style.setProperty("--zr-bm-contour-mask",contourImage(width,height,base,deep,left,right,opt));
    surface.setAttribute("data-zr-bm-stable-contour","true");
  }
  function scheduleContour(){
    if(dead||contourFrame)return;
    contourFrame=window.requestAnimationFrame(()=>{contourFrame=0;updateContour();});
  }
  function readSettings() {
    settings = {
      enabled: bool("enabled", true),
      scale: number("scale", 142, 110, 155) / 100,
      stableBackground: bool("stable-background", true),
      duration: number("duration", 240, 80, 400),
      indicator: bool("indicator", true),
      glow: bool("glow", true)
    };
    toolbar.style.setProperty("--zr-bm-duration", (motion.matches ? 0 : settings.duration) + "ms");
    if(!settings.enabled){clear(true);toolbar.removeAttribute("data-zr-magnetic-enabled");releaseContour();}
    else{
      toolbar.toggleAttribute("data-zr-magnetic-enabled",true);
      updateReserve();scheduleContour();
    }
    indicator.toggleAttribute("data-zr-no-glow", !settings.glow);
    if(settings.enabled && active) {
      const saved = pointerX;
      const item = active;
      clear(true);
      updateReserve();updateContour();
      select(item, saved);
    }
  }

  function eligible(node) {
    return node?.parentElement === list &&
      node.matches("toolbarbutton.bookmark-item") &&
      !node.hidden && !node.collapsed && window.getComputedStyle(node).visibility === "visible";
  }

  function candidates() {
    return Array.from(list.children).filter(eligible);
  }

  function toolbarVisible() {
    if (addressSuspended || root.hasAttribute("data-op-bookmark-wave") ||
      !settings.enabled || toolbar.collapsed || toolbar.hidden ||
      root.hasAttribute("customizing") || root.hasAttribute("inDOMFullscreen") ||
      dragging) return false;
    const rect = toolbar.getBoundingClientRect();
    return rect.width > 0 && rect.height > 2;
  }

  function measure(item){
    const prior=state.get(item);if(prior)return prior;
    const style=window.getComputedStyle(item),r=item.getBoundingClientRect();
    return {width:r.width,height:r.height,start:parseFloat(style.marginInlineStart)||0,end:parseFloat(style.marginInlineEnd)||0};
  }
  function visibleRow(){
    return Array.from(list.children).filter(node=>{
      if(node.hidden||node.collapsed)return false;
      const cs=window.getComputedStyle(node);
      return cs.visibility==="visible"&&cs.display!=="none";
    });
  }
  function availableGrowth(){
    const bounds=list.getBoundingClientRect(),visible=visibleRow();
    if(!visible.length||bounds.width<=0)return 0;
    const gap=parseFloat(window.getComputedStyle(list).columnGap)||0;
    let occupied=Math.max(0,visible.length-1)*gap;
    for(const node of visible){const m=measure(node);occupied+=m.width+m.start+m.end;}
    return Math.max(0,bounds.width-occupied-8);
  }
  function box(r){return {left:r.left,top:r.top,width:r.width,height:r.height,right:r.right,bottom:r.bottom};}
  function local(r,t){return {left:r.left-t.left-toolbar.clientLeft,top:r.top-t.top-toolbar.clientTop,width:r.width,height:r.height};}
  function pixelRatio(){const n=Number(window.devicePixelRatio);return Number.isFinite(n)&&n>0?n:1;}
  function snapOffset(n){const d=pixelRatio();return Math.round(n*d)/d;}
  function snapGrowth(n){const d=pixelRatio();return Math.max(0,Math.floor(n*d/2+1e-7)*2/d);}
  // Native content is independent of the decorative card. Freeze the
  // button's outer box and position its real XUL image/label absolutely
  // inside it. Only these two children change their native dimensions.
  const contentProperties=["left","top","width","height","paddingTop","paddingRight","paddingBottom","paddingLeft","fontSize","lineHeight"];
  const contentVar=k=>"--zr-bm-content-"+k.replace(/[A-Z]/g,c=>"-"+c.toLowerCase());
  // Registered length variables interpolate even when the actual geometry
  // must be !important to win against the native theme. Registration is
  // per document; an existing registration survives Sine hot reload.
  let registeredContent=true;
  for(const k of contentProperties){
    try{window.CSS.registerProperty({name:contentVar(k),syntax:"<length>",inherits:false,initialValue:"0px"});}
    catch(e){if(e.name!=="InvalidModificationError")registeredContent=false;}
  }
  const textCanvas=document.createElementNS("http://www.w3.org/1999/xhtml","canvas");
  const textContext=textCanvas.getContext("2d");
  const contentOriginals=new WeakMap();
  function numeric(v,fallback=0){const n=parseFloat(v);return Number.isFinite(n)?n:fallback;}
  function measureLabel(ch,st,g,node){
    const label=ch.getAttribute("value")||ch.textContent?.trim()||"";
    const title=label||node.getAttribute("label")||"";
    if(!title||!textContext)return null;
    try{
      textContext.font=st.font&&st.font!==""?st.font:[st.fontStyle||"normal",st.fontWeight||"400",g.fontSize+"px",st.fontFamily||"sans-serif"].join(" ");
      if("letterSpacing" in textContext)textContext.letterSpacing=st.letterSpacing==="normal"?"0px":st.letterSpacing;
      const textWidth=textContext.measureText(title).width;
      const extras=g.paddingLeft+g.paddingRight+numeric(st.borderLeftWidth)+numeric(st.borderRightWidth);
      return {textWidth,extras,complete:textWidth+extras<=g.width+2,rtl:st.direction==="rtl"};
    }catch{return null;}
  }
  function readContent(node,r){
    const result=new Map(),borderX=node.clientLeft||0,borderY=node.clientTop||0;
    for(const ch of node.querySelectorAll(":scope > .toolbarbutton-icon, :scope > .toolbarbutton-text")){
      const st=window.getComputedStyle(ch),b=ch.getBoundingClientRect();
      if(st.display==="none"||st.visibility!=="visible"||b.width<=0||b.height<=0)continue;
      const text=ch.classList.contains("toolbarbutton-text");
      const g={left:b.left-r.left-borderX,top:b.top-r.top-borderY,width:b.width,height:b.height,
        paddingTop:numeric(st.paddingTop),paddingRight:numeric(st.paddingRight),paddingBottom:numeric(st.paddingBottom),paddingLeft:numeric(st.paddingLeft)};
      if(text){
        g.fontSize=numeric(st.fontSize,12);
        // A registered length cannot use "normal"; read a concrete line
        // height only when the native style supplies one. Otherwise keep
        // its original normal line-height declaration out of the effect.
        if(st.lineHeight!=="normal"&&Number.isFinite(parseFloat(st.lineHeight)))g.lineHeight=parseFloat(st.lineHeight);
        g.labelMetrics=measureLabel(ch,st,g,node);
      }
      result.set(ch,g);
    }
    return result;
  }
  function contentTarget(g,r,card){
    // Match preview.5's uniform content enlargement rather than stretching
    // letters horizontally. Move the entire content group with the new
    // card center, keeping its original icon/label spacing proportional.
    const k=Math.min(1.18,card.sx,card.sy),dy=r.height*(card.sy-1)/2;
    const cx=r.width/2-(r.borderX||0),cy=r.height/2-(r.borderY||0);
    const out={left:snapOffset(cx+(g.left-cx)*k),top:snapOffset(cy+(g.top-cy)*k+dy),
      width:g.width*k,height:g.height*k,
      paddingTop:g.paddingTop*k,paddingRight:g.paddingRight*k,paddingBottom:g.paddingBottom*k,paddingLeft:g.paddingLeft*k};
    if(g.fontSize!==undefined){
      out.fontSize=g.fontSize*k;
      // XUL label[crop=end] can introduce ellipses for a fractional shortfall.
      // Preserve natural truncation for already-long labels, but give a
      // previously complete label a small glyph-metrics safety margin.
      if(g.labelMetrics?.complete){
        const needed=(g.labelMetrics.textWidth+g.labelMetrics.extras)*k+3/pixelRatio();
        const right=r.width*(1+card.sx)/2-(r.borderX||0);
        const left=r.width*(1-card.sx)/2-(r.borderX||0);
        const extra=Math.max(0,Math.ceil(needed*pixelRatio())/pixelRatio()-out.width);
        if(g.labelMetrics.rtl){const add=Math.min(extra,Math.max(0,out.left-left));out.left-=add;out.width+=add;}
        else out.width+=Math.min(extra,Math.max(0,right-out.left-out.width));
      }
    }
    if(g.lineHeight!==undefined)out.lineHeight=g.lineHeight*k;
    return out;
  }
  function unlockContent(node){
    const children=contentLocks.get(node);if(!children)return;
    for(const ch of children){
      ch.removeAttribute("data-zr-bm-content");
      for(const k of contentProperties)ch.style.removeProperty(contentVar(k));
      const saved=contentOriginals.get(ch);
      if(saved){
        for(const [name,old] of saved){if(old.value)ch.style.setProperty(name,old.value,old.priority);else ch.style.removeProperty(name);}
        contentOriginals.delete(ch);
      }
    }
    node.removeAttribute("data-zr-bm-content-lock");
    node.style.removeProperty("--zr-bm-lock-width");node.style.removeProperty("--zr-bm-lock-height");
    contentLocks.delete(node);
  }
  function cssName(k){return k.replace(/[A-Z]/g,c=>"-"+c.toLowerCase());}
  function contentFrame(g){
    return Object.fromEntries(contentProperties.filter(k=>g[k]!==undefined).map(k=>[contentVar(k),g[k]+"px"]));
  }
  function lockContent(node,r,base,previous,card,duration){
    if(!base?.size)return;
    const children=new Set(base.keys());contentLocks.set(node,children);
    // The outer dimensions are constant through grow AND shrink.
    node.style.setProperty("--zr-bm-lock-width",r.width+"px");
    node.style.setProperty("--zr-bm-lock-height",r.height+"px");
    node.setAttribute("data-zr-bm-content-lock","true");
    for(const [ch,g] of base){
      const previousGeometry=previous?.get(ch)||g,to=card.opacity===0?g:contentTarget(g,r,card);
      // Apply the same metrics from first animation frame through rest.
      // At natural size use a small extra width only for labels known to
      // be complete, preventing a temporary ellipsis while unlocking.
      const from={...previousGeometry},end={...to};
      if(g.labelMetrics?.complete){
        const needed=(g.labelMetrics.textWidth+g.labelMetrics.extras)*((from.fontSize||g.fontSize)/g.fontSize)+2/pixelRatio();
        from.width=Math.max(from.width,needed);
        if(card.opacity===0)end.width=Math.max(end.width,g.labelMetrics.textWidth+g.labelMetrics.extras+2/pixelRatio());
      }
      const saved=new Map();contentOriginals.set(ch,saved);
      for(const k of contentProperties){
        if(end[k]===undefined)continue;
        const name=cssName(k);
        saved.set(name,{value:ch.style.getPropertyValue(name),priority:ch.style.getPropertyPriority(name)});
        ch.style.setProperty(contentVar(k),end[k]+"px");
        // Lock the actual property to our interpolated variable. Important
        // theme widths can no longer take over when WAAPI is canceled.
        ch.style.setProperty(name,"var("+contentVar(k)+")","important");
      }
      ch.setAttribute("data-zr-bm-content","true");
      // Actual font-size / box dimensions; never transform text or icons.
      // The lock keeps these changes out of the surrounding flex layout.
      if(!duration||!registeredContent||!contentProperties.some(k=>Math.abs((from[k]??end[k]??0)-(end[k]??from[k]??0))>.01))continue;
      try{
        const a=ch.animate([contentFrame(from),contentFrame(end)],{duration,easing:FLIP_EASE,fill:"both"});
        watchAnimation(ch,a,()=>{});
      }catch{}
    }
  }
  function removeCard(node){
    unlockContent(node);
    node.removeAttribute("data-zr-bm-card");
    for(const k of ["--zr-bm-card-x","--zr-bm-card-y","--zr-bm-card-opacity"])node.style.removeProperty(k);
    cards.delete(node);
  }
  function stopFlips(){
    flipEpoch++;
    if(flipTimer)window.clearTimeout(flipTimer);flipTimer=0;
    for(const a of flips.values())try{a.cancel();}catch{}
    flips.clear();
    for(const n of flipNodes)n.removeAttribute("data-zr-bm-flip");
    flipNodes.clear();
  }
  function resetActive(){
    for(const item of state.keys()){
      item.removeAttribute("data-zr-bm-active");
      item.removeAttribute("data-zr-bm-managed");
      for(const k of ["--zr-bm-margin-start","--zr-bm-margin-end","--zr-bm-grow"])item.style.removeProperty(k);
    }
    state.clear();
    for(const n of [...cards.keys()])removeCard(n);
  }
  function setActive(item,m,grow){
    const sx=1+grow/Math.max(1,m.width),sy=desiredY();
    state.set(item,{...m,sx,sy,grow});
    item.style.setProperty("--zr-bm-margin-start",m.start+"px");
    item.style.setProperty("--zr-bm-margin-end",m.end+"px");
    item.style.setProperty("--zr-bm-grow",grow/2+"px");
    item.setAttribute("data-zr-bm-managed","true");
    item.setAttribute("data-zr-bm-active","true");
    return {sx,sy,opacity:1};
  }
  const restingCard={sx:1,sy:1,opacity:0};
  function cardSample(node){
    const p=cards.get(node);if(!p)return restingCard;
    // Read actual progress on retarget, not on every frame. Native text
    // is never transformed; its real dimensions animate independently.
    let t=p.animation&&p.animation.playState!=="finished"?0:1;
    try{const progress=p.animation?.effect?.getComputedTiming().progress;
      if(typeof progress==="number")t=clamp(progress,0,1);
    }catch{}
    const a=p.from,b=p.to;
    return {sx:a.sx+(b.sx-a.sx)*t,sy:a.sy+(b.sy-a.sy)*t,opacity:a.opacity+(b.opacity-a.opacity)*t};
  }
  function watchAnimation(key,a,done){
    flips.set(key,a);const epoch=flipEpoch;
    a.finished?.then(()=>{
      if(epoch!==flipEpoch||flips.get(key)!==a)return;
      flips.delete(key);
      try{a.cancel();}catch{}
      done?.();
      if(!flips.size)endFlip(epoch);
    },()=>{});
  }
  function moveFrames(dx,dy){
    // Quantize *every* offset, not just the endpoints. Relative positioning
    // moves the native frame without a transform picture-cache surface.
    // At rest the offset is exactly zero (no retained animation).
    const d=pixelRatio(),x=Math.round(dx*d),y=Math.round(dy*d),steps=Math.min(240,Math.max(Math.abs(x),Math.abs(y)));
    if(!steps)return [];
    const frames=[];
    for(let i=0;i<=steps;i++){
      const t=i/steps,left=Math.round(x*(1-t))/d,top=Math.round(y*(1-t))/d;
      frames.push({offset:t,left:left+"px",top:top+"px",easing:"steps(1,end)"});
    }
    return frames;
  }
  function moveNative(node,dx,dy,duration){
    if(!duration)return;
    const frames=moveFrames(dx,dy);if(!frames.length)return;
    node.setAttribute("data-zr-bm-flip","true");flipNodes.add(node);
    try{
      const a=node.animate(frames,{duration,easing:FLIP_EASE,fill:"both"});
      watchAnimation(node,a,()=>{flipNodes.delete(node);node.removeAttribute("data-zr-bm-flip");});
    }catch{flipNodes.delete(node);node.removeAttribute("data-zr-bm-flip");}
  }
  function animateCard(node,from,to,duration){
    if(!duration&&to.opacity===0)return;
    node.setAttribute("data-zr-bm-card","true");
    node.style.setProperty("--zr-bm-card-x",String(to.sx));
    node.style.setProperty("--zr-bm-card-y",String(to.sy));
    node.style.setProperty("--zr-bm-card-opacity",String(to.opacity));
    const record={from,to,animation:null};cards.set(node,record);
    if(!duration||Math.abs(from.sx-to.sx)+Math.abs(from.sy-to.sy)+Math.abs(from.opacity-to.opacity)<.0001){
      if(to.opacity===0&&!duration)removeCard(node);return;
    }
    try{
      const frame=p=>({transform:"scale("+p.sx+","+p.sy+")",opacity:p.opacity});
      // Target only the empty decorative pseudo-element, never the native
      // XUL toolbarbutton or its label/icon. Gecko supports pseudoElement.
      const effect=new window.KeyframeEffect(node,[frame(from),frame(to)],{duration,easing:FLIP_EASE,fill:"both",pseudoElement:"::before"});
      if(effect.pseudoElement!=="::before")throw Error("pseudo-element animation unavailable");
      const a=new window.Animation(effect,document.timeline);
      record.animation=a;a.play();
      watchAnimation(record,a,()=>{
        if(cards.get(node)!==record)return;
        record.animation=null;
        // endFlip removes the outgoing card after all child effects finish.
      });
    }catch{
      // Static decorative end state is safe; no fallback scales a label.
      record.animation=null;
    }
  }
  function endFlip(epoch){
    if(epoch!==flipEpoch)return;
    stopFlips();
    for(const [n,p] of [...cards]){p.animation=null;if(p.to.opacity===0)removeCard(n);}
    if(!active){motionPlan=null;toolbar.removeAttribute("data-zr-bm-room");scheduleContour();}
  }
  function retarget(){
    const nodes=visibleRow(),first=new Map(),oldCards=new Map(),previousContent=new Map(),baseContent=new Map();
    const firstToolbar=box(toolbar.getBoundingClientRect());
    // FIRST: native rects contain only layout coordinates (left/top);
    // the decorative card scales are independent of the native rect.
    for(const n of nodes){
      const r=box(n.getBoundingClientRect());if(r.width>0&&r.height>0)first.set(n,r);
      if(cards.has(n)){
        oldCards.set(n,cardSample(n));
        if(contentLocks.has(n))previousContent.set(n,readContent(n,r));
      }
    }
    stopFlips();resetActive();
    const natural=new Map(),bounds=list.getBoundingClientRect(),gap=parseFloat(window.getComputedStyle(list).columnGap)||0;
    let occupied=Math.max(0,nodes.length-1)*gap;
    for(const n of nodes){
      const r=box(n.getBoundingClientRect()),style=window.getComputedStyle(n);
      const m={width:r.width,height:r.height,start:parseFloat(style.marginInlineStart)||0,end:parseFloat(style.marginInlineEnd)||0};
      natural.set(n,m);occupied+=m.width+m.start+m.end;
    }
    const budget=Math.max(0,bounds.width-occupied-12),m=natural.get(active);
    if(active&&(!m||m.width<=0||m.height<=0)){active=null;motionPlan=null;toolbar.removeAttribute("data-zr-bm-room");scheduleContour();return false;}
    // Commit one final horizontal slot. Native button dimensions remain
    // fixed, so OnePlane's ResizeObserver does not see animated resizing.
    toolbar.setAttribute("data-zr-bm-room","true");
    const target=active?setActive(active,m,snapGrowth(Math.min(m.width*(settings.scale-1),budget))):null;
    const lastToolbar=box(toolbar.getBoundingClientRect()),last=new Map();
    for(const n of nodes){const r=box(n.getBoundingClientRect());if(r.width>0&&r.height>0)last.set(n,r);}
    // Read native children before any per-card writes, avoiding read/write
    // interleaving and preserving the exact resting XUL metrics.
    for(const [n,b] of last)if(n===active||oldCards.has(n)){
      b.borderX=n.clientLeft||0;b.borderY=n.clientTop||0;
      baseContent.set(n,readContent(n,b));
    }
    const duration=motion.matches?0:settings.duration,start=window.performance.now();
    motionPlan=null;
    for(const [n,b] of last){
      const a=first.get(n)||b,dx=a.left-b.left,dy=a.top-b.top;
      moveNative(n,dx,dy,duration);
      const isActive=n===active,from=oldCards.get(n)||restingCard,to=isActive?target:restingCard;
      if(isActive||oldCards.has(n)){
        animateCard(n,from,to,duration);
        if(cards.has(n))lockContent(n,b,baseContent.get(n),previousContent.get(n),to,duration);
      }
      if(isActive){
        const f=local(a,firstToolbar),l=local(b,lastToolbar);
        motionPlan={start,duration,from:{left:f.left+a.width*(1-from.sx)/2,top:f.top,width:a.width*from.sx,height:a.height*from.sy},
          to:{left:l.left+b.width*(1-to.sx)/2,top:l.top,width:b.width*to.sx,height:b.height*to.sy},
          originX:lastToolbar.left+toolbar.clientLeft,height:lastToolbar.height};
      }
    }
    if(flips.size){const epoch=flipEpoch;flipTimer=window.setTimeout(()=>endFlip(epoch),duration+250);}
    else endFlip(flipEpoch);
    return !!active;
  }
  function destination(now=window.performance.now()){
    const p=motionPlan;if(!active||!p)return null;
    const t=p.duration?clamp((now-p.start)/p.duration,0,1):1,e=t*t*(3-2*t);
    const a=p.from,b=p.to;
    const x=a.left+(b.left-a.left)*e,width=a.width+(b.width-a.width)*e;
    const y=a.top+(b.top-a.top)*e,height=a.height+(b.height-a.height)*e;
    const center=x+width/2;
    const bias=pointerX===null?0:clamp((pointerX-p.originX-center)/Math.max(1,width/2),-1,1);
    return {x:center+bias*Math.min(12,width*.12),y:clamp(y+height+5,3,Math.max(3,p.height-3)),w:clamp(width*.14,12,18)};
  }

  function paint() {
    const tail = clamp(vx * .0035, -5, 5);
    // Fixed 14x3 element; only transform is animated (no layout writes).
    const value="translate3d("+(cx-w/2-tail).toFixed(2)+"px,"+(cy-h/2).toFixed(2)+"px,0) scale("+(w/14).toFixed(5)+","+(h/3).toFixed(5)+")";
    if(value!==lastIndicatorTransform){lastIndicatorTransform=value;indicator.style.transform=value;}
  }

  function animate(now) {
    raf = 0;
    if(dead||!active||!settings.indicator||!settings.enabled||toolbar.hidden||toolbar.collapsed)return;
    const p=destination(now);
    if (!p) { clear(); return; }
    const dt = last ? clamp((now - last) / 1000, 0.001, .05) : 1 / 60;
    last = now;
    if (motion.matches) {
      cx = p.x; cy = p.y; vx = 0; w = p.w; h = 3;
    } else {
      // Integrate in bounded steps, so a delayed frame cannot destabilize
      // the spring. Stretch is velocity-driven and relaxes at rest.
      const steps = Math.max(1, Math.ceil(dt * 120));
      const step = dt / steps;
      for (let i = 0; i < steps; i++) {
        vx += (p.x - cx) * 350 * step;
        vx *= Math.exp(-23 * step);
        cx += vx * step;
      }
      const stretch = Math.min(18, Math.abs(vx) * .025);
      const blend = 1 - Math.exp(-24 * dt);
      w += (p.w + stretch - w) * blend;
      h += (3 - stretch * .035 - h) * blend;
      cy += (p.y - cy) * (1 - Math.exp(-30 * dt));
    }
    paint();
    if (!motion.matches && (now < until || Math.abs(cx - p.x) > .08 ||
        Math.abs(cy - p.y) > .08 || Math.abs(vx) > .2 ||
        Math.abs(w - p.w) > .08 || Math.abs(h - 3) > .04)) {
      raf = window.requestAnimationFrame(animate);
    }
  }

  function schedule() {
    if (!settings.indicator || !active || dead) return;
    until = window.performance.now() + settings.duration + 140;
    if (!raf) { last = 0; raf = window.requestAnimationFrame(animate); }
  }

  function cancelPendingLeave() {
    if (leaveTimer) window.clearTimeout(leaveTimer);
    leaveTimer = 0;
  }

  function queueLeave() {
    if (!active || leaveTimer) return;
    leaveTimer = window.setTimeout(() => {
      leaveTimer = 0;
      clear();
    }, GAP_GRACE_MS);
  }

  function select(item, x = null) {
    if (!toolbarVisible() || !eligible(item)) return;
    cancelPendingLeave();
    pointerX = x;
    if (active === item) { schedule(); return; }
    if(!busy()&&!contourKey)updateContour();
    active=item;
    if(!retarget()){clear(true);return;}
    if (settings.indicator) {
      if (!shown) {
        const p = destination();
        if (p) { cx = p.x; cy = p.y; w = p.w; h = 3; vx = 0; paint(); }
      }
      shown = true;
      indicator.setAttribute("data-zr-visible", "true");
      schedule();
    }
  }

  function clear(immediately = false) {
    pendingPointer=null;if(pointerFrame)window.cancelAnimationFrame(pointerFrame);pointerFrame=0;
    cancelPendingLeave();
    const previous = active;
    active = null; pointerX = null; shown = false;
    indicator.removeAttribute("data-zr-visible");
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0; last = 0; vx = 0;
    if(immediately){stopFlips();resetActive();motionPlan=null;toolbar.removeAttribute("data-zr-bm-room");scheduleContour();}
    else if(previous||state.size)retarget();
  }

  function onPointerMove(event){
    if(event.pointerType==="touch")return;
    if(addressSuspended||root.hasAttribute("data-op-bookmark-wave")){
      addressPointer={x:event.clientX,y:event.clientY};return;
    }
    if(addressPointer===null&&lastPointer&&!active&&event.clientX===lastPointer.x&&event.clientY===lastPointer.y)return;
    if(event.buttons||openPopups.size||!settings.enabled||dragging||root.hasAttribute("data-zr-startup-phase"))return;
    const item=event.target?.closest?.("toolbarbutton.bookmark-item");
    const moved=!lastPointer||event.clientX!==lastPointer.x||event.clientY!==lastPointer.y;
    lastPointer={x:event.clientX,y:event.clientY};
    if(!moved&&active&&item!==active)return;
    if(item===active&&active){
      pendingPointer=null;if(pointerFrame)window.cancelAnimationFrame(pointerFrame);pointerFrame=0;
      cancelPendingLeave();if(pointerX!==event.clientX){pointerX=event.clientX;schedule();}return;
    }
    pendingPointer={target:event.target,clientX:event.clientX,clientY:event.clientY};
    if(!pointerFrame)pointerFrame=window.requestAnimationFrame(()=>{
      pointerFrame=0;const p=pendingPointer;pendingPointer=null;
      if(p&&!dead&&!openPopups.size)processPointer(p);
    });
  }
  function processPointer(event){
    if(!toolbarVisible())return;
    // Handle the actual native hit target. Do not synthesize clicks or
    // react to pointerenter events generated solely by animated layout.
    const item = event.target?.closest?.("toolbarbutton.bookmark-item");
    if (eligible(item)) { select(item, event.clientX); return; }
    // Keep the active bookmark while the pointer is still within its
    // original row slot and downward-expanded artwork.
    if (active && eligible(active)) {
      const native=active.getBoundingClientRect(),c=cardSample(active);
      const r={left:native.left-native.width*(c.sx-1)/2,right:native.right+native.width*(c.sx-1)/2,top:native.top,bottom:native.top+native.height*c.sy};
      const t = toolbar.getBoundingClientRect();
      if (event.clientX >= r.left - 2 && event.clientX <= r.right + 2 &&
          event.clientY >= Math.min(r.top, t.top) && event.clientY <= t.bottom) {
        cancelPendingLeave();
        pointerX = event.clientX;
        schedule();
        return;
      }
    }
    // A gap is not a departure. Expansion/lift creates transient empty
    // hit-test regions between native buttons. Keep the current spring
    // position and velocity across these regions so the next select()
    // retargets an existing drop rather than creating a new one.
    const visible = candidates();
    if (active && visible.length) {
      const rects = visible.map(node => node.getBoundingClientRect());
      const left = Math.min(...rects.map(r => r.left));
      const right = Math.max(...rects.map(r => r.right));
      const top = Math.min(...rects.map(r => r.top));
      const bottom = Math.max(...rects.map(r => r.bottom));
      const t = toolbar.getBoundingClientRect();
      if (event.clientX >= left - 4 && event.clientX <= right + 4 &&
          event.clientY >= Math.min(top, t.top) - 3 &&
          event.clientY <= Math.max(bottom, t.bottom) + 3) {
        cancelPendingLeave();
        // Leave the old target in place until the next real bookmark hit.
        // This prevents layout-generated hover oscillation.
        return;
      }
    }
    queueLeave();
  }

  function onPointerLeave(event) {
    lastPointer=null;pendingPointer=null;if(pointerFrame)window.cancelAnimationFrame(pointerFrame);pointerFrame=0;
    if (openPopups.size) return;
    if (event?.type === "pointerleave") queueLeave();
    else clear(true);
  }
  function onFocus(event) {
    if(addressSuspended||root.hasAttribute("data-op-bookmark-wave")||root.hasAttribute("data-zr-startup-phase"))return;
    const item = event.target?.closest?.("toolbarbutton.bookmark-item");
    if (eligible(item) && item.matches(":focus-visible")) select(item, null);
  }
  function onFocusOut(event) {
    if (!openPopups.size && event.relatedTarget && !toolbar.contains(event.relatedTarget) && !toolbar.matches(":hover")) queueLeave();
  }
  function onDragStart() { dragging = true; clear(true); }
  function onDragEnd() { dragging = false; }
  function onPopupShowing(event) {
    pendingPointer=null;if(pointerFrame)window.cancelAnimationFrame(pointerFrame);pointerFrame=0;
    cancelPendingLeave();
    openPopups.add(event.target);
    // Freeze the native folder anchor during opening; collapse after close.
    if(flipTimer)window.clearTimeout(flipTimer);flipTimer=0;
    for(const a of flips.values())try{a.pause();}catch{}
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    indicator.removeAttribute("data-zr-visible");
    shown = false;
  }
  function onPopupHidden(event) {
    openPopups.delete(event.target);
    if (!openPopups.size) clear(true);
  }
  function onKey(event) { if (event.key === "Escape") clear(); }

  const observer = new MutationObserver(() => {
    if (dead) return;
    syncAddressState();
    if(addressSuspended)return;
    if(active&&(!eligible(active)||!toolbarVisible())||[...flipNodes,...cards.keys()].some(n=>n.parentElement!==list))clear(true);
    if(!busy()){updateReserve();scheduleContour();}
  });
  const resize = new ResizeObserver(() => {
    if(addressSuspended)return;
    const next = toolbar.getBoundingClientRect().width;
    if(Math.abs(next-toolbarWidth)>2){toolbarWidth=next;clear(true);}
    if(!busy()){updateReserve();scheduleContour();}
  });
  const contourObserver=()=>scheduleContour();
  const panelObserver=new MutationObserver(()=>{if(!busy())scheduleContour();});
  const prefsObserver = () => {
    if (!refreshFrame) refreshFrame = window.requestAnimationFrame(() => {
      refreshFrame = 0;
      if (!dead) readSettings();
    });
  };
  const listeners = [
    [toolbar, "pointermove", onPointerMove, true],
    [toolbar, "pointerleave", onPointerLeave, false],
    [toolbar, "focusin", onFocus, true],
    [toolbar, "focusout", onFocusOut, true],
    [toolbar, "dragstart", onDragStart, true],
    [window, "dragend", onDragEnd, true],
    [window, "drop", onDragEnd, true],
    [toolbar, "popupshowing", onPopupShowing, true],
    [toolbar, "popuphidden", onPopupHidden, true],
    [window, "deactivate", onPointerLeave, false],
    [window, "keydown", onKey, true],
    [window, "beforecustomization", onPointerLeave, false],
    [window,"resize",scheduleContour,false]
  ];
  function destroy() {
    if (dead) return;
    dead = true;
    clear(true);
    if(refreshFrame)window.cancelAnimationFrame(refreshFrame);
    if(pointerFrame)window.cancelAnimationFrame(pointerFrame);pendingPointer=null;
    observer.disconnect();resize.disconnect();panelObserver.disconnect();
    if(contourFrame)window.cancelAnimationFrame(contourFrame);
    releaseContour();try{prefs.removeObserver(contourPrefix,contourObserver);}catch{}
    openPopups.clear();
    for (const [target, type, listener, capture] of listeners) target.removeEventListener(type, listener, capture);
    try { prefs.removeObserver(PREFIX, prefsObserver); } catch {}
    motion.removeEventListener("change", prefsObserver);
    toolbar.removeAttribute("data-zr-magnetic-enabled");
    toolbar.style.removeProperty("--zr-bm-duration");
    toolbar.style.removeProperty("--zr-bm-base-height");
    toolbar.style.removeProperty("--zr-bm-base-pad-bottom");
    toolbar.style.removeProperty("--zr-bm-reserve");
    indicator.remove();
  }
  try {
    toolbar.append(indicator);
    toolbarWidth = toolbar.getBoundingClientRect().width;
    readSettings();
    for (const [target, type, listener, capture] of listeners) target.addEventListener(type, listener, capture);
    observer.observe(list,{childList:true,subtree:true,attributes:true,attributeFilter:["hidden","collapsed","label","overflowed"]});
    observer.observe(toolbar, { attributes: true, attributeFilter: ["hidden", "collapsed"] });
    observer.observe(root,{attributes:true,attributeFilter:["customizing","inDOMFullscreen","oneplane-active","zen-compact-mode","data-op-bookmark-wave"]});
    syncAddressState();
    if(wrapper)panelObserver.observe(wrapper,{childList:true,subtree:false,attributes:true,attributeFilter:["data-op-panel-open"]});
    resize.observe(toolbar);
    if(navbar)resize.observe(navbar);
    prefs.addObserver(PREFIX,prefsObserver);
    prefs.addObserver(contourPrefix,contourObserver);
    motion.addEventListener("change", prefsObserver);
  } catch (error) {
    destroy();
    throw error;
  }
  return {destroy,syncAddressState};
}

// One shared native controller per browser window, regardless of which
// Sine mod registered it first. Identical standalone copies register
// independent leases. Legacy scripts yield the controller safely.
function createSharedRegistry(){
  const clients=new Set();
  let controller=null,scheduled=false;
  const registry={revision:REVISION,clients,
    syncAddressState(){controller?.syncAddressState();},
    acquire(token){clients.add(token);ensure();},
    release(token){
      clients.delete(token);
      if(clients.size)return;
      stop();
      if(window[SHARED]===registry)delete window[SHARED];
    }};
  function stop(){
    controller?.destroy();controller=null;
    if(window[CONTROLLER]===legacyLease)delete window[CONTROLLER];
  }
  function legacyLease(){
    // An older Refined copy may call this before registering itself.
    // Yield synchronously, then reclaim after its synchronous startup
    // has returned. Never run two installed controllers at once.
    stop();
    if(!clients.size||scheduled)return;
    scheduled=true;
    window.queueMicrotask(()=>{scheduled=false;if(clients.size)ensure();});
  }
  function ensure(){
    if(!clients.size||window.closed)return;
    if(controller&&window[CONTROLLER]===legacyLease)return;
    if(controller)stop();
    const legacy=window[CONTROLLER];
    if(typeof legacy==="function"&&legacy!==legacyLease)legacy();
    window[CONTROLLER]=legacyLease;
    try{controller=install();}
    catch(error){stop();throw error;}
    if(!controller&&window[CONTROLLER]===legacyLease)delete window[CONTROLLER];
  }
  return registry;
}
const lease={};
let shared=null;

function cleanup() {
  if (disposed) return;
  disposed = true;
  if (startupObserver) {
    Services.obs.removeObserver(startupObserver, "browser-delayed-startup-finished");
    startupObserver = null;
  }
  shared?.release(lease);
  shared=null;
  window.removeEventListener("unload", cleanup);
}

function start() {
  if (disposed || window.closed) return;
  try {
    shared=window[SHARED]??(window[SHARED]=createSharedRegistry());
    shared.acquire(lease);
  }
  catch (error) { console.error("[Zen Refined] Magnetic Bookmarks:", error); cleanup(); }
}

if (!root.hasAttribute("popup-window") && typeof window.addUnloadListener === "function") {
  window.addUnloadListener(cleanup);
  window.addEventListener("unload", cleanup, { once: true });
  if (window.gBrowserInit?.delayedStartupFinished) start();
  else {
    startupObserver = subject => {
      if (subject !== window) return;
      Services.obs.removeObserver(startupObserver, "browser-delayed-startup-finished");
      startupObserver = null;
      start();
    };
    Services.obs.addObserver(startupObserver, "browser-delayed-startup-finished");
  }
}
