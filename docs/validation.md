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

The implementation uses CSS margins to reserve horizontal layout space and a top-anchored transform to enlarge the artwork. Native bookmark nodes are not reparented. A single requestAnimationFrame loop animates the indicator only while needed. A bounded spring integration handles delayed frames. The native overflow behavior remains the responsibility of Places; the effect limits width using current available space.

Known limitations of the untested preview: native overflow measurements can vary by theme; ancestor clipping may restrict downward expansion. Any compatibility adjustments should be made in Zen Refined, not by requiring users to edit other mods.

## Startup and stable contour

- [ ] Enable startup suppression, restart fully, verify both supported native prefs are false. Disable and verify previous user/default values restore. Normal close preserves the setting; mod unload restores it when not closing.
- [ ] OnePlane: hover rapidly across bookmarks, verify the stable mask and wrapper height do not change during animation. The contour follows preferences and structural changes only when the row settles.
- [ ] Standalone Zen: top edge remains fixed, native folder menus and chevron remain usable; reduced motion and disabling restore native geometry.
- [ ] Verify real startup flash and WebRender backdrop behavior on Windows; this cannot disable external window animations.
