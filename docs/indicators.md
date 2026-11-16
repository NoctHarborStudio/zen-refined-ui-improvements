# Indicators — architecture and implementation pipeline

## Ownership

- Zen Refined owns native downloads state and the card; it never manages OnePlane's tab layout. OnePlane may supply a connected chrome host (future lower-left Extension Dock) using `window.__zenRefinedDownloadIndicator.setHost(element)`, release via `setHost(null)`, or an element with id `oneplane-download-indicator-slot` and event `OnePlane:DownloadHostChanged`. The native view is moved, not cloned. `getSnapshot()` returns aggregate state only, without filenames or URLs.
- Standalone fallback: fixed upper-right card below window controls; right-to-left entrance and fill, speed on left, icon on right. OnePlane fallback: fixed upper-left, until its own dock is implemented. No layout reservation in either fallback.
- Page indicator belongs entirely to Zen Refined; no dependency on OnePlane. Fixed top-edge center-to-right decorative bar.

## Data and render pipeline

1. Native delayed startup → register one privacy-appropriate Downloads list view per window. Initial completed history does not animate.
2. Native add/change/remove → update only active batch records → coalesce ordinary visual updates to at most 5 Hz. State changes render immediately. Real total/current bytes, combined speed, unknown-size state; no synthetic transfer progress.
3. CSS animates opacity/transform of the card and empty fill; no per-frame JS, no progress-triggered DOM geometry reads, no polling, no new network activity. Native confusing Zen flight is visually suppressed only while the module is installed. Its internal listener may still execute; no global preference is changed.
4. Page uses one gBrowser tabs-progress listener, WeakMap per browser, selected-tab-only view. Top-level network start/stop gates the bar; actual known total-byte estimates update at most 10 Hz. Unknown totals use CSS pulse. Delay 90ms avoids flashing on instant loads; success completes and hides; failure/cancel hides without completion. Optional estimated percentage is marked approximately. No fabricated exact page load percentage.
5. Settings/unload invalidate async installation and remove listeners, observers, timers and nodes. No persistent state except Sine preferences. No page scripts, screenshots or session changes.

## Next stages

- Test in real Zen, refine sizes/positions and transition timing from user feedback.
- OnePlane Extension Dock integration after its layout is ready; use the host contract rather than a duplicate Downloads subscription.
- Consider native Library UI refinements separately; no redesign or close animation in this milestone.
- Profile actual Zen with active transfers and many tabs if frame pacing is poor. Avoid speculative optimization that changes accepted visual design.
