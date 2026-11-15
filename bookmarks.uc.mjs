/* Zen Refined — Magnetic Bookmarks
 * Native bookmarks only. No page content, network requests or browser preference
 * changes. The only preferences observed are this module's own settings.
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
  let settings = {};

  function readSettings() {
    settings = {
      enabled: bool("enabled", true),
      scale: number("scale", 142, 110, 155) / 100,
      lift: number("lift", 6, 0, 10),
      duration: number("duration", 240, 80, 400),
      indicator: bool("indicator", true),
      glow: bool("glow", true)
    };
    toolbar.style.setProperty("--zr-bm-duration", (motion.matches ? 0 : settings.duration) + "ms");
    toolbar.toggleAttribute("data-zr-magnetic-enabled", settings.enabled);
    indicator.toggleAttribute("data-zr-no-glow", !settings.glow);
    if (!settings.enabled) clear(true);
    else if (active) {
      const saved = pointerX;
      const item = active;
      clear(true);
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
      start: numeric(style.marginInlineStart),
      end: numeric(style.marginInlineEnd),
      timer: 0
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

  function forget(item) {
    const m = state.get(item);
    if (!m) return;
    if (m.timer) window.clearTimeout(m.timer);
    item.removeAttribute("data-zr-bm-active");
    item.removeAttribute("data-zr-bm-managed");
    for (const key of ["--zr-bm-margin-start", "--zr-bm-margin-end", "--zr-bm-grow",
      "--zr-bm-scale-x", "--zr-bm-scale-y", "--zr-bm-lift", "--zr-bm-inner-x", "--zr-bm-inner-y"]) {
      item.style.removeProperty(key);
    }
    state.delete(item);
    if (!state.size) toolbar.removeAttribute("data-zr-bm-room");
  }

  function collapse(item, immediately = false) {
    const m = state.get(item);
    if (!m) return;
    item.removeAttribute("data-zr-bm-active");
    if (m.timer) window.clearTimeout(m.timer);
    if (immediately || motion.matches) forget(item);
    else m.timer = window.setTimeout(() => {
      if (item !== active) forget(item);
    }, settings.duration + 80);
  }

  function expand(item) {
    const m = measure(item);
    if (!(m.width > 0) || !(m.height > 0)) return false;
    if (m.timer) window.clearTimeout(m.timer);
    m.timer = 0;
    const free = availableGrowth();
    const extra = Math.min(m.width * (settings.scale - 1), Math.max(0, free - 4));
    const scaleX = 1 + extra / m.width;
    // Keep the vertical lift and mild emphasis even in a crowded row.
    const scaleY = Math.min(1.36, Math.max(1.08, 1 + (settings.scale - 1) * .86));
    const innerScale = Math.min(1.18, scaleX, scaleY);
    const lift = motion.matches ? 0 : settings.lift;
    const set = (name, value) => item.style.setProperty(name, String(value));
    state.set(item, m);
    set("--zr-bm-margin-start", m.start + "px");
    set("--zr-bm-margin-end", m.end + "px");
    set("--zr-bm-grow", extra / 2 + "px");
    set("--zr-bm-scale-x", scaleX);
    set("--zr-bm-scale-y", scaleY);
    set("--zr-bm-lift", lift + "px");
    set("--zr-bm-inner-x", innerScale / scaleX);
    set("--zr-bm-inner-y", innerScale / scaleY);
    // Install the baseline before enabling the transition on a new node.
    if (!item.hasAttribute("data-zr-bm-managed")) {
      item.setAttribute("data-zr-bm-managed", "true");
      void item.getBoundingClientRect();
    }
    item.setAttribute("data-zr-bm-active", "true");
    // Only allow the transformed item to paint above the list if there is
    // enough horizontal space; do not defeat a visible native overflow menu.
    const chevron = document.getElementById("PlacesChevron");
    const chevronVisible = chevron && !chevron.collapsed && !chevron.hidden &&
      chevron.getBoundingClientRect().width > 1;
    toolbar.toggleAttribute("data-zr-bm-room", free > 8 && !chevronVisible);
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

  function select(item, x = null) {
    if (!toolbarVisible() || !eligible(item)) return;
    pointerX = x;
    if (active === item) { schedule(); return; }
    const previous = active;
    active = item;
    if (previous) collapse(previous);
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
    const previous = active;
    active = null; pointerX = null; shown = false;
    indicator.removeAttribute("data-zr-visible");
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0; last = 0; vx = 0;
    if (previous) collapse(previous, immediately);
    if (immediately) for (const item of [...state.keys()]) forget(item);
    if (immediately || !state.size) toolbar.removeAttribute("data-zr-bm-room");
  }

  function onPointerMove(event) {
    if (event.pointerType === "touch" || !toolbarVisible() || event.buttons || openPopups.size) return;
    // Handle the actual native hit target. Do not synthesize clicks or
    // react to pointerenter events generated solely by animated layout.
    const item = event.target?.closest?.("toolbarbutton.bookmark-item");
    if (eligible(item)) { select(item, event.clientX); return; }
    // Keep the active bookmark while the pointer is still within its
    // original row slot, even after its artwork has lifted upward.
    if (active && eligible(active)) {
      const r = active.getBoundingClientRect();
      const t = toolbar.getBoundingClientRect();
      if (event.clientX >= r.left - 2 && event.clientX <= r.right + 2 &&
          event.clientY >= Math.min(r.top, t.top) && event.clientY <= t.bottom) {
        pointerX = event.clientX;
        schedule();
        return;
      }
    }
    clear();
  }

  function onPointerLeave() { if (!openPopups.size) clear(); }
  function onFocus(event) {
    const item = event.target?.closest?.("toolbarbutton.bookmark-item");
    if (eligible(item) && item.matches(":focus-visible")) select(item, null);
  }
  function onFocusOut(event) {
    if (!openPopups.size && event.relatedTarget && !toolbar.contains(event.relatedTarget) && !toolbar.matches(":hover")) clear();
  }
  function onDragStart() { dragging = true; clear(true); }
  function onDragEnd() { dragging = false; }
  function onPopupShowing(event) {
    openPopups.add(event.target);
    // Freeze the native folder anchor during opening; collapse after close.
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
    for (const item of [...state.keys()]) if (item.parentElement !== list) forget(item);
    if (active && (!eligible(active) || !toolbarVisible())) clear(true);
  });
  const resize = new ResizeObserver(() => {
    const next = toolbar.getBoundingClientRect().width;
    if (Math.abs(next - toolbarWidth) > 2) {
      toolbarWidth = next;
      clear(true);
    }
  });
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
    [window, "beforecustomization", onPointerLeave, false]
  ];
  function destroy() {
    if (dead) return;
    dead = true;
    clear(true);
    if (refreshFrame) window.cancelAnimationFrame(refreshFrame);
    observer.disconnect();
    resize.disconnect();
    openPopups.clear();
    for (const [target, type, listener, capture] of listeners) target.removeEventListener(type, listener, capture);
    try { prefs.removeObserver(PREFIX, prefsObserver); } catch {}
    motion.removeEventListener("change", prefsObserver);
    toolbar.removeAttribute("data-zr-magnetic-enabled");
    toolbar.style.removeProperty("--zr-bm-duration");
    indicator.remove();
  }
  try {
    toolbar.append(indicator);
    toolbarWidth = toolbar.getBoundingClientRect().width;
    readSettings();
    for (const [target, type, listener, capture] of listeners) target.addEventListener(type, listener, capture);
    observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "collapsed", "style", "label"] });
    observer.observe(toolbar, { attributes: true, attributeFilter: ["hidden", "collapsed"] });
    observer.observe(root, { attributes: true, attributeFilter: ["customizing", "inDOMFullscreen"] });
    resize.observe(toolbar);
    prefs.addObserver(PREFIX, prefsObserver);
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
