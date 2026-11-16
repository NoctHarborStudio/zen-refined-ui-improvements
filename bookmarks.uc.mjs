/* Zen Refined — Magnetic Bookmarks
 * Native bookmarks only. No page content, network requests or browser preference
 * changes. Reads its own settings and OnePlane's contour preferences.
 */
const PREFIX = "zen.refined.bookmarks.";
const CONTROLLER = "__zenRefinedMagneticBookmarks";
const root = document.documentElement;
const prefs = Services.prefs;
let disposed = false;
let startupObserver = null;
let uninstall = null;

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
  const flips=new Map(), flipNodes=new Set(), scaledParents=new Set();
  let pointerFrame=0,pendingPointer=null,lastIndicatorTransform="",lastPointer=null;
  const FLIP_EASE="cubic-bezier(.333333,0,.666667,1)";
  let baseHeight=0,basePadding=0,reserve=0;
  const busy=()=>state.size>0||flips.size>0;
  const wrapper = document.getElementById("zen-appcontent-navbar-wrapper");
  const contourPrefix = "zen.oneplane.fade-";
  const GAP_GRACE_MS = 180;
  let settings = {};

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
    if(dead)return;
    const surface=document.getElementById("oneplane-toolbar-surface"),row=document.getElementById("oneplane-tabs");
    if(!settings.enabled||!settings.stableBackground||!root.hasAttribute("oneplane-active")||
      root.getAttribute("zen-compact-mode")!=="true"||window.innerWidth<900||
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
    if (!settings.enabled || toolbar.collapsed || toolbar.hidden ||
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
  function innerNodes(item){return Array.from(item.querySelectorAll?.(".toolbarbutton-icon, .toolbarbutton-text")||[]);}
  function stopFlips(){
    flipEpoch++;
    if(flipTimer)window.clearTimeout(flipTimer);flipTimer=0;
    for(const a of flips.values())try{a.cancel();}catch{}
    flips.clear();
    for(const n of flipNodes)n.removeAttribute("data-zr-bm-flip");
    flipNodes.clear();scaledParents.clear();
  }
  function resetActive(){
    for(const item of state.keys()){
      item.removeAttribute("data-zr-bm-active");
      item.removeAttribute("data-zr-bm-managed");
      for(const k of ["--zr-bm-margin-start","--zr-bm-margin-end","--zr-bm-grow","--zr-bm-scale-x","--zr-bm-scale-y","--zr-bm-inner-x","--zr-bm-inner-y"])item.style.removeProperty(k);
    }
    state.clear();
  }
  function setActive(item,m,grow){
    const sx=1+grow/Math.max(1,m.width),sy=desiredY(),inner=Math.min(1.18,sx,sy);
    state.set(item,{...m,sx,sy,grow});
    item.style.setProperty("--zr-bm-margin-start",m.start+"px");
    item.style.setProperty("--zr-bm-margin-end",m.end+"px");
    item.style.setProperty("--zr-bm-grow",grow/2+"px");
    // First commit the final slot but leave scale at identity until the
    // Last geometry has been read. No writes between geometry reads.
    item.setAttribute("data-zr-bm-managed","true");
    item.setAttribute("data-zr-bm-active","true");
    return {sx,sy,inner};
  }
  function transform(dx,dy,sx=1,sy=1){
    return "translate3d("+dx.toFixed(4)+"px,"+dy.toFixed(4)+"px,0) scale("+sx.toFixed(6)+","+sy.toFixed(6)+")";
  }
  function pixelRatio(){const n=Number(window.devicePixelRatio);return Number.isFinite(n)&&n>0?n:1;}
  function snapOffset(n){const d=pixelRatio();return Math.round(n*d)/d;}
  function snapGrowth(n){
    // Each margin is a whole device pixel. A centered row therefore moves
    // by a whole pixel too, where its native layout permits this.
    const d=pixelRatio();return Math.max(0,Math.floor(n*d/2+1e-7)*2/d);
  }
  function translation(dx,dy){
    const x=snapOffset(dx),y=snapOffset(dy);
    // Do not attach identity scaling or a 3D transform to ordinary labels.
    if(x===0&&y===0)return "none";
    return y===0?"translateX("+x+"px)":"translate("+x+"px,"+y+"px)";
  }
  function isIdentity(t){
    if(!t||t==="none")return true;
    const m=/^(matrix|matrix3d|scale)\(([^)]+)\)$/.exec(t.trim());if(!m)return false;
    const a=m[2].split(/[,\s]+/).filter(Boolean).map(Number);
    const identity=m[1]==="matrix"?[1,0,0,1,0,0]:m[1]==="matrix3d"?[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]:a.length===1?[1]:[1,1];
    return a.length===identity.length&&a.every((v,i)=>Number.isFinite(v)&&Math.abs(v-identity[i])<.00001);
  }
  function play(node,from,to,duration){
    if(!duration||from===to||(isIdentity(from)&&isIdentity(to)))return false;
    try{
      const a=node.animate([{transform:from},{transform:to}],{duration,easing:FLIP_EASE,fill:"both"});
      flips.set(node,a);
      const epoch=flipEpoch;
      // Remove the animation effect as soon as it actually finishes, not
      // one frame (or a fixed grace period) later. Resting text is native.
      a.finished?.then(()=>{
        if(epoch!==flipEpoch||flips.get(node)!==a)return;
        flips.delete(node);
        try{a.cancel();}catch{}
        if(flipNodes.delete(node))node.removeAttribute("data-zr-bm-flip");
        scaledParents.delete(node);
        if(!flips.size)endFlip(epoch);
      },()=>{});
      return true;
    }catch{return false;}
  }
  function endFlip(epoch){
    if(epoch!==flipEpoch)return;
    stopFlips();
    if(!active){motionPlan=null;toolbar.removeAttribute("data-zr-bm-room");scheduleContour();}
  }
  function retarget(){
    // FIRST: capture painted positions, including interrupted WAAPI motion.
    // No stylesheet or layout mutations in this read phase.
    const nodes=visibleRow(),first=new Map(),inners=new Map();
    const formerlyScaled=new Set([...state.keys(),...scaledParents]);
    const firstToolbar=box(toolbar.getBoundingClientRect());
    for(const n of nodes){
      const r=box(n.getBoundingClientRect());
      if(r.width>0&&r.height>0)first.set(n,r);
      // Capture child transforms only for a new/previous enlarged card.
      // Translation-only siblings must never get child identity animations.
      if(n===active||formerlyScaled.has(n))for(const ch of innerNodes(n)){
        const t=window.getComputedStyle(ch).transform;
        if(!isIdentity(t))inners.set(ch,t);
      }
    }
    // Reset the old slot and animation before reading resting metrics.
    stopFlips();resetActive();
    const natural=new Map();
    const bounds=list.getBoundingClientRect(),gap=parseFloat(window.getComputedStyle(list).columnGap)||0;
    let occupied=Math.max(0,nodes.length-1)*gap;
    for(const n of nodes){
      const r=box(n.getBoundingClientRect()),style=window.getComputedStyle(n);
      const m={width:r.width,height:r.height,start:parseFloat(style.marginInlineStart)||0,end:parseFloat(style.marginInlineEnd)||0};
      natural.set(n,m);occupied+=m.width+m.start+m.end;
    }
    const budget=Math.max(0,bounds.width-occupied-12),m=natural.get(active);
    if(active&&(!m||m.width<=0||m.height<=0)){active=null;motionPlan=null;toolbar.removeAttribute("data-zr-bm-room");scheduleContour();return false;}
    // LAST: commit the final layout once, independent of refresh rate.
    // The previous slot is already gone; two expanded slots cannot
    // temporarily overrun the native Places overflow budget.
    let target=null;
    if(active){toolbar.setAttribute("data-zr-bm-room","true");target=setActive(active,m,snapGrowth(Math.min(m.width*(settings.scale-1),budget)));}
    else toolbar.setAttribute("data-zr-bm-room","true");
    const lastToolbar=box(toolbar.getBoundingClientRect()),last=new Map();
    for(const n of nodes){const r=box(n.getBoundingClientRect());if(r.width>0&&r.height>0)last.set(n,r);}
    const duration=motion.matches?0:settings.duration,start=window.performance.now();
    motionPlan=null;
    // INVERT + PLAY: compositor-friendly transforms only, with a fixed
    // top edge. No JS callback edits margins or reads layout per frame.
    for(const [n,b] of last){
      const a=first.get(n)||b,tx=a.left+a.width/2-b.left-b.width/2,ty=a.top-b.top;
      const sx=a.width/Math.max(1,b.width),sy=a.height/Math.max(1,b.height);
      const isActive=n===active,ex=isActive?target.sx:1,ey=isActive?target.sy:1;
      if(isActive){
        n.style.setProperty("--zr-bm-scale-x",String(ex));n.style.setProperty("--zr-bm-scale-y",String(ey));
        n.style.setProperty("--zr-bm-inner-x",String(target.inner/ex));n.style.setProperty("--zr-bm-inner-y",String(target.inner/ey));
        const f=local(a,firstToolbar),l=local(b,lastToolbar);
        motionPlan={start,duration,from:f,to:{left:l.left+b.width*(1-ex)/2,top:l.top,width:b.width*ex,height:b.height*ey},
          originX:lastToolbar.left+toolbar.clientLeft,height:lastToolbar.height};
      }
      // Only the incoming enlarged card and cards still shrinking from a
      // previous enlargement may scale. All other siblings translate in 2D.
      const scaling=isActive||(formerlyScaled.has(n)&&(Math.abs(sx-1)*b.width+Math.abs(sy-1)*b.height>.05));
      const from=scaling?transform(tx,ty,sx,sy):translation(a.left-b.left,ty);
      const to=scaling?transform(0,0,ex,ey):"none";
      const moving=scaling?Math.abs(tx)+Math.abs(ty)+Math.abs(sx-ex)*b.width+Math.abs(sy-ey)*b.height>.05:from!=="none";
      if(duration&&moving){
        n.setAttribute("data-zr-bm-flip","true");flipNodes.add(n);
        if(play(n,from,to,duration)){if(scaling)scaledParents.add(n);}
        else{flipNodes.delete(n);n.removeAttribute("data-zr-bm-flip");}
      }
      if(isActive||formerlyScaled.has(n))for(const ch of innerNodes(n)){
        const from=inners.get(ch)||"none";
        const ix=isActive?target.inner/ex:1,iy=isActive?target.inner/ey:1;
        const to=isActive?"scale("+ix+","+iy+")":"none";
        if(!isActive&&!inners.has(ch))continue;
        play(ch,from,to,duration);
      }
    }
    // Safety cleanup only; normal completion is driven by Animation.finished.
    if(flips.size){const epoch=flipEpoch;flipTimer=window.setTimeout(()=>endFlip(epoch),duration+250); }
    else{stopFlips();if(!active){toolbar.removeAttribute("data-zr-bm-room");scheduleContour();}}
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
    if(event.pointerType==="touch"||event.buttons||openPopups.size||!settings.enabled||dragging)return;
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
      const r = active.getBoundingClientRect();
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
    if(active&&(!eligible(active)||!toolbarVisible())||[...flipNodes].some(n=>n.parentElement!==list))clear(true);
    if(!busy()){updateReserve();scheduleContour();}
  });
  const resize = new ResizeObserver(() => {
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
    observer.observe(root,{attributes:true,attributeFilter:["customizing","inDOMFullscreen","oneplane-active","zen-compact-mode"]});
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
  return destroy;
}

function cleanup() {
  if (disposed) return;
  disposed = true;
  if (startupObserver) {
    Services.obs.removeObserver(startupObserver, "browser-delayed-startup-finished");
    startupObserver = null;
  }
  uninstall?.();
  uninstall = null;
  window.removeEventListener("unload", cleanup);
  if (window[CONTROLLER] === cleanup) delete window[CONTROLLER];
}

function start() {
  if (disposed || window.closed) return;
  try { uninstall = install(); }
  catch (error) { console.error("[Zen Refined] Magnetic Bookmarks:", error); cleanup(); }
}

if (!root.hasAttribute("popup-window") && typeof window.addUnloadListener === "function") {
  window[CONTROLLER]?.();
  window[CONTROLLER] = cleanup;
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
