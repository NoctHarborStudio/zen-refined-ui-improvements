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
- [ ] In OnePlane, hover directly beneath the tabs: the bookmark stays below the upper row, even with maximum magnification. The resting top edge remains invariant and the expansion grows down. The reserved space is constant, not hover-dependent.
- [ ] Compact Mode reveal, no unexpected hiding when hovering expanded bookmarks; page does not shift.
- [ ] Reduced motion, light/dark themes, disable individual settings and Sine unload/reload.
- [ ] No console errors or persistent custom styles after disabling.

The implementation commits CSS margins only on a target change, then uses FLIP and native Web Animations transforms to enlarge and reposition the existing bookmark nodes. Native nodes are not reparented. A single requestAnimationFrame loop updates only the indicator transform using cached geometry. A bounded spring integration handles delayed frames. The native overflow behavior remains the responsibility of Places; the effect limits width using current available space.

Known limitations of the untested preview: native overflow measurements can vary by theme; ancestor clipping may restrict downward expansion. Any compatibility adjustments should be made in Zen Refined, not by requiring users to edit other mods.

## Startup and stable contour

- [ ] Enable startup suppression, restart fully, verify both supported native prefs are false. Disable and verify previous user/default values restore. Normal close preserves the setting; mod unload restores it when not closing.
- [ ] OnePlane: hover rapidly across bookmarks, verify the stable mask and wrapper height do not change during animation. The contour follows preferences and structural changes only when the row settles.
- [ ] Standalone Zen: top edge remains fixed, native folder menus and chevron remain usable; reduced motion and disabling restore native geometry.
- [ ] Verify real startup flash and WebRender backdrop behavior on Windows; this cannot disable external window animations.

- [ ] Verify the FLIP transform animations do not emit per-frame bookmark style-attribute mutations; confirm smooth handoff between multiple fast hover targets and freeze folder anchor while its menu is open.

## Preview.4 — FLIP

- [ ] One final layout per hover retarget; no per-frame margin/CSSOM writes. Interrupted transitions begin from measured visual positions. The previous slot is cleared before allocating a new one.
- [ ] The liquid indicator uses cached relative geometry and a fixed-size transform, not per-frame getBoundingClientRect or width/height writes.
- [ ] Check fast retargeting, native folder anchor pause, overflow, reduced motion, drag and unload; verify actual compositor eligibility and FPS in Zen. Stable OnePlane mask remains unchanged; OnePlane itself may still perform its own bounded contour calculations on structural changes.

## Preview.5 — text rasterization

- [ ] Non-enlarged neighbors use only 2D translation, with no forced will-change or descendant animations. Stationary items have no animation effect.
- [ ] Only currently or previously enlarged cards can use scaling. Retargets preserve in-flight scale on outgoing cards.
- [ ] Device-pixel-aligned margin growth never exceeds the layout budget. Translation ends at native layout; temporary effects are canceled immediately on Animation.finished, with a bounded watchdog.
- [ ] Compare native text sharpness during and after hover handoffs on Windows at different DPI settings. Gecko may still change antialiasing on translated content; real compositor testing remains necessary.

## Preview.6 — native text positioning

- [ ] No transform animation or static scale on any native bookmark/label/icon; only an empty ::before decoration may be transformed. Native text keeps its original font size.
- [ ] Relative position keyframes are aligned to whole device pixels; endpoints release to native zero offsets. Handoff and cancellation retain the current position/card progress.
- [ ] Verify stationary text and moving text during hover handoffs, at multiple Windows DPI settings. Native layout positioning can require main-thread paint, but no per-frame JS reads/writes, animated margin changes or native item resize.
- [ ] Verify pseudo-element background hit-testing, native clicks/folder popup, stable OnePlane mask, and performance on real Zen. A pseudo-element animation unavailable on a given build falls back to a static card rather than transforming text.

## Planned startup animation (not implemented)

- [ ] Investigate browser-chrome initialization, staged UI appearance and a synchronized startup reveal. Preserve existing placeholder preference restoration and respect reduced motion. Do not add artificial startup latency.

## Preview.7 — restore content magnification without text transforms

- [ ] Active label grows using actual font-size; active icon grows using actual width/height; both move down to the expanded card center. Expected for 24px row, 136% card height, 118% inner scale: center descends 4.32px and content grows up to 18%. Narrow width limits magnification.
- [ ] Outer button box stays fixed; only active and outgoing card children receive native size/position animations. Neighboring labels retain preview.6's positioning and text quality.
- [ ] Check actual label crop, icons-only/folders, native clicks, light/dark, rapid interrupted transitions and restoration of child attributes/styles on cleanup.
- [ ] Verify simultaneously on real Zen: sharp text, smooth motion, full content magnification/centering, stable background, no unexpected layout or overflow. Native child font-size animations require main-thread layout/paint; this remains a runtime performance test.
