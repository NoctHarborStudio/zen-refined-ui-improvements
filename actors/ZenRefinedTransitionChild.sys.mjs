/* Zen Refined — browser-process bridge; no page injection or network access. */
export class ZenRefinedTransitionChild extends JSWindowActorChild {
  #paintObserver = null;
  #paintSent = false;
  #softCleanup = null;
  #dead = false;

  actorCreated() {
    const win = this.contentWindow;
    if (!win) return;
    try {
      this.#paintObserver = new win.PerformanceObserver(entries => {
        if (entries.getEntries().some(entry => entry.name === "first-contentful-paint")) this.#paint();
      });
      this.#paintObserver.observe({ type: "paint", buffered: true });
    } catch {}
  }

  #send(name, data = {}) {
    if (!this.#dead) {
      try { this.sendAsyncMessage(name, data); } catch {}
    }
  }

  #paint() {
    if (this.#paintSent) return;
    this.#paintSent = true;
    this.#send("Paint");
  }

  handleEvent(event) {
    if (event.type === "click") {
      if (!event.isTrusted || event.button !== 0 || event.ctrlKey || event.metaKey ||
          event.shiftKey || event.altKey || event.defaultPrevented) return;
      const win = this.contentWindow;
      const element = event.composedPath().find(n => n?.nodeType === 1 &&
        n.matches?.("a[href], area[href], [role=link]"));
      if (!element || !win || element.hasAttribute("download") ||
          (element.target && !["_self", "_top", "_parent"].includes(element.target.toLowerCase()))) return;
      const rect = element.getBoundingClientRect();
      // Never send page text, URLs, images or form contents across this bridge.
      this.#send("Origin", { x: rect.width > 0 ? rect.x : event.clientX - 12,
        y: rect.height > 0 ? rect.y : event.clientY - 12,
        w: rect.width || 24, h: rect.height || 24,
        vw: win.innerWidth, vh: win.innerHeight });
    } else if (event.type === "pageshow") {
      if (event.persisted) this.#send("Paint");
      else if (this.contentWindow?.performance?.getEntriesByName("first-contentful-paint").length) this.#paint();
    } else if (event.type === "MozAfterPaint") {
      // FCP is preferred; this handles engines which don't expose Paint Timing.
      if (!this.#paintObserver && this.document?.readyState !== "loading") this.#paint();
    }
  }

  receiveMessage(message) {
    if (message.name === "CancelSoft") { this.#softCleanup?.(); return; }
    if (message.name !== "WatchSoft") return;
    this.#softCleanup?.();
    const win = this.contentWindow;
    const doc = this.document;
    if (!win || !doc?.documentElement) return;
    const token = message.data.token;
    let timer = 0, hard = 0, raf = 0, observer, done = false;
    const start = win.performance.now();
    const cleanup = () => {
      if (done) return;
      done = true;
      win.clearTimeout(timer);
      win.clearTimeout(hard);
      win.cancelAnimationFrame(raf);
      observer?.disconnect();
      if (this.#softCleanup === cleanup) this.#softCleanup = null;
    };
    const finish = () => {
      if (done) return;
      cleanup();
      this.#send("SoftReady", { token });
    };
    const settle = () => {
      win.clearTimeout(timer);
      timer = win.setTimeout(() => {
        if (done) return;
        raf = win.requestAnimationFrame(finish);
      }, Math.max(100, 160 - (win.performance.now() - start)));
    };
    this.#softCleanup = cleanup;
    try {
      observer = new win.MutationObserver(settle);
      observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
      settle();
      hard = win.setTimeout(finish, 1100);
    } catch { finish(); }
  }

  didDestroy() {
    this.#dead = true;
    this.#paintObserver?.disconnect();
    this.#softCleanup?.();
  }
}
