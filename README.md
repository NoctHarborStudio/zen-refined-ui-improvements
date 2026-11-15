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

An optional navigation-aware liquid reveal for regular HTTP(S) pages. A neutral light-gray drop starts at the real click, grows and stretches in flight, turns gray at the center, and immediately becomes an expanding circle revealing the unscaled live destination. The old page remains visible outside the circle.

- Minimum duration: 800 ms, maximum 4000 ms by default. The drop lands after 260 ms. Expansion starts at normal speed and only slows when no first frame has appeared after 420 ms. The dark shield fades in 80 ms as soon as a first-update hint is accepted.
- Prepares a single outgoing viewport snapshot after navigation settles and refreshes it on pointer movement or scrolling; validation occurs before navigation; browser chrome inputs can also use a pre-command snapshot. No synchronous content readback on click. All snapshots are transient local memory. If no valid old frame exists, skip the transition rather than animate over the destination.
- The live browser is not clipped, restyled, resized or reparented. A static outgoing overlay has an expanding hole, and a dark shield covers only that hole until the destination's first update. First-paint, SPA/media signals, and a bounded low-resolution changed-pixel fallback can independently release the shield. Visual detection is heuristic; no full page load is required.
- Back/forward, history traversal, no explicit navigation origin, tab changes, dialogs and reduced motion use native behavior or cancel the animation.
- Off by default while experimental. Enable **Adaptive Page Transitions** in Sine preferences. Capturing is required for the effect. No screenshot is written to disk or transmitted externally.

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

Diagnostics: enable debug logging in Sine, or use `window.__zenRefinedPageTransitions?.diagnostics()` in the browser toolbox console. Startup settings are always reported to the Browser Console.
