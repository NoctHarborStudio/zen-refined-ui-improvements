# Magnetic Bookmarks validation

Target: Zen 1.24.2b, Sine 2.3.3. Start in a separate test profile.

- [ ] Install from the preview branch; native bookmarks appear normally until hovered.
- [ ] Hover first, middle and last bookmarks. Neighbors move smoothly; no overlap, clipping or rapid hover oscillation.
- [ ] Move between adjacent and distant bookmarks, including slowly across gaps and rapidly across multiple items. The indicator stays visible and glides from its current position without teleporting.
- [ ] Leave the bookmark group; verify the indicator fades after a brief grace period, and re-entry cancels that pending departure.
- [ ] Move within one bookmark: the indicator deviates slightly from center, not one-to-one with the pointer.
- [ ] Leave the row: all bookmarks return to their original layout and the indicator fades.
- [ ] Left/middle/right clicks, folders, context menus, native bookmark drag/drop and overflow chevron.
- [ ] Narrow window, many bookmarks, long names, icons only, separators, workspace switching.
- [ ] Standalone Zen, OnePlane preview, Nebula, Bookmark Toolbar Tweaks; no external configuration changes.
- [ ] In OnePlane, hover directly beneath the tabs: the bookmark stays below the upper row, even with maximum lift/magnification. The reserved space is constant, not hover-dependent.
- [ ] Compact Mode reveal, no unexpected hiding when hovering lifted bookmarks; page does not shift.
- [ ] Reduced motion, light/dark themes, disable individual settings and Sine unload/reload.
- [ ] No console errors or persistent custom styles after disabling.

The implementation uses CSS margins to reserve horizontal layout space and a transform to enlarge the artwork. Native bookmark nodes are not reparented. A single requestAnimationFrame loop animates the indicator only while needed. A bounded spring integration handles delayed frames. The native overflow behavior remains the responsibility of Places; the effect limits width using current available space.

Known limitations of the untested preview: native overflow measurements can vary by theme; ancestor clipping may restrict the vertical lift. Any compatibility adjustments should be made in Zen Refined, not by requiring users to edit other mods.

# Adaptive Page Transitions validation (experimental)

Enable the module explicitly in Sine. Test in Zen 1.24.2b / Sine 2.3.3, with and without OnePlane.

- [ ] Click a regular HTTP(S) link; the native request starts immediately; the aperture begins at the link if the actor is working.
- [ ] YouTube home → video, video → video, Google search result, bookmark, typed address, back/forward and reload.
- [ ] Cached/fast page, throttled 1s/3s page, 10s or stalled page: the overlay is removed by the configured deadline (default 4s); network continues.
- [ ] SPA URL changes, hash-only links, download links, redirects, error page, certificate dialog, beforeunload prompt.
- [ ] Tab switching/closing, new background tabs, repeated links, Escape, resize, Compact Mode, split view, reduced motion, disable/unload, multi-window.
- [ ] Verify the page viewport size is unchanged and overlays do not intercept input; no persistent screenshots/styles/actor after the last window unload.
- [ ] Disable snapshots: themed fallback works. Check Browser Console with debug preference enabled for start and finish timing and possible actor registration failures.
- [ ] Verify actor loads in remote content and snapshot geometry matches zoomed pages. SPA readiness and snapshot timing are heuristic; protected content may not be captured.

No browser integration testing has been performed for this preview.

## Liquid transition regression checks (preview.2)

- [ ] Click each corner of a YouTube thumbnail, a text link, and a bookmark: the drop begins at the actual click, not the element center.
- [ ] With snapshots off, no grey card or blank backdrop is ever painted; the live site is visible throughout.
- [ ] Click YouTube videos with a long/slow player initialization: prefer yt-navigate-finish when available; hard fallback remains bounded.
- [ ] Compare 60/120/180 Hz: time-based flight and reveal should have consistent duration; no width/height animation or forced per-frame layout.
- [ ] Navigate immediately after mouse-down, across origins, with a blank/failed snapshot: no late outgoing capture may replace the destination.

## Morph transition checks (preview.3)

- [ ] 700 ms nominal: light gray liquid silhouette from click, grows, turns gray, immediately expands into the live page; no center wait or extra ring animation.
- [ ] Outside the circular reveal the frozen outgoing page must remain visible, including YouTube home → watch.
- [ ] No animation on Back/Forward via toolbar, Alt+Left/Right, mouse side buttons, same-document popstate, or navigation without an explicit origin.
- [ ] Invalid snapshot, disabled capture, or missing actor: native navigation, no floating drop or gray rectangle.
- [ ] Fast and slow readiness signals: the same virtual timeline advances continuously; check 4s cap and cancellation.
- [ ] Check snapshot performance and viewport alignment at page zoom, 60/120/180 Hz, and with OnePlane.

## Preview.4 cached-frame checks

- [ ] On startup, console reports actor registration and settings; after a web page settles, diagnostics show cacheReady=true.
- [ ] Move pointer over page and click quickly; cached outgoing viewport is used even when actor input arrives late or is unavailable.
- [ ] No capture of destination may replace the outgoing frame after a URL change; cache is invalidated on tab changes and unload.
- [ ] Test without actor, with disabled capture, and with history traversal; no false history animation from cached source.

## Preview.5 verified destination / minimum duration

- [ ] Fast cached navigation: full transition never completes before 1000 ms, even when paint/network signals arrive immediately.
- [ ] Old/uniform/black destination frames do not start full reveal; two visually changed nonblank frames are required.
- [ ] Slow page: small gray aperture grows until readiness, then full reveal; deadline exit finishes by 4000 ms.
- [ ] Reddit, GitHub, YouTube home→watch, direct URL: no premature full reveal or old page inside the circle; actual browser testing required.
- [ ] Intermediate network stops/redirects and background-tab closing must not abruptly remove the effect.

## Preview.6 progressive reveal

- [ ] Fast navigation: 800 ms minimum; circle expands directly after 260 ms flight, content loads live inside; no pixel-probe delay.
- [ ] Slow navigation: live page is exposed after commitment/paint and can continue updating; smooth monotonic completion or deadline exit.
- [ ] Small geometry changes re-anchor the overlay instead of cancelling; no abrupt removal at 70%.
- [ ] Diagnostics lastResult records reason, elapsed, and progress for every exit. Native back/forward and explicit cancellation stay immediate.
- [ ] Compare live rendering on YouTube, Reddit, GitHub and Steam; actual WebRender behavior still requires browser testing.

## Preview.7 deadline regression

The deadline completion must interpolate across the reserved final interval, never jump immediately to full radius. Simulated controller checks at 60, 120 and 180 Hz verify monotonic progress, 800 ms minimum, bounded 4 s deadline, and no destination captures. Real browser validation remains necessary.

## v0.3 aperture engine

- [ ] Browser remains attached to the original `.browserStack` and viewport size is unchanged; old snapshot beneath it, dark base and shield, positive `circle()` on the browser itself.
- [ ] Radius increases without any readiness/commit/network-stop event; no outgoing pixels appear through the aperture while the shield is opaque.
- [ ] First contentful paint or actual SPA mutation releases only the dark shield, not the animation; new content continues painting inside the circle.
- [ ] Confirm live remote-browser clipping and layer order in Zen/WebRender on Reddit, GitHub, Steam and YouTube. Generic SPA mutation detection is heuristic.
- [ ] Back/forward, tab switches and module disable remove all temporary stack/browser attributes, CSS variables and sibling layers. No changes to unrelated browser styles.

### Preview.2

- [ ] Unpainted navigation uses the full slow timeline instead of a premature completion; the animation never waits at a fixed radius.
- [ ] First paint arriving after the document global changes is accepted if the committed destination matches.
- [ ] Content mutation tracking before SPA navigation is bounded to 1.8 s after input, not permanently active.
