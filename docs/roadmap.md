# Zen Refined roadmap

Baseline: `0.6.0-preview.14`. Zen Refined owns general browser UI improvements. OnePlane owns horizontal tabs and is an optional integration, not a required dependency.

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

## In development — 0.6.0-preview.14

- Center Disassembly: simple reverse startup assembly, 520ms, optional, enabled by default. Native close command remains authoritative. Real Zen runtime validation pending.
- Optional OnePlane Extension Dock integration remains future work.

## Backlog

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
