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
  let leaveTimer = 0, geometryFrame = 0, geometryPlan = null, contourFrame = 0, contourSurface = null, contourKey = "";
  let baseHeight = 0, basePadding = 0, reserve = 0, ruleSerial=0;
  const geometrySheet=document.createElementNS("http://www.w3.org/1999/xhtml","style");
  geometrySheet.id="zr-bm-geometry-sheet";
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
    if(state.size)return;
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
    if (settings.enabled && active) {
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

  function measure(item) {
    if (state.has(item)) return state.get(item);
    const style = window.getComputedStyle(item);
    const rect = item.getBoundingClientRect();
    const numeric = v => parseFloat(v) || 0;
    const metric = {
      width: rect.width,
      height: rect.height,
      grow: 0, vertical: 0,
      start: numeric(style.marginInlineStart),
      end: numeric(style.marginInlineEnd),
      rule: null
    };
    return metric;
  }

  // Do not force native overflow/chevron visibility or reparent Places nodes.
  // Limit the extra layout space to the available width in the native row.
  function availableGrowth() {
    const bounds = list.getBoundingClientRect();
    const visible = Array.from(list.children).filter(node => {
      if (node.hidden || node.collapsed) return false;
      const style = window.getComputedStyle(node);
      return style.visibility === "visible" && style.display !== "none";
    });
    if (!visible.length || bounds.width <= 0) return 0;
    const gap = parseFloat(window.getComputedStyle(list).columnGap) || 0;
    let occupied = Math.max(0, visible.length - 1) * gap;
    for (const node of visible) {
      const m = measure(node);
      occupied += m.width + m.start + m.end;
    }
    // Leave a small buffer so Places need not activate overflow at the edge.
    return Math.max(0, bounds.width - occupied - 8);
  }

  function geometryStyle(item,m){
    if(m.rule)return m.rule.style;
    return item.style;
  }
  function installRule(item,m){
    try{
      const sheet=geometrySheet.sheet;if(!sheet)return;
      const id=String(++ruleSerial),index=sheet.insertRule(`[data-zr-bm-geometry="${id}"] {}`,sheet.cssRules.length);
      m.rule=sheet.cssRules[index];item.setAttribute("data-zr-bm-geometry",id);
    }catch{}
  }
  function removeRule(item,m){
    item.removeAttribute("data-zr-bm-geometry");
    if(!m.rule)return;
    try{const sheet=geometrySheet.sheet;const index=Array.from(sheet.cssRules).indexOf(m.rule);if(index>=0)sheet.deleteRule(index);}catch{}
    m.rule=null;
  }
  function forget(item){
    const m=state.get(item);if(!m)return;
    item.removeAttribute("data-zr-bm-active");item.removeAttribute("data-zr-bm-managed");removeRule(item,m);
    for(const key of ["--zr-bm-margin-start","--zr-bm-margin-end","--zr-bm-grow",
      "--zr-bm-scale-x","--zr-bm-scale-y","--zr-bm-inner-x","--zr-bm-inner-y"])item.style.removeProperty(key);
    state.delete(item);
    if(!state.size){toolbar.removeAttribute("data-zr-bm-room");scheduleContour();}
  }
  function applyGeometry(item,m){
    const sx=1+m.grow/Math.max(1,m.width),sy=1+(desiredY()-1)*m.vertical;
    const inner=Math.min(1.18,sx,sy);
    // CSSOM rule edits do not mutate the element style attribute. OnePlane
    // observes bookmark DOM mutations; avoid forcing a mask pass each frame.
    const style=geometryStyle(item,m);
    const set=(key,value)=>{const v=String(value);if(style.getPropertyValue(key)!==v)style.setProperty(key,v);};
    set("--zr-bm-grow",(m.grow/2).toFixed(3)+"px");
    set("--zr-bm-scale-x",sx.toFixed(5));set("--zr-bm-scale-y",sy.toFixed(5));
    set("--zr-bm-inner-x",(inner/sx).toFixed(5));set("--zr-bm-inner-y",(inner/sy).toFixed(5));
  }
  function samplePlan(time){
    if(!geometryPlan)return;
    const p=geometryPlan,t=clamp((time-p.start)/Math.max(1,p.duration),0,1),e=t*t*(3-2*t);
    for(const [item,g] of p.items){
      const m=state.get(item);if(!m)continue;
      m.grow=g.from+(g.to-g.from)*e;m.vertical=g.vFrom+(g.vTo-g.vFrom)*e;
      applyGeometry(item,m);
    }
    if(t>=1){
      geometryPlan=null;
      for(const [item,m] of [...state])if(item!==active&&m.grow<.001&&m.vertical<.001)forget(item);
    }
  }
  function geometryTick(time){
    geometryFrame=0;if(dead)return;
    samplePlan(time);
    if(geometryPlan)geometryFrame=window.requestAnimationFrame(geometryTick);
  }
  function retarget(){
    const now=window.performance.now();
    samplePlan(now);
    if(geometryFrame)window.cancelAnimationFrame(geometryFrame);
    geometryFrame=0;
    const free=availableGrowth(),budget=Math.max(0,free-4),items=new Map();
    // All outgoing and incoming slots share one easing curve. Their sum
    // interpolates between two budgets, so a fast hover change cannot
    // transiently demand twice the free width and trigger native overflow.
    let current=0;for(const m of state.values())current+=m.grow;
    const factor=current>budget&&current>0?budget/current:1;
    for(const [item,m] of state){
      m.grow*=factor;
      const to=item===active?Math.min(m.width*(settings.scale-1),budget):0;
      items.set(item,{from:m.grow,to,vFrom:m.vertical,vTo:item===active?1:0});
      item.toggleAttribute("data-zr-bm-active",item===active);
      applyGeometry(item,m);
    }
    geometryPlan={start:now,duration:motion.matches?0:settings.duration,items};
    if(motion.matches)samplePlan(now+1);else geometryFrame=window.requestAnimationFrame(geometryTick);
  }
  function expand(item){
    const m=measure(item);
    if(!(m.width>0)||!(m.height>0))return false;
    if(!state.has(item)){
      state.set(item,m);installRule(item,m);
      const style=geometryStyle(item,m);
      style.setProperty("--zr-bm-margin-start",m.start+"px");
      style.setProperty("--zr-bm-margin-end",m.end+"px");
      applyGeometry(item,m);item.setAttribute("data-zr-bm-managed","true");
    }
    // The constant bottom reserve is larger than the maximum scale
    // growth. A top transform origin makes the upper edge invariant.
    toolbar.setAttribute("data-zr-bm-room","true");
    retarget();
    return true;
  }

  function destination() {
    if (!active || !eligible(active)) return null;
    const a = active.getBoundingClientRect();
    const s = toolbar.getBoundingClientRect();
    if (a.width <= 0 || s.height <= 2) return null;
    const originX = s.left + toolbar.clientLeft;
    const originY = s.top + toolbar.clientTop;
    const center = a.left + a.width / 2;
    const bias = pointerX === null ? 0 : clamp((pointerX - center) / Math.max(1, a.width / 2), -1, 1);
    // The drop is anchored to the bookmark center, not to the mouse.
    const maxBias = Math.min(12, a.width * .12);
    const base = clamp(a.width * .14, 12, 18);
    const y = clamp(a.bottom - originY + 5, 3, Math.max(3, s.height - 3));
    return { x: center - originX + bias * maxBias, y, w: base };
  }

  function paint() {
    const tail = clamp(vx * .0035, -5, 5);
    indicator.style.width = w.toFixed(2) + "px";
    indicator.style.height = h.toFixed(2) + "px";
    indicator.style.transform = "translate3d(" + (cx - w / 2 - tail).toFixed(2) +
      "px," + (cy - h / 2).toFixed(2) + "px,0)";
  }

  function animate(now) {
    raf = 0;
    if (dead || !active || !settings.indicator || !toolbarVisible()) return;
    const p = destination();
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
    if(!state.size){updateReserve();updateContour();}
    active = item;
    if (!expand(item)) { clear(); return; }
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
    cancelPendingLeave();
    const previous = active;
    active = null; pointerX = null; shown = false;
    indicator.removeAttribute("data-zr-visible");
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0; last = 0; vx = 0;
    if(immediately){
      if(geometryFrame)window.cancelAnimationFrame(geometryFrame);geometryFrame=0;geometryPlan=null;
      for(const item of [...state.keys()])forget(item);
    }else if(previous||state.size)retarget();
    if (immediately || !state.size) toolbar.removeAttribute("data-zr-bm-room");
  }

  function onPointerMove(event) {
    if (event.pointerType === "touch" || !toolbarVisible() || event.buttons || openPopups.size) return;
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
    cancelPendingLeave();
    openPopups.add(event.target);
    // Freeze the native folder anchor during opening; collapse after close.
    if(geometryFrame)window.cancelAnimationFrame(geometryFrame);
    geometryFrame=0;geometryPlan=null;
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
    for(const item of [...state.keys()])if(item.parentElement!==list)forget(item);
    if(active&&(!eligible(active)||!toolbarVisible()))clear(true);
    if(!state.size){updateReserve();scheduleContour();}
    else if(active&&!eligible(active))clear(true);
  });
  const resize = new ResizeObserver(() => {
    const next = toolbar.getBoundingClientRect().width;
    if(Math.abs(next-toolbarWidth)>2){toolbarWidth=next;clear(true);}
    if(!state.size){updateReserve();scheduleContour();}
  });
  const contourObserver=()=>scheduleContour();
  const panelObserver=new MutationObserver(()=>{if(!state.size)scheduleContour();});
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
    if (refreshFrame) window.cancelAnimationFrame(refreshFrame);
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
    geometrySheet.remove();indicator.remove();
  }
  try {
    root.append(geometrySheet);
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
