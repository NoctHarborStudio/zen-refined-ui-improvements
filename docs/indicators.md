# Indicators — architecture and implementation pipeline

## Ownership and placement

- Zen Refined owns Downloads state, native dock icon, transient detail card and one-shot flight. OnePlane may supply a connected chrome host via `window.__zenRefinedDownloadIndicator.setHost(element)`, release with `setHost(null)`, or expose `#oneplane-download-indicator-slot` and dispatch `OnePlane:DownloadHostChanged`. Same node, no duplicate data subscription. `getSnapshot()` exposes aggregate state only, not names/paths.
- Native Zen: find the actual sidebar group containing the menu or Library (top/bottom/foot buttons), insert before the group, outside CustomizableUI's widget list. Follow sidebar side preference. When sidebar is hidden, use a small fixed edge fallback during a transfer, flight or open card. OnePlane's left fallback remains until its own dock exists. No changes to native controls.
- Card is a root-level overlay, anchored inward from icon with 14px separation and viewport clamping. Colors inherit toolbar/arrowpanel theme tokens. Icon persists in native dock even when idle; speed is shown during transfer, and last result remains available in the native dock. Click icon to toggle card, click card to open native Library or Downloads.
- Flight: one bounded 620ms WAAPI animation (760ms fail-safe) using sampled click and icon coordinates; no per-frame JavaScript, no flight for restored history or unfocused windows. Reduced motion skips flight. Card retracts after 3000ms; transfer updates never restart timer.

## Data and render pipeline

1. One native privacy-specific Downloads list view per window. Initial history ignored; active transfers restored quietly.
2. Native events update active batch, filenames from basename only (never send/store paths), actual bytes, total speed and aggregate known progress. Coalesced ordinary visual updates at most 5 Hz. No polling or geometry reads on progress. Layout work only for structural/side changes, card open and flight start. Temporary native flight is visually suppressed; native underlying listener may still execute.
3. Page indicator: one tabs-progress listener, WeakMap state per browser; selected tab only. Top-level network events, known byte estimates at most ~8 Hz, unknown totals use fixed partial line with soft opacity pulse. CSS scales one line from center toward both sides; no percentage label. Success extends to full and fades; errors/cancel hide without fake completion. No screenshot or page injection.
4. Disable/unload invalidates async installs and removes DOM, event listeners, observers, flight and timers. No persistent download metadata.

## Next stages

- Real Zen visual test: verify native anchor selection, sidebar hide/show, mirroring, theme colors, long filenames, flight landing, card clearance and timing. Profile if needed.
- OnePlane Extension Dock supplies host later; native Library redesign deferred.
