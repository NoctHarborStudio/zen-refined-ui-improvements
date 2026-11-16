# Changelog

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
