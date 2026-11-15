/* Zen Refined — Adaptive Page Transitions
 * Native navigation always proceeds normally. All pixels are ephemeral, in memory.
 * No interception of requests, content injection, disk writes, or viewport resize.
 */
const PREFIX = "zen.refined.transitions.";
const KEY = "__zenRefinedPageTransitions";
const NS = "http://www.w3.org/1999/xhtml";
const ACTOR = "ZenRefinedTransition";
const ACTOR_URI = "chrome://sine/content/9d788b55-d497-41da-8444-993c603e89e4/actors/ZenRefinedTransitionParent.sys.mjs";
const P = Ci.nsIWebProgressListener;
const root = document.documentElement;
const prefs = Services.prefs;
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const isWeb = s => /^https?:\/\//i.test(s || "");
const stripHash = s => (s || "").split("#")[0];
let startup = null, teardown = null, disposed = false;

function install() {
  const gb = window.gBrowser;
  if (!gb?.addTabsProgressListener) return () => {};
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let active = null, origin = null, originTimer = 0, serial = 0, dead = false;
  let releaseActor = null, enabled = false;
  const debug = (...args) => { if (prefs.getBoolPref(PREFIX + "debug", false)) console.debug("[Zen Refined transitions]", ...args); };
  const on = (key, fallback = true) => prefs.getBoolPref(PREFIX + key, fallback);
  const maxTime = () => clamp(prefs.getIntPref(PREFIX + "timeout", 4000), 500, 4000);
  const now = () => window.performance.now();
  function safeBrowser(b) {
    return enabled && !motion.matches && b === gb.selectedBrowser &&
      !root.hasAttribute("inDOMFullscreen") && !root.hasAttribute("customizing") &&
      !window.document.fullscreenElement && !gb.selectedTab?.hasAttribute("splitview") &&
      !gb.selectedTab?.hasAttribute("zen-split-view") && b.getBoundingClientRect().width > 20;
  }
  function getActor(b) {
    try { return b.browsingContext.currentWindowGlobal.getActor(ACTOR); } catch { return null; }
  }
  function clearOrigin() {
    window.clearTimeout(originTimer);
    originTimer = 0;
    if (origin) { origin.expired = true; origin.bitmap?.close?.(); origin.bitmap = null; }
    origin = null;
  }
  function capture(b, rec) {
    if (!on("snapshot")) return;
    try {
      const global = b.browsingContext?.currentWindowGlobal;
      const rect = b.getBoundingClientRect();
      if (!global?.drawSnapshot) return;
      const scale = clamp(1600 / Math.max(rect.width, rect.height), .12, .75);
      global.drawSnapshot(null, scale, "#202124").then(bitmap => {
        if (rec.expired || dead || !bitmap) { bitmap?.close?.(); return; }
        if (active?.source === rec) {
          applySnapshot(active, bitmap);
          bitmap.close?.();
        } else if (origin === rec) rec.bitmap = bitmap;
        else bitmap.close?.();
      }, () => {});
    } catch {}
  }
  function remember(b, rect) {
    if (!safeBrowser(b)) return;
    if (active) finish(active, "interaction");
    clearOrigin();
    origin = { browser: b, rect, at: now(), bitmap: null, expired: false };
    capture(b, origin);
    originTimer = window.setTimeout(clearOrigin, 1400);
  }
  function newNode(tag, className) {
    const el = document.createElementNS(NS, tag);
    el.className = className;
    return el;
  }
  function applySnapshot(s, bitmap) {
    if (active !== s || now() - s.start > 250 || !bitmap.width || !bitmap.height) return;
    try {
      const bg = s.backdrop;
      bg.width = bitmap.width;
      bg.height = bitmap.height;
      bg.getContext("2d").drawImage(bitmap, 0, 0);
      const r = s.sourceRect;
      const sx = clamp(r.x / s.w * bitmap.width, 0, bitmap.width - 1);
      const sy = clamp(r.y / s.h * bitmap.height, 0, bitmap.height - 1);
      const sw = clamp(r.w / s.w * bitmap.width, 1, bitmap.width - sx);
      const sh = clamp(r.h / s.h * bitmap.height, 1, bitmap.height - sy);
      if (s.source?.rect?.content) {
        s.preview.width = Math.max(1, Math.round(sw));
        s.preview.height = Math.max(1, Math.round(sh));
        s.preview.getContext("2d").drawImage(bitmap, sx, sy, sw, sh, 0, 0, s.preview.width, s.preview.height);
        s.preview.dataset.snapshot = "true";
      }
    } catch {}
  }
  function normalizedRect(b, rect) {
    const fallback = { x: b.width / 2 - 28, y: b.height / 2 - 18, w: 56, h: 36 };
    if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return fallback;
    const w = clamp(rect.w, 24, b.width), h = clamp(rect.h, 20, b.height);
    return { x: clamp(rect.x - b.left, 0, b.width - w), y: clamp(rect.y - b.top, 0, b.height - h), w, h };
  }
  function begin(b, kind, uri) {
    if (!safeBrowser(b) || !isWeb(uri) || (kind === "soft" && !on("soft"))) return null;
    if (active) finish(active, "superseded");
    const bounds = b.getBoundingClientRect();
    let source = origin?.browser === b && now() - origin.at < 1400 ? origin : null;
    if (source) { window.clearTimeout(originTimer); originTimer = 0; origin = null; }
    else clearOrigin();
    const overlay = newNode("div", "zr-page-transition");
    const backdrop = newNode("canvas", "zr-page-transition-backdrop");
    const shade = newNode("div", "zr-page-transition-shade");
    const preview = newNode("canvas", "zr-page-transition-preview");
    overlay.append(backdrop, shade, preview);
    Object.assign(overlay.style, { left: bounds.left + "px", top: bounds.top + "px", width: bounds.width + "px", height: bounds.height + "px" });
    const s = { token: ++serial, browser: b, kind, uri, start: now(), timeout: maxTime(),
      w: bounds.width, h: bounds.height, left: bounds.left, top: bounds.top,
      overlay, backdrop, shade, preview, source, sourceRect: normalizedRect(bounds, source?.rect),
      committed: kind === "soft", global: kind === "soft" ? b.browsingContext?.currentWindowGlobal : null,
      oldGlobal: b.browsingContext?.currentWindowGlobal, progress: 0, visual: 0, ready: null, raf: 0, timer: 0 };
    active = s;
    try {
      root.append(overlay);
      if (source?.bitmap) { applySnapshot(s, source.bitmap); source.bitmap.close?.(); source.bitmap = null; }
      if (!source) { s.source = { rect: null, expired: false }; capture(b, s.source); }
      render(s, 0);
      s.timer = window.setTimeout(() => finish(s, "timeout"), s.timeout);
      s.raf = window.requestAnimationFrame(t => tick(s, t));
      debug("start", kind);
      if (kind === "soft") {
        const actor = getActor(b);
        if (actor) {
          try { actor.sendAsyncMessage("WatchSoft", { token: s.token }); }
          catch { markReady(s); }
          // Even if the actor isn't operational, never cover a same-document
          // transition for four seconds just because its mutations are opaque.
          s.softTimer = window.setTimeout(() => markReady(s), 1250);
        } else s.softTimer = window.setTimeout(() => markReady(s), 240);
      }
      return s;
    } catch (error) { finish(s, "setup-error"); console.warn("[Zen Refined transitions]", error); return null; }
  }
  function render(s, p) {
    const r = s.sourceRect;
    const move = ease(p / .43);
    const expand = ease(clamp((p - .12) / .88, 0, 1));
    const w = lerp(r.w, s.w, expand), h = lerp(r.h, s.h, expand);
    const cx = lerp(r.x + r.w / 2, s.w / 2, move);
    const cy = lerp(r.y + r.h / 2, s.h / 2, move);
    const x = clamp(cx - w / 2, 0, s.w - w), y = clamp(cy - h / 2, 0, s.h - h);
    const right = x + w, bottom = y + h;
    // The outside of the expanding aperture is the old page, not a resized live browser.
    const hole = "polygon(evenodd,0px 0px,100% 0px,100% 100%,0px 100%,0px 0px," +
      x + "px " + y + "px," + x + "px " + bottom + "px," + right + "px " + bottom +
      "px," + right + "px " + y + "px," + x + "px " + y + "px,0px 0px)";
    s.backdrop.style.clipPath = hole;
    s.shade.style.clipPath = hole;
    s.shade.style.opacity = String(on("dim") ? .24 * (1 - p) : 0);
    Object.assign(s.preview.style, { width: w + "px", height: h + "px",
      transform: "translate(" + x + "px," + y + "px)",
      borderRadius: (10 * (1 - p)) + "px",
      opacity: String(1 - ease(clamp((p - .10) / .50, 0, 1))) });
  }
  function tick(s, time) {
    if (active !== s) return;
    if (!safeBrowser(s.browser)) return finish(s, "context");
    const bounds = s.browser.getBoundingClientRect();
    if (Math.abs(bounds.width - s.w) > 2 || Math.abs(bounds.height - s.h) > 2 ||
        Math.abs(bounds.left - s.left) > 2 || Math.abs(bounds.top - s.top) > 2) return finish(s, "resize");
    const elapsed = Math.max(0, time - s.start);
    if (elapsed >= s.timeout) return finish(s, "timeout");
    if (s.ready) {
      const t = clamp((time - s.ready.at) / s.ready.duration, 0, 1);
      s.visual = lerp(s.ready.from, 1, ease(t));
      if (t >= 1) return finish(s, "ready");
    } else {
      // Early motion, then a gradual expansion. Reported network progress can
      // accelerate it, but it never moves backwards or stalls indefinitely.
      const timed = .40 * (1 - Math.exp(-elapsed / 185)) + .42 * Math.pow(elapsed / s.timeout, .65);
      const target = Math.min(.86, Math.max(timed, .74 * s.progress));
      s.visual = Math.max(s.visual, lerp(s.visual, target, .30));
    }
    render(s, s.visual);
    s.raf = window.requestAnimationFrame(t => tick(s, t));
  }
  function markReady(s) {
    if (active !== s || s.ready) return;
    const elapsed = now() - s.start;
    // Cached loads never pay a fixed animation tax. A very fast navigation
    // either finishes immediately or uses one short compositor transition.
    if (elapsed < 75 || s.timeout - elapsed < 30) return finish(s, "fast-ready");
    s.ready = { from: s.visual, at: now(), duration: Math.max(1, Math.min(135, elapsed * .30, s.timeout - elapsed)) };
  }
  function finish(s, reason) {
    if (active !== s) return;
    active = null;
    window.cancelAnimationFrame(s.raf);
    window.clearTimeout(s.timer);
    window.clearTimeout(s.softTimer);
    if (s.source) { s.source.expired = true; s.source.bitmap?.close?.(); s.source.bitmap = null; }
    if (s.kind === "soft") { try { getActor(s.browser)?.sendAsyncMessage("CancelSoft"); } catch {} }
    s.overlay.remove();
    debug("finish", reason, Math.round(now() - s.start) + "ms");
  }
  function cancel() {
    if (active) finish(active, "cancel");
    clearOrigin();
  }
  function receive(b, global, message) {
    if (!safeBrowser(b)) return;
    if (message.name === "Origin") {
      const d = message.data;
      if (![d.x, d.y, d.w, d.h, d.vw, d.vh].every(Number.isFinite) || d.vw <= 0 || d.vh <= 0) return;
      const r = b.getBoundingClientRect(), sx = r.width / d.vw, sy = r.height / d.vh;
      remember(b, { x: r.left + d.x * sx, y: r.top + d.y * sy, w: d.w * sx, h: d.h * sy, content: true });
      return;
    }
    const s = active;
    if (!s || s.browser !== b || !s.committed) return;
    if (message.name === "SoftReady" && s.kind === "soft" && message.data.token === s.token && global === s.global) markReady(s);
    if (message.name === "Paint" && s.kind === "hard" && global === b.browsingContext?.currentWindowGlobal &&
        global !== s.oldGlobal) markReady(s);
  }
  function requestURL(request, b) {
    try { return request.QueryInterface(Ci.nsIChannel).URI.spec; } catch { return b.currentURI?.spec; }
  }
  const listener = {
    onStateChange(b, wp, request, flags, status) {
      if (!wp?.isTopLevel || !(flags & P.STATE_IS_NETWORK) || b !== gb.selectedBrowser) return;
      if (flags & P.STATE_START) {
        if (!safeBrowser(b)) return;
        const uri = requestURL(request, b);
        if (active?.browser === b && active.kind === "hard" && !active.committed) return;
        begin(b, "hard", uri);
      } else if (flags & P.STATE_STOP) {
        if (active?.browser !== b || active.kind !== "hard") return;
        if (Components.isSuccessCode(status) && active.committed) markReady(active);
        else finish(active, "network-stop");
      }
    },
    onLocationChange(b, wp, request, location, flags) {
      if (!wp?.isTopLevel || b !== gb.selectedBrowser) return;
      const uri = location?.spec || "";
      if (!isWeb(uri) || flags & P.LOCATION_CHANGE_ERROR_PAGE) { cancel(); return; }
      const same = !!(flags & P.LOCATION_CHANGE_SAME_DOCUMENT);
      const previous = b.__zrTransitionURI;
      b.__zrTransitionURI = uri;
      if (same) {
        if (previous && stripHash(previous) === stripHash(uri)) return;
        if (active?.kind === "hard") return;
        if (on("soft")) begin(b, "soft", uri);
      } else if (active?.browser === b && active.kind === "hard") {
        active.committed = true;
        active.global = b.browsingContext?.currentWindowGlobal;
        active.uri = uri;
      } else if (origin?.browser === b) {
        const s = begin(b, "hard", uri);
        if (s) { s.committed = true; s.global = b.browsingContext?.currentWindowGlobal; }
      }
    },
    onProgressChange(b, wp, request, curSelf, maxSelf, curTotal, maxTotal) {
      if (active?.browser === b && active.kind === "hard" && wp?.isTopLevel && maxTotal > 0)
        active.progress = Math.max(active.progress, clamp(curTotal / maxTotal, 0, 1));
    }
  };
  function chromePointer(event) {
    if (active) finish(active, "pointer");
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const el = event.target?.closest?.("toolbarbutton.bookmark-item, #urlbar, #back-button, #forward-button, #reload-button");
    if (!el || !on("chrome")) return;
    const r = el.getBoundingClientRect();
    remember(gb.selectedBrowser, { x: r.x, y: r.y, w: r.width, h: r.height });
  }
  function key(event) {
    if (event.key === "Escape") { cancel(); return; }
    if (event.key === "Enter" && on("chrome") && event.target?.closest?.("#urlbar")) {
      const r = document.getElementById("urlbar")?.getBoundingClientRect();
      if (r) remember(gb.selectedBrowser, { x: r.x, y: r.y, w: r.width, h: r.height });
    }
  }
  function settings() {
    enabled = on("enabled", false);
    if (!enabled || motion.matches) {
      cancel();
      releaseActor?.(); releaseActor = null;
    } else if (!releaseActor) {
      try { releaseActor = ChromeUtils.importESModule(ACTOR_URI).acquireTransitionActor(); }
      catch (error) { console.warn("[Zen Refined transitions] actor unavailable; using navigation fallback", error); }
    }
  }
  const tabEvents = ["TabSelect", "TabClose"];
  const windowEvents = [["pointerdown", chromePointer, true], ["keydown", key, true],
    ["resize", cancel, false], ["deactivate", cancel, false], ["beforecustomization", cancel, false],
    ["fullscreen", cancel, false], ["popupshowing", cancel, true]];
  function destroy() {
    if (dead) return;
    dead = true;
    cancel();
    try { gb.removeTabsProgressListener(listener); } catch {}
    for (const type of tabEvents) gb.tabContainer.removeEventListener(type, cancel);
    for (const [type, callback, capture] of windowEvents) window.removeEventListener(type, callback, capture);
    try { prefs.removeObserver(PREFIX, settings); } catch {}
    motion.removeEventListener("change", settings);
    try { releaseActor?.(); } catch {}
    releaseActor = null;
    for (const b of gb.browsers) { try { delete b.__zrTransitionURI; } catch {} }
  }
  try {
    window[KEY].receive = receive;
    gb.addTabsProgressListener(listener);
    for (const type of tabEvents) gb.tabContainer.addEventListener(type, cancel);
    for (const [type, callback, capture] of windowEvents) window.addEventListener(type, callback, capture);
    prefs.addObserver(PREFIX, settings);
    motion.addEventListener("change", settings);
    settings();
  } catch (error) { destroy(); throw error; }
  return destroy;
}
function cleanup() {
  if (disposed) return;
  disposed = true;
  if (startup) { Services.obs.removeObserver(startup, "browser-delayed-startup-finished"); startup = null; }
  teardown?.(); teardown = null;
  window.removeEventListener("unload", cleanup);
  if (window[KEY]?.cleanup === cleanup) delete window[KEY];
}
function start() {
  if (disposed || window.closed) return;
  try { teardown = install(); }
  catch (error) { console.warn("[Zen Refined transitions] startup failed", error); cleanup(); }
}
if (!root.hasAttribute("popup-window") && typeof window.addUnloadListener === "function") {
  window[KEY]?.cleanup?.();
  window[KEY] = { cleanup, receive: null };
  window.addUnloadListener(cleanup);
  window.addEventListener("unload", cleanup, { once: true });
  if (window.gBrowserInit?.delayedStartupFinished) start();
  else {
    startup = subject => {
      if (subject !== window) return;
      Services.obs.removeObserver(startup, "browser-delayed-startup-finished");
      startup = null;
      start();
    };
    Services.obs.addObserver(startup, "browser-delayed-startup-finished");
  }
}
