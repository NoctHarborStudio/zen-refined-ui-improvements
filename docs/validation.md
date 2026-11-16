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

## Startup animation design (implemented in 0.5 preview)

- [ ] Investigate browser-chrome initialization, staged UI appearance and a synchronized startup reveal. Preserve existing placeholder preference restoration and respect reduced motion. Do not add artificial startup latency.

## Preview.7 — restore content magnification without text transforms

- [ ] Active label grows using actual font-size; active icon grows using actual width/height; both move down to the expanded card center. Expected for 24px row, 136% card height, 118% inner scale: center descends 4.32px and content grows up to 18%. Narrow width limits magnification.
- [ ] Outer button box stays fixed; only active and outgoing card children receive native size/position animations. Neighboring labels retain preview.6's positioning and text quality.
- [ ] Check actual label crop, icons-only/folders, native clicks, light/dark, rapid interrupted transitions and restoration of child attributes/styles on cleanup.
- [ ] Verify simultaneously on real Zen: sharp text, smooth motion, full content magnification/centering, stable background, no unexpected layout or overflow. Native child font-size animations require main-thread layout/paint; this remains a runtime performance test.

## Preview.8 — native content continuity and crop

- [ ] Compare computed icon width/height and label font-size immediately before and after Animation.finished, including a conflicting theme !important width. No jump. Animation and settled geometry consume the same registered custom properties.
- [ ] Short complete labels (DeepL, ChatGPT, Mail) never acquire ellipsis merely due to hover; intrinsically cropped long labels still obey native width limits. Check real XUL label metrics at several DPI settings.
- [ ] Verify outgoing content, rapid reversals, existing inline styles and their original priorities restore on unlock, reduced motion, and no changes to neighbor transforms or background.

## 0.5.0-preview.1 — Center Assembly

- [ ] Both mods, cold start: ready handshake, address from center, horizontal tab fan, downward bookmark entry, page reveal; Compact Mode resumes normal behavior afterward.
- [ ] Zen Refined alone: native sidebar/toolbar, no required OnePlane. OnePlane alone: unchanged normal startup. Old OnePlane: visible layout fallback or fail-open.
- [ ] Slow or rejected native initialization, absent/missing controls, unload, resize, pointer/key/wheel input, disabled setting, reduced motion, multiple windows, hot reload: no retained overlay, hold, or animation effects.
- [ ] Actual Zen/Sine cold-start timing, floating new-tab search/popover, restored sites, persistent and Compact Mode, narrow window, split groups and island mode. No page load waiting, no screenshot, no changes to session or browser preferences.

## 0.5.0-preview.2 — softer assembly and full chrome coverage

- [ ] Default 1050 ms; migrate the former 760 ms default once, preserve other choices, allow 760 ms to be selected again. Tab fan, edge controls, bookmark wave and floating search have distinct overlapping timing.
- [ ] Real floating #urlbar reveals independently without overwriting its native positioning. Verify the top-layer popup and late `zen-newtab`/`zen-floating-urlbar` attributes.
- [ ] Navigation, compact/sidebar, extensions, page actions and actual minimize/maximize/close controls animate once, without nested parent/child effects. Disabled opacity and original inline styles restore.
- [ ] Important theme declarations do not block progress-driven reveal. Late Places children receive their own animation; bounded cleanup restores all unowned styles and releases the panel hold on input/unload/timeout.

- [ ] Confirm temporary sheet uses Gecko USER_SHEET (same cascade origin as Sine), and author/user-important theme declarations cannot prevent the reveal. Verify temporary sheet removal and original attributes/styles after animation or cancellation.

- [ ] Native CSS transitions are temporarily disabled only for an animated element, so they do not chase the animated progress value. Native transitions are restored at effect completion.

## Deferred follow-up — user testing of 0.5.0-preview.2

- Visual Center Assembly design accepted; intermittent frame drops during tab fan-out remain a [known issue](known-issues.md). Optimization is deferred, not completed.
- When resumed, capture a real cold-start performance profile and validate frame pacing without altering the accepted visual sequence.
- Reverse window-close assembly is an optional deferred [roadmap idea](roadmap.md), not an implemented feature or a current validation requirement.

## 0.6.0-preview.1 — download and page indicators

- [ ] Start Steam installer download; card enters right to left in standalone Zen, shows real transfer rate and progress, opens native downloads on click. Unknown length, concurrent downloads, fast completion, cancel, failure, initial history, private/public isolation.
- [ ] With OnePlane active, temporary left fallback; later dock host can reparent the same card. Toggle OnePlane, Compact Mode, settings, resize, unload. Native Library stays unchanged.
- [ ] Page loads: slow, fast, cached, redirects, error/abort, selected/background tab switching, SPA navigation, split view; no false 100% on canceled requests. Unknown length pulse; estimated percentage optional. Line is click-through and independent of toolbar visibility.
- [ ] Verify actual frame pacing, no repeated JS timers while idle, no progress-driven layout reads, listeners and observers removed on disable/unload.

## 0.6.0-preview.2 — dock indicator and symmetrical progress

- [ ] Native Zen sidebar on left/right, actual top/bottom menu group, expanded/collapsed/Compact Mode; dock icon above native controls, no overlap. Check theme tokens in light/dark/custom gradients.
- [ ] Start download from a real click: 620ms curved flight lands on dock icon, detail card opens inward with clearance, 3000ms hold then retracts. Clicking icon reopens; card opens native downloads. Very fast files, multiple downloads, cancellation, unknown total, private windows, history replay and reduced motion.
- [ ] OnePlane fallback and host contract; resize, side preference, hot reload/unload, no duplicate nodes/listeners. Verify no progress-triggered geometry reads.
- [ ] Page bar grows from center symmetrically; slower interpolation, unknown opacity pulse, no percentage, success/cancel and tab switching.

## Shared Magnetic Bookmarks (0.6.0-preview.3)

Test Refined only, OnePlane only, both installation/load orders, both disable orders and Sine hot reload. Confirm exactly one #zr-bookmark-indicator and one shared controller per window. Existing zen.refined.bookmarks settings persist. Verify no hover retarget while OnePlane address-wave attribute is present, native bookmark text and folder actions, reduced motion and cleanup. Registry lease logic tested with stubs; actual Zen runtime remains unverified.

Run `node --test tests/shared-bookmarks.test.mjs` for the shared lease regression tests. When mixing a new shared build with a legacy build, update both; disabling the last shared copy after it replaced a legacy controller can require restarting the remaining legacy mod.

## 0.6.0-preview.4 — native top placement and idle state

- [ ] Native sidebar on either side: icon above top controls, not footer. Hide/show or scroll sidebar: same node/parent, no jump to top-edge fallback. Verify last visible notification anchor.
- [ ] Fresh idle, completed, canceled: no dock speed/progress strip; normal download glyph. Empty card has no progress strip. Native footer Library is hidden only with active native dock, still available from details card; disable/customize restores it.
- [ ] OnePlane fallback and host remain unchanged; page progress, startup and bookmarks unchanged.

## 0.6.0-preview.5 — live sidebar anchoring and Downloads Dock

- [ ] Native compact right/left: card follows actual translated toolbox edge during reveal/hide; no stale floating position, soft entrance/exit. No continuous idle frame loop. Verify click target and clipping in real Zen.
- [ ] Card opens custom Downloads Dock, not Library. Native list hydration, active-first ordering, 30-item paging, live row updates, Show in folder using native method, empty/error state, close/Escape/outside click. No private/public mixing or file launching/deletion. Native Library other sections unchanged.
- [ ] Toggle module, OnePlane host, resize, unload during open/closing; remove all DOM/listeners/timers/frames. Page Progress and shared bookmarks unchanged.

## 0.6.0-preview.6 — fluid notification, native palette and dock controls

- [ ] Card grows from small rounded edge seed into full card over 780ms, then contents fade in; reverses without text scaling. 780ms flight, existing 3s hold, edge tracking and reduced motion retained.
- [ ] Theme matches actual Zen sidebar in light/dark, custom gradients and Compact Mode. Confirm sampled theme tokens from toolbox, not generic arrowpanel gray.
- [ ] Time/size ascending/descending, unknown size last, active first; order cache invalidated only when relevant values change. Clear replaces header with Yes left/No right; No/Escape restore, Yes removes finished eligible list entries only, keeps active/partial/blocked and disk files. Confirm native list persistence, private/public isolation and cleanup on unload during clear.

## 0.6.0-preview.14 — Center Disassembly

- [ ] Click the native window close button in standalone Zen and with OnePlane. Visible chrome retreats while page stays in place; one original close command runs after 520ms.
- [ ] Native multiple-tab warning and beforeunload cancellation: confirm the browser remains fully usable and all temporary effects are removed. Accept native close normally. No changes to session restore or warning preferences.
- [ ] Ctrl+Shift+W, second close click, global quit, OS shutdown, reduced motion, disable during animation, multiple windows, startup overlap and Sine unload. No stuck styles or delayed shutdown.

## 0.6.0-preview.15 — transparency-safe Center Assembly

- [ ] Cold start and new browser window with Windows Mica/acrylic, Windhawk on/off, Zen alone and OnePlane: no opaque overlay or change to native backdrop; page stays visible. Late Sine load skips animation rather than hiding already painted controls.
- [ ] Interrupt during waiting, active motion and settling (click, key, resize, timeout, disable, unload). No window-wide flash, no retained effects or hold. Normal reduced-motion bypass and native controls remain usable.
- [ ] Confirm startup placeholder preferences, Downloads, Page Progress and Center Disassembly remain unchanged.

## 0.6.0-preview.16 — edge-connected Downloads wave

- [ ] Native right/left sidebar, shown/hidden Compact Mode, manual and automatic entry: first visible motion emerges as a growing point at the boundary, no floating strip or square cut-off gap. Close reverses to the same point.
- [ ] Full/recent modes, sidebar moving during entry, interruption, reduced motion, OnePlane host/fallback, narrow widths and light/dark theme: unchanged resting geometry, correct mask and user-origin hold. Confirm real Gecko painting outside the resting dock box.

## 0.6.0-preview.17 — Smart Search

- [ ] Native Zen and OnePlane: Ctrl+T/empty URL bar shows MRU before native suggestions, arrow/Enter and click switch the exact tab, identical URLs/containers remain distinct. No new duplicate tab navigation.
- [ ] Current space, Essentials, other spaces, lazy/unloaded, pinned/folders/split, closed/moved/navigated targets, private and multiple windows, native open-tab suggestions disabled, typed search/explicit search mode, Sine unload/reload and preference changes.
- [ ] Check actual provider priority, row rendering, native keyboard selection, workspace transition, no network preloading and no duplicate provider after multiple window lifecycles.

- [ ] Preview.18: verify `[Zen Refined] Smart Search provider ready` and `window.__zenRefinedSmartSearchStatus?.()` in Browser Console after opening an empty address bar. Verify actual rows, not just successful import.

## Preview.20 Smart Search grid

- [ ] Cold start first floating search, active/new tab before leaving it, 6+6 native results when available, missing results, narrow / wide, OnePlane and standalone. Native Tab/arrow/Enter/mouse still choose correct tab; type text to exit grid. Check no focus stealing after Escape and no private results. Verify settings toggle/unload removes layout and query wrapper.

- [ ] Preview.21: all six recommended entries visible at ordinary desktop height, column order 1–3 left / 4–6 right for both groups, sequential rails, stable dividers, centered time. Check Tab/Shift+Tab/Enter, Ctrl+Tab, typed search, narrow and short viewport, reduced motion and both Zen and OnePlane.

- [ ] Preview.22: cold start, leave first floating search open; Recent may arrive first, Recommended should populate without Ctrl+T/reopen when native Top Sites are ready. Check disabled native suggestions, no results, close, typing, Tab selection, and bounded retries. Approved styling and startup animation remain unchanged.
