# Zen Refined — UI Improvements for Zen Browser

Modular visual and usability improvements for [Zen Browser](https://zen-browser.app/).

Zen Refined is independent of [OnePlane](https://github.com/NoctHarborStudio/zen-oneplane-horizontal-tabs). Use either mod or both together.

> **Development preview.** The first build targets Zen 1.24.2b and Sine 2.3.3. Native-browser runtime testing is pending.

## Magnetic Bookmarks

A responsive bookmark toolbar with smoothly expanding native bookmarks, top-anchored downward expansion and an inertial liquid indicator. The hovered bookmark reserves extra layout space so adjacent bookmarks move rather than overlap. The indicator remains anchored near the hovered bookmark's center and responds gently to the pointer inside it.

- 142% horizontal magnification by default, limited by available space.
- Downward expansion from a higher resting row, 240 ms animation, small 12–18 px indicator.
- Fixed lower reserve and a shared horizontal expansion budget. With OnePlane, a stable contour mask covers the resting row plus expansion room without changing every hover frame. A FLIP handoff commits the final bookmark slot once. Native bookmark labels/icons move via pixel-aligned relative positioning without a transform; only an empty decorative card scales downwards. The indicator uses cached geometry. The active and closing cards animate their actual XUL label font size, icon dimensions, and vertical position (up to 18% content magnification). The outer button is locked to its native dimensions during that effect, so the changing children do not resize surrounding slots. No text or icon transform is used. Registered length variables drive the same native geometry during motion and at rest, avoiding theme-cascade size jumps. Previously complete labels receive a small measured glyph-width allowance.
- A spring-based indicator stretches in flight and relaxes at rest.
- Native bookmark items, click actions and folder menus are retained.
- Reduced-motion support and individual controls in Sine.

## Startup appearance

The optional startup module suppresses Gecko's early blank window and Windows pre-XUL skeleton using `browser.startup.blankWindow` and `browser.startup.preXulSkeletonUI`. It cannot suppress OS-level window animations or guarantee removal of every white flash. Normal browser exit keeps the setting for the next launch.

## Center Assembly startup

Optional one-shot browser-chrome startup reveal, enabled by default (1050 ms; the former 760 ms default is migrated once, other selections are preserved). Real controls assemble from the center: address shell, tabs, individually staggered navigation/extension/window buttons, soft downward bookmark wave, then selected page and independently opening floating search. A temporary, scoped Gecko user stylesheet and registered animation progress override conflicting theme opacity rules; late bookmark/search nodes receive a bounded entrance instead of appearing immediately. With OnePlane 0.2.0-preview.6 or later, a per-window readiness signal and temporary Compact Mode hold coordinate the two mods. Without OnePlane, native Zen's sidebar and toolbar are animated instead. Neither mod requires the other. The native page is never navigated, captured, or injected into. A bounded wait, input/resize cancellation, reduced-motion support and unload cleanup prevent a stuck screen. The reveal starts after native chrome/workspace initialization, not after every network page finishes. Update both mods before restarting to see the coordinated version.

## Download indicator and Page Progress

The download icon sits at the top of Zen's native sidebar. A short flight lands at the icon and opens a fluid 780ms reveal from a small rounded seed into a three-second detail card with real download progress. The card follows the moving inner edge of the sidebar, including the collapsed window edge, without moving the icon itself. Clicking the card opens the new Downloads Dock, an independent themed list with file names, transfer status, progress, Show in folder, time/size sorting in both directions, confirmed Clear of finished native list entries, close button and outside-click dismissal. Clear preserves files, active, partial and blocked downloads; it does not erase Places browsing history. Card and dock use Zen's actual compact sidebar palette with a translucent surface. The dock morphs from the detail card with matching geometry, has a separate scrollbar gutter, and offers Open for completed files. Optional average speed and elapsed time are on by default; only new downloads observed in the current session have those statistics. Open is an explicit user action using Gecko's native download API. Native Library is not opened by the card. Existing native download data and file-manager integration remain unchanged; native Library's other sections are not redesigned. OnePlane's optional host contract remains available.

Page Progress expands symmetrically from the top center without percentages. Both modules use native events; the dock only samples moving sidebar geometry in a bounded animation window while visible, and transfer progress remains coalesced. See [indicator architecture](docs/indicators.md).

## Planned improvements / known issues

- **Center Assembly performance:** the accepted startup reveal still has intermittent visible frame drops/stutter, especially when the horizontal tabs fan out. Visual design is accepted; optimization is deferred. See [known issues](docs/known-issues.md).
- **Center Disassembly (optional idea):** a reverse assembly when closing a browser window. Tabs contract toward the center, surrounding controls and bookmarks retreat, then the window closes. Low-priority exploratory work; not approved for implementation yet. See [roadmap](docs/roadmap.md).
- **General UI improvements:** review page framing, spacing, corners and unnecessary outlines; prefer existing Zen settings over duplicating functionality.

See the [roadmap](docs/roadmap.md) for feature status and the [known issues](docs/known-issues.md) for confirmed observations and compatibility risks. Adaptive Page Transitions remains retired.

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

### Shared Magnetic Bookmarks

Zen Refined is the canonical source of `bookmarks.uc.mjs` and `magnetic-bookmarks.css`. OnePlane bundles the same version locally; no runtime download or dependency is needed. Both use `zen.refined.bookmarks.*` settings and a single per-window lease registry. Disabling either mod leaves the other lease active. OnePlane owns address-wave timing; the bookmark controller suspends its hover and stable-contour effects during that wave. Both updated versions are recommended for compatibility testing.
