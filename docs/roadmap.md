# Zen Refined roadmap

Baseline: `0.5.0-preview.2`. Zen Refined owns general browser UI improvements. OnePlane owns horizontal tabs and is an optional integration, not a required dependency.

## Implemented / accepted

| Feature | Status |
| --- | --- |
| Magnetic Bookmarks | Implemented; current appearance, magnification, downward expansion, text quality and hover behavior accepted in user testing. Preserve these in further work. |
| Stable OnePlane bookmark background | Implemented; keep the stable contour during hover. |
| Startup placeholder suppression | Implemented; optional Gecko preferences with restoration. |
| Center Assembly | Implemented and visually accepted. Includes floating search, tabs, bookmarks, navigation, extension and window controls. Performance issue tracked separately. |

## In development — 0.6.0-preview.5

- Download Indicator: native sidebar icon + three-second detail card, mirrored placement and left-side OnePlane fallback, optional future Extension Dock host. Native Downloads data, live sidebar tracking and custom Downloads Dock with native Show in folder. Other Library sections deferred.
- Page Progress: top center-out gray line, no percentage. Validate actual Zen loading and tab switching before accepting.
- Integration pipeline: Zen Refined owns data/rendering; OnePlane will own the final Extension Dock placement. No new OnePlane dependency or duplicate listener.

## Backlog

### Center Assembly performance — deferred optimization

- Intermittent stutter and low apparent FPS, most noticeable while horizontal tabs fan out during startup.
- Keep the approved visual design, timing and sequence. Profile a real Zen cold start before selecting an optimization; separate Gecko style/layout/paint/compositing from startup initialization and OnePlane work. The exact bottleneck is not established.
- Do not change the accepted animation until this work is explicitly resumed.

### Center Disassembly — optional, low priority / deferred

- Explore a reverse Center Assembly for browser-window close: horizontal tabs converge or contract, buttons and bookmarks retreat, then the window disappears. Use the existing page as the visual background until the actual close.
- No implementation approved. Evaluate whether the polish is worth adding an exit delay at all. If revisited, consider an opt-in setting, reduced motion, independent Zen/OnePlane operation, and preserving native close confirmation, downloads and session behavior. Never prevent or delay emergency/OS shutdown.
- This is a window-close animation idea, not a tab-close or page-navigation effect.

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
