/* Zen Refined — Adaptive Page Transitions
 * Native navigation always proceeds normally. All pixels are ephemeral, in memory.
 * No interception of requests, content injection, disk writes, or viewport resize.
 */
const PREFIX = "zen.refined.transitions.";
const KEY = "__zenRefinedPageTransitions";
const NS = "http://www.w3.org/1999/xhtml";
const ACTOR = "ZenRefinedLiquidTransition";
const ACTOR_URI = "chrome://sine/content/9d788b55-d497-41da-8444-993c603e89e4/actors/ZenRefinedLiquidTransitionParent.sys.mjs";
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
  let lastInput = null;
  const painted = new WeakSet();
  const locations = new WeakMap();
  for (const b of gb.browsers) locations.set(b, b.currentURI?.spec || "");
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
    if (!on("snapshot") || !rec.capture || rec.expired) return;
    try {
      const global = b.browsingContext?.currentWindowGlobal;
      const rect = b.getBoundingClientRect();
      if (!global?.drawSnapshot || !isWeb(b.currentURI?.spec)) return;
      rec.global = global;
      rec.uri = b.currentURI?.spec;
      const scale = clamp(1450 / Math.max(rect.width, rect.height), .12, .70);
      global.drawSnapshot(null, scale, "transparent").then(bitmap => {
        if (!bitmap) return;
        // Never insert a screenshot that could belong to the destination.
        if (rec.expired || dead || b.browsingContext?.currentWindowGlobal !== global ||
            b.currentURI?.spec !== rec.uri) { bitmap.close?.(); return; }
        if (active?.source === rec) {
          if (!active.ready && !active.committed && now() - active.start < 110) applySnapshot(active, bitmap);
          bitmap.close?.();
        } else if (origin === rec) rec.bitmap = bitmap;
        else bitmap.close?.();
      }, () => {});
    } catch {}
  }
  function remember(b, rect, capturePage = true) {
    if (!safeBrowser(b)) return;
    lastInput = { browser: b, x: rect.x, y: rect.y, at: now() };
    if (active && active.browser === b && now() - active.start < 100) {
      // Don't cancel a navigation if the input IPC arrives after web progress.
      if (!active.source && active.flight < .20) {
        active.from = point(b.getBoundingClientRect(), rect);
      }
      return;
    }
    if (active) finish(active, "interaction");
    clearOrigin();
    origin = { browser: b, rect, at: now(), bitmap: null, expired: false, capture: capturePage };
    capture(b, origin);
    originTimer = window.setTimeout(clearOrigin, 1100);
  }
  function newNode(tag, className) {
    const el = document.createElementNS(NS, tag);
    el.className = className;
    return el;
  }
  function applySnapshot(s, bitmap) {
    if (active !== s || s.ready || !bitmap.width || !bitmap.height) return;
    try {
      // Reject blank/uniform snapshots: a real page remains visible instead.
      const sample = newNode("canvas", "");
      sample.width = 12; sample.height = 8;
      const test = sample.getContext("2d", { willReadFrequently: true });
      test.drawImage(bitmap, 0, 0, 12, 8);
      const pixels = test.getImageData(0, 0, 12, 8).data;
      let lo = 255, hi = 0, opaque = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i+3] < 128) continue;
        opaque++;
        const v = (pixels[i] + pixels[i+1] + pixels[i+2]) / 3;
        lo = Math.min(lo,v); hi = Math.max(hi,v);
      }
      if (opaque < 60 || hi-lo < 12) { debug("snapshot skipped: blank"); return; }
      s.backdrop.width = bitmap.width;
      s.backdrop.height = bitmap.height;
      s.backdrop.getContext("2d").drawImage(bitmap, 0, 0);
      s.hasSnapshot = true;
      s.backdrop.style.visibility = "visible";
      debug("snapshot accepted");
    } catch { debug("snapshot unavailable"); }
  }
  function point(bounds, rect) {
    if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y))
      return { x: bounds.width / 2, y: bounds.height / 2 };
    return { x: clamp(rect.x - bounds.left, 0, bounds.width),
      y: clamp(rect.y - bounds.top, 0, bounds.height) };
  }
  function nativePoint(b, bounds) {
    if (lastInput?.browser === b && now() - lastInput.at < 1100) return point(bounds,lastInput);
    // Gecko exposes the native pointer even when the content process actor
    // cannot deliver the click. No event interception or synthetic clicks.
    try {
      const x = {}, y = {};
      window.windowUtils.getLastOverWindowPointerLocationInCSSPixels(x,y);
      if (Number.isFinite(x.value) && Number.isFinite(y.value) && (x.value || y.value))
        return point(bounds,{ x:x.value,y:y.value });
    } catch {}
    return point(bounds,null);
  }
  function begin(b, kind, uri) {
    if (!safeBrowser(b) || !isWeb(uri) || (kind === "soft" && !on("soft"))) return null;
    if (active) finish(active, "superseded");
    const bounds = b.getBoundingClientRect();
    let source = origin?.browser === b && now() - origin.at < 1100 ? origin : null;
    if (source) { window.clearTimeout(originTimer); originTimer = 0; origin = null; }
    else clearOrigin();
    const overlay = newNode("div", "zr-page-transition");
    const backdrop = newNode("canvas", "zr-page-transition-backdrop");
    const shade = newNode("div", "zr-page-transition-shade");
    const drop = newNode("div", "zr-page-transition-drop");
    const ring = newNode("div", "zr-page-transition-ring");
    overlay.append(backdrop, shade, ring, drop);
    Object.assign(overlay.style, { left: bounds.left + "px", top: bounds.top + "px", width: bounds.width + "px", height: bounds.height + "px" });
    const start = now();
    const s = { token: ++serial, browser:b, kind, uri, start, timeout:maxTime(),
      w:bounds.width, h:bounds.height, left:bounds.left, top:bounds.top,
      overlay, backdrop, shade, drop, ring, source, from: source ? point(bounds,source.rect) : nativePoint(b,bounds),
      committed:kind === "soft", global:kind === "soft" ? b.browsingContext?.currentWindowGlobal : null,
      oldGlobal:b.browsingContext?.currentWindowGlobal, progress:0, flight:0, reveal:0,
      flightVelocity:0, ready:null, raf:0, timer:0, last:start, lastGeometry:start,
      hasSnapshot:false, dim:on("dim"), youtube:/^https?:\/\/(?:[^/]+\.)?youtube\.com\//i.test(uri) };
    active=s;
    try {
      root.append(overlay);
      if (source?.bitmap) { applySnapshot(s,source.bitmap); source.bitmap.close?.(); source.bitmap=null; }
      // Only use a pre-navigation capture. A late capture is often the new page
      // or a blank frame; with no snapshot we animate directly over live content.
      render(s,start);
      s.timer=window.setTimeout(()=>finish(s,"timeout"),s.timeout);
      s.raf=window.requestAnimationFrame(t=>tick(s,t));
      debug("start",kind,source ? "input-origin" : "native-pointer");
      if (kind === "soft") {
        const actor=getActor(b);
        if (actor) {
          try { actor.sendAsyncMessage("WatchSoft",{token:s.token}); }
          catch { markReady(s); }
          s.softTimer=window.setTimeout(()=>markReady(s),Math.min(s.timeout-150,s.youtube?2800:1400));
        } else s.softTimer=window.setTimeout(()=>markReady(s),s.youtube?700:320);
      }
      return s;
    } catch(error) { finish(s,"setup-error"); console.warn("[Zen Refined transitions]",error); return null; }
  }
  function render(s,time) {
    const f=clamp(s.flight,0,1), q=clamp(s.reveal,0,1);
    const cx0=s.w/2, cy0=s.h/2;
    const dx=cx0-s.from.x, dy=cy0-s.from.y;
    const distance=Math.hypot(dx,dy);
    const bend=Math.min(38,distance*.07)*Math.sin(Math.PI*f);
    const cx=lerp(s.from.x,cx0,f) - (distance?dy/distance*bend:0);
    const cy=lerp(s.from.y,cy0,f) + (distance?dx/distance*bend:0);
    const angle=Math.atan2(dy,dx)*180/Math.PI;
    const speedStretch=clamp(s.flightVelocity*.12,0,.95)*(1-f*.4);
    const base=lerp(.22,.68,ease(f)) + (1-q)*.055*Math.sin((time-s.start)/180)*ease(f);
    const grow=1+q*2.8;
    s.drop.style.transform="translate3d("+cx+"px,"+cy+"px,0) rotate("+angle+"deg) scale("+
      (base*grow*(1+speedStretch))+","+(base*grow/(1+speedStretch*.44))+")";
    s.drop.style.opacity=String((1-ease(clamp((q-.02)/.44,0,1)))*ease(Math.min(1,(time-s.start+16)/65)));
    // The expanding hole reveals the real, unscaled browser. The old capture
    // never fills the hole, and a missing capture never creates an opaque card.
    const rx=lerp(12,Math.hypot(s.w,s.h)*.73+36,q);
    const ry=lerp(12,Math.hypot(s.w,s.h)*.73+36,q);
    const mask="radial-gradient(ellipse "+rx+"px "+ry+"px at "+cx+"px "+cy+"px, transparent 0%, transparent 95%, black 100%)";
    if (s.hasSnapshot && q>0) {
      s.backdrop.style.maskImage=mask;
      s.backdrop.style.opacity=String(1-ease(clamp((q-.78)/.22,0,1)));
    }
    s.shade.style.opacity=String(s.dim ? .16*ease(f)*(1-q) : 0);
    if (q>0) {
      s.ring.style.opacity=String(.48*Math.sin(Math.PI*q));
      s.ring.style.transform="translate3d("+cx+"px,"+cy+"px,0) scale("+(rx/32)+","+(ry/32)+")";
    }
  }
  function tick(s,time) {
    if (active !== s) return;
    if (!enabled || motion.matches || s.browser !== gb.selectedBrowser) return finish(s,"context");
    if (time-s.lastGeometry>125) {
      s.lastGeometry=time;
      if (!safeBrowser(s.browser)) return finish(s,"context");
      const r=s.browser.getBoundingClientRect();
      if (Math.abs(r.width-s.w)>6 || Math.abs(r.height-s.h)>6 || Math.abs(r.left-s.left)>6 || Math.abs(r.top-s.top)>6)
        return finish(s,"resize");
    }
    const elapsed=Math.max(0,time-s.start);
    if (elapsed>=s.timeout) return finish(s,"timeout");
    const dt=clamp((time-s.last)/1000,0,.10); s.last=time;
    // Analytic time-based damping, not a per-frame lerp: consistent at
    // 60/120/180 Hz, with a smooth velocity change when readiness arrives.
    const rate=s.ready ? 19 : 9.5;
    const next=1-(1-s.flight)*Math.exp(-rate*dt);
    s.flightVelocity=dt>0?(next-s.flight)/dt:0;
    s.flight=next;
    if (!s.ready && elapsed>=s.timeout-240) markReady(s);
    if (s.ready) {
      const since=Math.max(0,time-s.ready.at);
      s.reveal=ease(clamp(since/s.ready.duration,0,1));
      if (since>=s.ready.duration) return finish(s,"ready");
    }
    render(s,time);
    s.raf=window.requestAnimationFrame(t=>tick(s,t));
  }
  function markReady(s) {
    if (active!==s || s.ready) return;
    const elapsed=now()-s.start, remaining=s.timeout-elapsed;
    if (remaining<=20 || elapsed<25) return finish(s,"fast-ready");
    // Fast loads get a short reveal; longer loads get a proper liquid morph.
    const duration=Math.min(remaining,clamp(80+elapsed*.32,90,260));
    s.ready={at:now(),duration};
    debug("ready",Math.round(elapsed)+"ms");
  }
  function finish(s,reason) {
    if (active!==s) return;
    active=null;
    window.cancelAnimationFrame(s.raf);
    window.clearTimeout(s.timer);
    window.clearTimeout(s.softTimer);
    if (s.source) { s.source.expired=true; s.source.bitmap?.close?.(); s.source.bitmap=null; }
    if (s.kind==="soft") { try { getActor(s.browser)?.sendAsyncMessage("CancelSoft"); } catch {} }
    s.overlay.remove();
    debug("finish",reason,Math.round(now()-s.start)+"ms");
  }
  function cancel() {
    if (active) finish(active, "cancel");
    clearOrigin();
    lastInput=null;
  }
  function receive(b, global, message) {
    if (!safeBrowser(b)) return;
    if (message.name === "Origin") {
      const d = message.data;
      if (![d.x, d.y, d.vw, d.vh].every(Number.isFinite) || d.vw <= 0 || d.vh <= 0) return;
      const r = b.getBoundingClientRect(), sx = r.width / d.vw, sy = r.height / d.vh;
      remember(b, { x: r.left + d.x * sx, y: r.top + d.y * sy }, !!d.navigation);
      return;
    }
    if (message.name === "Paint") painted.add(global);
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
      if (!wp?.isTopLevel) return;
      const uri = location?.spec || "";
      const previous = locations.get(b);
      locations.set(b, uri);
      if (b !== gb.selectedBrowser) return;
      if (!isWeb(uri) || flags & P.LOCATION_CHANGE_ERROR_PAGE) { cancel(); return; }
      const same = !!(flags & P.LOCATION_CHANGE_SAME_DOCUMENT);
      if (same) {
        if (previous && stripHash(previous) === stripHash(uri)) return;
        if (active?.kind === "hard") return;
        if (on("soft")) begin(b, "soft", uri);
      } else if (active?.browser === b && active.kind === "hard") {
        active.committed = true;
        active.global = b.browsingContext?.currentWindowGlobal;
        active.uri = uri;
        if (active.global && active.global !== active.oldGlobal && painted.has(active.global)) markReady(active);
      } else if (origin?.browser === b) {
        const s = begin(b, "hard", uri);
        if (s) {
          s.committed = true; s.global = b.browsingContext?.currentWindowGlobal;
          if (s.global && painted.has(s.global)) markReady(s);
        }
      }
    },
    onProgressChange(b, wp, request, curSelf, maxSelf, curTotal, maxTotal) {
      if (active?.browser === b && active.kind === "hard" && wp?.isTopLevel && maxTotal > 0)
        active.progress = Math.max(active.progress, clamp(curTotal / maxTotal, 0, 1));
    }
  };
  function chromePointer(event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const el = event.target?.closest?.("toolbarbutton.bookmark-item, #urlbar, #back-button, #forward-button, #reload-button");
    if (!el || !on("chrome")) return;
    if (active) finish(active,"pointer");
    remember(gb.selectedBrowser, { x: event.clientX, y: event.clientY });
  }
  function key(event) {
    if (event.key === "Escape") { cancel(); return; }
    if (event.key === "Enter" && on("chrome") && event.target?.closest?.("#urlbar")) {
      const r = document.getElementById("urlbar")?.getBoundingClientRect();
      if (r) remember(gb.selectedBrowser, { x: r.x+r.width/2, y: r.y+r.height/2 });
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
