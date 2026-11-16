# Zen Refined — UI Improvements for Zen Browser

Modular visual and usability improvements for [Zen Browser](https://zen-browser.app/).

Zen Refined is independent of [OnePlane](https://github.com/NoctHarborStudio/zen-oneplane-horizontal-tabs). Use either mod or both together.

> **Development preview.** The first build targets Zen 1.24.2b and Sine 2.3.3. Native-browser runtime testing is pending.

## Magnetic Bookmarks

A responsive bookmark toolbar with smoothly expanding native bookmarks, top-anchored downward expansion and an inertial liquid indicator. The hovered bookmark reserves extra layout space so adjacent bookmarks move rather than overlap. The indicator remains anchored near the hovered bookmark's center and responds gently to the pointer inside it.

- 142% horizontal magnification by default, limited by available space.
- Downward expansion from a higher resting row, 240 ms animation, small 12–18 px indicator.
- Fixed lower reserve and a shared horizontal expansion budget. With OnePlane, a stable contour mask covers the resting row plus expansion room without changing every hover frame. A FLIP handoff commits the final bookmark slot once. Native bookmark labels/icons move via pixel-aligned relative positioning without a transform; only an empty decorative card scales downwards. The indicator uses cached geometry. Native font size is retained to avoid resampling glyphs. The animation does not resize native bookmark nodes on each frame.
- A spring-based indicator stretches in flight and relaxes at rest.
- Native bookmark items, click actions and folder menus are retained.
- Reduced-motion support and individual controls in Sine.

## Startup appearance

The optional startup module suppresses Gecko's early blank window and Windows pre-XUL skeleton using `browser.startup.blankWindow` and `browser.startup.preXulSkeletonUI`. It cannot suppress OS-level window animations or guarantee removal of every white flash. Normal browser exit keeps the setting for the next launch.

## Planned improvements / known issues

- **Startup animation:** the native browser currently appears in stages while its chrome and mods initialize. The placeholder-suppression option removes some early windows, but does not provide a coordinated startup animation. Planned: a polished, unified startup reveal after the browser chrome has initialized, without delaying actual startup or reintroducing a white flash. Investigate Gecko/Sine initialization order, reduced motion, and interaction with OS animations. Not implemented in this preview.
- **Bookmark text rendering:** animated transforms on text-bearing native nodes can cause blur or glyph shimmer in Gecko/WebRender. Preview.6 removes those transforms from Magnetic Bookmarks. Actual Windows rendering and performance remain to be validated.

## Install the preview in Sine

In **Settings → Sine Mods**, install the GitHub source:

```text
NoctHarborStudio/zen-refined-ui-improvements/tree/preview
```

Enable the mod, then restart Zen if the script has not loaded. Magnetic Bookmarks is enabled by default. Use a test profile first.

Sine requires explicit permission to run JavaScript from unpublished GitHub mods. Review [bookmarks.uc.mjs](https://github.com/NoctHarborStudio/zen-refined-ui-improvements/blob/preview/bookmarks.uc.mjs) before granting that permission. This is a global Sine setting; Zen Refined never changes it. No manual Zen or Nebula preference edits are needed.

## Configuration

All settings are available in the mod's Sine preferences. Disable Magnetic Bookmarks to restore the native bookmarks appearance. Disable or remove Zen Refined to unload its modules. **Disable Firefox startup placeholder windows** is enabled by default; it sets the two supported native startup preferences to false and preserves their previous state. Changes apply on the next full restart. Turn it off to restore the original settings. It does not modify Windows or Windhawk. **Stabilize OnePlane background during bookmark hover** is independently configurable.

## Compatibility

The implementation works on existing native toolbar items and does not alter OnePlane, the tab strip, bookmark data or other mods. Actual compatibility with OnePlane, Nebula, Bookmark Toolbar Tweaks, folders, overflow, and browser customization still requires testing. When width is limited, magnification is reduced rather than intentionally forcing items into the overflow menu.

See the [validation checklist](https://github.com/NoctHarborStudio/zen-refined-ui-improvements/blob/preview/docs/validation.md).

## License

[MIT](LICENSE). Independent community project, not affiliated with Zen Browser.

## Legacy

Adaptive Page Transitions was retired due to unreliable rendering across websites. Its earlier experimental implementation is archived in [legacy/adaptive-page-transitions](legacy/adaptive-page-transitions/README.md) and is not loaded by Zen Refined.
