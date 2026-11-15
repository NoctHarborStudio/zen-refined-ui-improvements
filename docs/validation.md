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
