# Zen Refined roadmap

Baseline: `0.6.0-preview.23`. Zen Refined owns general browser UI improvements. OnePlane owns horizontal tabs and is an optional integration, not a required dependency.

## Implemented / accepted

| Feature | Status |
| --- | --- |
| Magnetic Bookmarks | Implemented; current appearance, magnification, downward expansion, text quality and hover behavior accepted in user testing. Preserve these in further work. |
| Stable OnePlane bookmark background | Implemented; keep the stable contour during hover. |
| Startup placeholder suppression | Implemented; optional Gecko preferences with restoration. |
| Center Assembly | Implemented and visually accepted. Includes floating search, tabs, bookmarks, navigation, extension and window controls. Performance issue tracked separately. |

## Accepted in user testing — 0.6.0-preview.13

- Download Indicator & Downloads Dock: accepted, including fluid wave, shared recent/full surface, source-aware native sidebar hold, sorting and transfer statistics.
- Page Progress: accepted; top center-out gray line without percentage.

## Accepted in user testing — 0.6.0-preview.14

- Center Disassembly: reverse startup assembly, 520ms, native close command remains authoritative.

## Open validation / deferred — 0.6.0-preview.15

- Center Assembly transparency: no full-window or page covers, first-paint gate, smooth interruption. The intermittent window flash remains; investigation deferred by user.
- Optional OnePlane Extension Dock integration remains future work.

## Preview.16 — Downloads wave refinement

Grow from a subpixel point at the inner sidebar boundary, keep a real painted bridge during diagonal fill, and retract along the same path. Resting spacing and source-aware hold remain unchanged. Real Zen visual validation pending.

## Backlog

### Approved next milestones — 2026-11-16

1. **Smart Compact Mode.** Improve intentional edge-hover activation, especially crossing between monitors, without replacing Zen's existing Compact Mode. First audit native `zen.view.compact.hover-hack-delay`, `zen.view.compact.sidebar-keep-hover.duration`, `zen.view.compact.toolbar-hide-after-hover.duration` and outside-window tracking; reuse native delay preferences rather than duplicate them. Prototype direction/dwell or velocity-based filtering only if needed. Respect left/right placement, multiple monitors, DPI, window snapping, fullscreen, dragging, keyboard toggles, native popup/Library holds and the accepted source-aware Downloads hold. Work standalone; coordinate with OnePlane's own hover engine when active, with no duplicate controller.
2. **Smart Context Menu.** Optional compact organization of native tab context actions, with useful icons, logical groups, rare commands in submenus and configurable visibility. Audit existing Zen 1.24.2b menus first (Zen has already simplified the sidebar context menu). Retain native command IDs/handlers, dynamic enablement, localization, keyboard access, multiselect, pinned/essential/folder/split and extension entries. No removal of security-relevant commands, confirmation bypass or cloned destructive operations. OnePlane's mirrored tabs already open native context menus; integrate through that existing path. Prototype before implementation.

3. **Smart Search — recent active tabs (first implementation in preview.17).** Add an optional MRU section to the native empty address-bar / Ctrl+T view, using existing open tab identities and last activation time rather than browsing-history ranking. Prefer the current workspace; show actual workspace/container identity and use native tab switching, not duplicate navigation. Integrate with OnePlane's horizontal tab UI without creating a second data store or provider. Preserve existing typed results, shortcuts, folders, actions, keyboard navigation, private-window isolation and native ranking outside the empty-query section. First native provider is implemented; verify result ordering, presentation, engagement and OnePlane runtime before acceptance.

### Candidate review — avoid duplicating native Zen 1.24.2b

- **Smart Search:** partially native. Empty URL bar already shows suggestions and Switch to Tab (observed in user screenshot); native September command bar update supports tab/folder search and actions. A distinct recent-active-tabs (MRU) section for empty Ctrl+T, current-space preference and explicit workspace/container identity could still be useful; the native Zen sidebar provider requires query tokens and filters to current space/Essentials, not a dedicated empty-query MRU list. Targeted recent-active-tabs provider implemented in preview.17; validation pending. [Original request](https://github.com/zen-browser/desktop/discussions/14086).
- **History Dock:** do not implement as a separate feature now. Native Library introduced in 1.23b, closed-tab filter in 1.23.1b. In 1.24.2b its history section already opens a visit in a new tab, with accelerator/middle-click background support, search, date/site sorting and closed-tab restore. Legacy history menus may still differ; only revisit a reproducible remaining problem or an explicitly requested visual integration. [Native history source](https://github.com/zen-browser/desktop/blob/1.24.2b/src/zen/library/sections/ZenLibraryHistorySection.mjs).
- **Semi-Compact Mode:** native collapsed toolbar is present; automatic expand-on-hover is a distinct optional feature and existing Zen Mods offer it. Keep as unapproved low-priority candidate; audit compatibility with new Library and actual user need before implementing, possibly as an extension of Smart Compact Mode. [Discussion](https://github.com/zen-browser/desktop/discussions/9075).
- **Visual Consistency:** existing general UI backlog, not a new blanket rewrite. Native releases already fixed several transparency, theme and Glance issues. Only address reproducible mismatches on current Zen with theme/OS-specific evidence.
- **Performance:** native Zen updates already improve startup, UI animations and memory use. Keep Center Assembly profiling deferred; OnePlane memory policy remains in its own roadmap. No claim that mod can fix engine-wide performance.
- **Startup window flash:** user still observes after preview.15; investigation deferred at user's request. Do not resume until requested; no further speculative backdrop changes.

### Center Assembly performance — deferred optimization

- Intermittent stutter and low apparent FPS, most noticeable while horizontal tabs fan out during startup.
- Keep the approved visual design, timing and sequence. Profile a real Zen cold start before selecting an optimization; separate Gecko style/layout/paint/compositing from startup initialization and OnePlane work. The exact bottleneck is not established.
- Do not change the accepted animation until this work is explicitly resumed.

### General UI improvements — original backlog

- **Page frame / blue border:** first use Zen's built-in content spacing setting (previously discussed `zen.theme.content-element-separation = 0`); do not duplicate native functionality. Revisit only if a remaining outline or frame cannot be configured natively.
- **Spacing:** identify unnecessary interface padding and margins; preserve layout and native behavior.
- **Corners:** review inconsistent or excessive rounding of browser UI surfaces.
- **Outlines:** remove or soften unnecessary decorative borders/ outlines without removing useful focus, security or state indicators.
- **Other visual refinements and animations:** open-ended backlog, not yet specified individually; choose a concrete design before implementation.

## Validation backlog (not new features)

- Real Zen testing of keyboard/navigation, bookmark folders, context menus, drag/drop, overflow, long names, different DPI, themes and window sizes.
- Standalone Zen and optional OnePlane/Nebula/Bookmark Toolbar Tweaks compatibility; startup and reduced-motion/unload cleanup.
- See [validation checklist](validation.md) and [known issues](known-issues.md).

## Retired / historical

- **Adaptive Page Transitions:** retired at the user's request after unreliable runtime behavior; inert archive in [legacy/adaptive-page-transitions](../legacy/adaptive-page-transitions/README.md). Do not restore without a new explicit decision.
- **Older black-background loading-animation experiment:** historical General prototype; not a separate committed active feature. Do not infer a new implementation requirement from it.

### Smart Search preview.18

Fix native module registration after preview.17 user report of no visible change with and without OnePlane. Real browser verification pending; do not mark accepted until results appear and switch correctly.

## Shared floating search surface — approved 2026-11-16

User screenshot shows the native central floating search near-black while OnePlane uses muted blue-gray chrome. Requested matching color/translucency in both OnePlane and standalone Zen Refined. Add theme-aware native floating URL-bar styling to the visual consistency pipeline. Refined owns the reusable surface styling; OnePlane consumes compatible toolbar tokens and provides standalone fallback if Refined is absent. One effective owner when both enabled; avoid competing opacity, blur or backdrop overrides. Use controlled translucency, theme-derived color and readable fallback if OS material is unavailable; preserve native suggestions, Smart Search, focus/security cues and keyboard navigation. Validate ordinary startup, Ctrl+T, projected workspace, dark/light themes, Nebula on/off, both standalone and combined, multi-monitor and unload. No changes to approved Center Assembly/Disassembly. Visual design queued, not implemented.

## Smart Search — preview.19 feedback and next design

User confirms native recent-tab rows now appear in standalone Zen and OnePlane. Not yet accepted: first startup search can show no suggestions until Ctrl+T/reopening; a newly activated tab only appears after leaving it; current rows mix repeated Recent tab(s) / Space labels into titles; only one regular recommendation is visible in the five-row view.

- **First open reliability:** investigate native startup/floating URL-bar initialization and first empty-query lifecycle. Make recent and native suggestions available on the first visible eligible search, including cold start/restored session and Ctrl+T. If an initial query is absent, use one bounded, lifecycle-owned native refresh once ready; do not force open the search or steal focus. Do not keep stale results, spin retries or alter typed search. The exact startup failure is not established yet.
- **Immediate MRU:** current implementation explicitly excludes gBrowser.selectedTab; this explains why the current tab cannot appear until another is selected. Record native TabSelect activation immediately, seed the initial selected tab and include the valid active tab in the list (mark Current tab / Now), except empty placeholders. Preserve native timestamps for restored tabs; actual activation wins over visit history. Refresh on the next eligible search, and if already open refresh once without disturbing input, selection or composition. No polling, no duplicate data store. Exact tab identity and private-window isolation remain required.
- **Grouped result design — awaiting user approval:** five Recent tabs followed by three Recommended native suggestions (when available). Separate subtle group headings, no repeated Recent tabs / Space text beside every title. Timestamp/relative activity at the far left of each recent row, then favicon, title and optional native action; current tab reads Now. Recommendations retain native ranking and have no invented timestamps. Keep the native view's keyboard selection and exact tab switch; group labels are not selectable. Handle identical titles without conflating real tab/container identities. Increase the result budget only for eligible zero-query Smart Search; preserve typed-query limit and native preferences elsewhere. Prototype grouping and spacing before runtime implementation.
- **OnePlane integration:** same grouped list in the horizontal expanded address view and floating search; coordinate theme-aware shared surface and layout in OnePlane roadmap. Preserve native Zen standalone behavior, no duplicate provider/controller, no regression of address wave. Visual polish is pending.
- Acceptance: first search after cold start, opening new/activated tabs immediately, 5+3 results when available, both keyboard and pointer selection, normal typed results unaffected, standalone and OnePlane. Verify actual Zen runtime and startup recovery. User wants mockup approval before visual implementation.

## Center Assembly — projected workspace window appearance

User confirms OnePlane preview.29 workspace projection and search now work, but opening a workspace by dragging it onto another monitor displays the new window without the usual appearance animation. Add this to Zen Refined's general visual improvement pipeline. Reuse the accepted Center Assembly choreography, not a second independent animation; investigate whether projection readiness, early-paint gating or window activation prevents the existing path from running. Exact cause is unverified. Distinguish chrome animation (mod-owned) from native OS window animation (not guaranteed). Coordinate with OnePlane through an optional lifecycle-owned readiness signal only if needed; Refined must continue to work standalone. Do not delay or redo native Snap, workspace selection, synchronization, transparent placeholder or floating search; no opaque full-window overlay, re-hiding painted content, duplicate animations, tab creation or focus theft. Preserve reduced-motion, cancellation/unload behavior and accepted ordinary startup/closing animation. Test active/inactive workspace projection, left/right monitors, center/side/maximize, ordinary new window and cold start, Refined with/without OnePlane. Queued; no runtime change or new Sine release.

## Smart Search preview.20 — approved grouped grid implemented

User approved up to six recent tabs and six recommended results, each 2 columns × 3 rows. Native rows stay in DOM order; headings are visual only, timing on the left, current tab included. Narrow panels use one column. Scoped query budget, immediate activation tracking and a bounded first-open recovery are implemented. The exact startup failure and actual rendering/selection still require Zen testing. OnePlane consumes the same shared native layout; its further visual polish remains queued.

## Smart Search preview.21 — chronological columns

User confirms preview.20 works; recommended entries were below the native 244px scroll cap. Implement column-major 6+6 ordering, sequential dot rails and stable separators, centered time, viewport-bounded expanded result height with no visible scrollbar, and scoped native Tab cycling. Verify standalone/OnePlane, short windows, actual geometry, keyboard navigation and reduced motion.

## Preview.22 — first-open recommendations

Preview.21 grouped visual layout and timeline accepted in Zen/OnePlane. User reports startup animation runs again; no changes requested to it or rail widths. Cold-start Recommended still missing until reopening; preview.22 corrects premature recovery and listens for native Top Sites readiness. Runtime cold-start verification pending.

## Preview.23 — Smart Search timing polish

User reports the rest of the Smart Search UI looks good. Slow timeline travel by 2.5×, preserving its sequential columns. Verify the final timing in Zen; no other runtime changes.

## Preview.24 — Center Assembly recovery and workspace transition

Allow late initial chrome startup, not established-window replay; mark previously painted controls and use a partial reveal instead of hiding them. Wait up to five seconds for OnePlane and animate late controls. Introduce explicit workspace transition API for Home/Hub with native switch ownership and bounded bookmark settlement. No full-window or page veil. OnePlane contour hold and Home keyed state updates require companion integration. Validate cold startup, projection, Home startup, repeated switching, reduced motion and unloading. Native background flicker is not confirmed fixed.

Preview.25 hardens overlapping requests and adds a 2.5s visual watchdog; OnePlane preview.38 supplies Home/Hub integration. Real cold-start and workspace runtime checks remain pending.
