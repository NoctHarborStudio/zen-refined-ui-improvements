# Changelog

## 0.6.0-preview.26

- Support OnePlane's adaptive centered two-row tab strip at narrow window widths. Shared Magnetic Bookmarks reads the complete native toolbar geometry and keeps the same contour and wave at any supported width. Startup and workspace animations use the active OnePlane mirror instead of the hidden Zen sidebar. Native Zen runtime validation pending.

## 0.6.0-preview.25

- Harden Center Workspace Transition against overlapping workspace requests and slow native promises. A newer request cancels the older delayed selection; a 2.5s watchdog always releases the visual gate. Add runtime-shaped lifecycle tests for phase ordering, cleanup and fallback.

## 0.6.0-preview.24

- Restore Center Assembly for late initial chrome startup without hiding already painted controls; extend readiness deadline to five seconds and include late toolbar controls/tabs. No full-window overlay.
- Add optional shared workspace transition controller for Home and Hub: collapse old chrome toward center, native switch, bounded Places settlement, reveal new chrome. Native page and background remain untouched; OnePlane integration required for explicit callers.

## 0.6.0-preview.23

- Slow the Smart Search timeline dot travel by 2.5×: 850ms per column instead of 340ms, preserving sequential timing, existing easing, layout and reduced-motion behavior. No search logic changes.

## 0.6.0-preview.22

- Fix Smart Search startup recovery prematurely completing when Recent tabs were present but native Recommended results were absent. Track both groups separately; react to native Top Sites readiness notifications and allow up to four coalesced startup refreshes while the eligible search remains focused. Do not reopen a dismissed view or disrupt typing/result navigation. No CSS or animation changes.

## 0.6.0-preview.21

- Smart Search fills columns top-to-bottom (1–3 left, 4–6 right), for both groups. Keep native DOM/selection order. Add subtle sequential timeline dots, stable column and section dividers, vertically centered timestamps and reduced-motion support.
- Override Zen's 244px result-height cap only for the active grid, bounded by viewport height with hidden scrollbar and scroll fallback in short windows. Native Tab and Shift+Tab cycle rows instead of opening search actions; ordinary typed search and Ctrl+Tab remain unchanged.

## 0.6.0-preview.20

- Implement the approved grouped Smart Search 2×3 + 2×3 layout using native selectable rows, with left-side activity timestamps and current-tab inclusion. Narrow panels fall back to one column. Preserve typed search and native recommendations; no global result-limit preference change.
- Track TabSelect immediately and clear zero-prefix cache, with bounded first-open refresh after readiness. Actual cold-start and OnePlane rendering still need validation.

## 0.6.0-preview.19

- Attach Smart Search to the actual address-bar provider manager, resolve owning windows by native identity or controller, and combine workspace and native tab collections. Automatically log count-only query eligibility, emitted rows and final native result counts; no console commands needed. Runtime display verification pending.

## 0.6.0-preview.18

- Correct the SessionStore import to the Gecko 160 path used by Zen 1.24.2b; missing optional lazy metadata no longer prevents Smart Search registration. Register immediately in an already initialized browser window and expose count-only runtime diagnostics. Real Zen verification pending.

## 0.6.0-preview.17

- First Smart Search preview: native empty-query recent-tab results, current-workspace preference, exact tab identity switching, configurable maximum, native suggestion slots reserved. Private windows and typed queries are excluded; no persistent MRU database.
- Preserve preview.16 Downloads geometry and all prior modules. Actual Zen / OnePlane integration testing pending.

## 0.6.0-preview.16

- Downloads wave now starts from a subpixel dot at the sidebar boundary, growing into a narrow connected stream. Its animated border box spans the gap; the outer mask no longer clips away an unpainted bridge. Closing reverses the same geometry, and the final resting gap is preserved.
- Smart Search (recent active tabs) approved in roadmap alongside Smart Compact Mode and Smart Context Menu. No implementation of these planned features in this release.
- Refresh project documentation and Sine description with current functionality and known limitations.

## 0.6.0-preview.15

- Remove both opaque startup veils and keep native page, window background and sidebar material visible. Animate individual chrome controls only.
- Gate startup before Gecko's first chrome paint; skip late startup rather than re-hiding an already painted interface. Bound the readiness wait to 1600ms.
- Settle interrupted active animations from current computed values over 120ms; do not forcibly hide live download/page indicators during startup.
- Center Disassembly accepted in user testing, unchanged.

## 0.6.0-preview.14

- Add optional Center Disassembly for explicit browser close-window commands: bookmarks retreat, OnePlane tabs converge, native controls fade and the address shell contracts over 520ms. Restore chrome before invoking the original native close command; never intercept OS shutdown, global quit or tab close.
- Download Indicator, Downloads Dock and Page Progress accepted in user testing; no runtime changes to those modules.

## 0.6.0-preview.13

- Separate downloads persistence from native sidebar ownership. Clicking an automatic notification, file row or All downloads keeps the downloads surface open without opening Compact Mode; only the sidebar indicator can acquire its hold.

## 0.6.0-preview.12

- Mask the fluid wave and flight at the native sidebar edge so they emerge from behind it; use a circular seed with bounded cubic control points.
- Automatic download notifications no longer hold or expand Compact Mode. Explicit clicks pin Recent downloads or full Downloads until dismissed; automatic Recent mode keeps its two-second pointer timeout.
- Keep native sidebar hold through the manual closing wave, release afterward, and avoid calculating wave paths on geometry-follow frames.

## 0.6.0-preview.11

- Republish preview.10 with a newer full UTC timestamp for Sine update detection. No runtime changes.

## 0.6.0-preview.10

- Implement the approved cubic fluid-wave contour: a connected narrow stream extends from the sidebar, then fills the panel diagonally; closing reverses the same frames, mirrored for the other side.
- Hold native Zen Compact Mode via the indicator's own panelopen attribute until the entire closing animation finishes. Preserve native/user holds and release on teardown; no global preference changes.

## 0.6.0-preview.9

- Replace the recent/full pair with one persistent downloads surface, one row cache and in-place header/sort expansion to the bottom of the viewport (12px margin).
- Two-stage fluid entrance: a small icon-sized seed travels to the far edge, then expands. Closing reverses the movement.
- Recent auto-dismiss uses a 2s pointer-only timer after reveal or pointer exit; full mode has no timer. Preserve row actions and avoid restarting an open panel on new downloads.

## 0.6.0-preview.8

- Unify recent downloads and full dock at 430 CSS px, with a shared renderer and identical per-file actions, status, progress and statistics.
- Show the latest four downloads in the recent panel, with direct Open / Show in folder actions and an All downloads handoff. Pause auto-dismiss while hovered or focused.
- Start the fluid reveal from the measured icon-sized seed, commit its closed style before animating, and align both panels at the same top anchor.

## 0.6.0-preview.7

- Resolve download reveal from the real sidebar icon; mirror it on either side and morph the dock from the detail card using matching geometry.
- Expand the dock, reserve scrollbar space and use a translucent native-painted surface.
- Add explicit native Open action for completed downloads and optional average speed / elapsed time for downloads observed in this session (on by default).

## 0.6.0-preview.3

- Make Magnetic Bookmarks a shared window-scoped controller with independent leases for Zen Refined and OnePlane. Retain existing settings and native hover animation.
- Suspend hover effects and contour recomputation during OnePlane's address wave. Resume after the wave handoff; standalone use has no dependency on OnePlane.
- Publish canonical magnetic-bookmarks.css and bookmarks.uc.mjs for byte-identical vendoring, with lease lifecycle tests.
- Preserve the download dock and page progress improvements in preview.2.

## 0.1.0-preview.3

- Bound bookmark magnification and upward translation to the available vertical space so hovered bookmarks cannot cover the navigation or tab row.
- Reserve 8 px of permanent lift space in OnePlane's two-row layout, without changing toolbar height on hover.
- Preserve the existing horizontal animation and liquid indicator.

## 0.1.0-preview.2

- Preserve the liquid indicator's current position and velocity while crossing gaps between bookmarks.
- Retarget the existing spring on the next bookmark instead of resetting its position.
- Add a short departure grace period to tolerate transient hit-test gaps during magnification.

## 0.1.0-preview.1

- Introduce Magnetic Bookmarks on native bookmark toolbar buttons.
- Animate horizontal reservation, magnification, and upward lift.
- Add a small spring-driven liquid indicator with restrained cursor-relative offset.
- Add Sine settings and lifecycle cleanup; respect reduced motion.
- Include installation instructions and runtime validation checklist.

No stable release has been published.
