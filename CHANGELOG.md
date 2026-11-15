# Changelog

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
