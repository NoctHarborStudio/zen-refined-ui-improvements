# Indicators — architecture and implementation pipeline

## Ownership and placement

- Zen Refined owns Downloads state, native dock icon, transient detail card and one-shot flight. OnePlane may supply a connected chrome host via `window.__zenRefinedDownloadIndicator.setHost(element)`, release with `setHost(null)`, or expose `#oneplane-download-indicator-slot` and dispatch `OnePlane:DownloadHostChanged`. Same node, no duplicate data subscription. `getSnapshot()` exposes aggregate state only, not names/paths.
- Native Zen: mount before top sidebar controls by structural identity. Follow `zen-right-side`. Keep the icon in place during auto-hide; calculate the live inner toolbox edge from its translated DOMRect, clamp to window edge. OnePlane's optional host contract remains. Hide redundant footer Library only with native replacement.
- Card and Downloads Dock are root-level overlays. Independent positioning translate follows live inner edge with 8px clearance (6px viewport clamp); entrance/exit transform does not transition positioning. Card holds 3000ms. Click card to open the custom dock, not native Library. Dock shows active and recent native list entries, 30 at a time, Show in folder using native Download.showContainingDirectory(), close/Escape/outside click. No persistent history copy, no file launching or deletion. The transparent outside catcher deliberately consumes the first click on webpage content; sidebar stays interactive.
- Flight: one bounded 620ms WAAPI animation (760ms fail-safe) using sampled click and icon coordinates; no per-frame JavaScript, no flight for restored history or unfocused windows. Reduced motion skips flight. Card retracts after 3000ms; transfer updates never restart timer.

## Data and render pipeline

1. One native privacy-specific Downloads list view per window. Initial history ignored; active transfers restored quietly.
2. Native events update active batch, filenames from basename only (never send/store paths), actual bytes, total speed and aggregate known progress. Coalesced ordinary visual updates at most 5 Hz. No polling or geometry reads on progress. Geometry updates only for structural/side changes, card/dock open and flight start, plus bounded animation-follow frames (typically 380–520ms) while overlays are visible. During follow frames read only the actual toolbox edge; cache overlay heights and vertical position. Render order is cached until a download enters/leaves the list or changes active state. No idle polling. Temporary native flight is visually suppressed; native underlying listener may still execute.
3. Page indicator: one tabs-progress listener, WeakMap state per browser; selected tab only. Top-level network events, known byte estimates at most ~8 Hz, unknown totals use fixed partial line with soft opacity pulse. CSS scales one line from center toward both sides; no percentage label. Success extends to full and fades; errors/cancel hide without fake completion. No screenshot or page injection.
4. Disable/unload invalidates async installs and removes DOM, event listeners, observers, flight and timers. No persistent download metadata.

## Next stages

- Real Zen visual test: verify native anchor selection, sidebar hide/show, mirroring, theme colors, long filenames, flight landing, card clearance and timing. Profile if needed.
- OnePlane Extension Dock supplies host later; native Library's other sections remain unchanged; the custom Downloads Dock replaces only its download entry path.
