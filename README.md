# Zen Refined — UI Improvements for Zen Browser

Modular visual and usability improvements for [Zen Browser](https://zen-browser.app/).

Zen Refined is independent of [OnePlane](https://github.com/NoctHarborStudio/zen-oneplane-horizontal-tabs). Use either mod or both together.

> **Development preview.** The first build targets Zen 1.24.2b and Sine 2.3.3. Native-browser runtime testing is pending.

## Magnetic Bookmarks

A responsive bookmark toolbar with smoothly expanding native bookmarks, a subtle upward lift and an inertial liquid indicator. The hovered bookmark reserves extra layout space so adjacent bookmarks move rather than overlap. The indicator remains anchored near the hovered bookmark's center and responds gently to the pointer inside it.

- 142% horizontal magnification by default, limited by available space.
- 6 px upward lift, 240 ms expansion, small 12–18 px indicator.
- A spring-based indicator stretches in flight and relaxes at rest.
- Native bookmark items, click actions and folder menus are retained.
- Reduced-motion support and individual controls in Sine.

## Adaptive Page Transitions (experimental)

An optional, navigation-aware reveal for regular HTTP(S) pages. A clicked link or bookmark is the origin of an expanding card when available. The outgoing page is captured in memory if Firefox permits it; the new page is revealed at its normal viewport size through a growing aperture. Navigation itself is not intercepted or delayed.

- Uses top-level web-progress and first-contentful-paint signals where available.
- Same-document navigation uses a bounded DOM-settling heuristic; it is not an exact measurement of SPA readiness.
- Finishes immediately for very fast loads or with a short final reveal when content is ready; a strict 4-second default cap removes the overlay even if loading continues.
- Cancels on tab selection, resize, Escape, dialogs, disabling or reduced-motion.
- If the content actor or snapshot is unavailable, uses a centered/themed fallback and native progress events. Some foreground new tabs and in-page interactions are intentionally not animated.
- Off by default while experimental. Enable **Adaptive Page Transitions** in Sine's mod preferences. No page contents, screenshots or browsing history are stored or transmitted.

Review [transitions.uc.mjs](transitions.uc.mjs) and [actors](actors/) before enabling. Runtime verification in Zen/Sine is pending.

## Install the preview in Sine

In **Settings → Sine Mods**, install the GitHub source:

```text
NoctHarborStudio/zen-refined-ui-improvements/tree/preview
```

Enable the mod, then restart Zen if the script has not loaded. Magnetic Bookmarks is enabled by default; Adaptive Page Transitions is opt-in. Use a test profile first.

Sine requires explicit permission to run JavaScript from unpublished GitHub mods. Review [bookmarks.uc.mjs](https://github.com/NoctHarborStudio/zen-refined-ui-improvements/blob/preview/bookmarks.uc.mjs) before granting that permission. This is a global Sine setting; Zen Refined never changes it. No manual Zen or Nebula preference edits are needed.

## Configuration

All settings are available in the mod's Sine preferences. Disable Magnetic Bookmarks to restore the native bookmarks appearance. Disable Adaptive Page Transitions to restore ordinary page navigation. Disable or remove Zen Refined to unload both modules.

## Compatibility

The implementation works on existing native toolbar items and does not alter OnePlane, the tab strip, bookmark data or other mods. Actual compatibility with OnePlane, Nebula, Bookmark Toolbar Tweaks, folders, overflow, and browser customization still requires testing. When width is limited, magnification is reduced rather than intentionally forcing items into the overflow menu.

See the [validation checklist](https://github.com/NoctHarborStudio/zen-refined-ui-improvements/blob/preview/docs/validation.md).

## License

[MIT](LICENSE). Independent community project, not affiliated with Zen Browser.
