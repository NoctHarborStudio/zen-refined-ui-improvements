# Zen Refined — UI Improvements for Zen Browser

A modular collection of visual and usability enhancements for [Zen Browser](https://zen-browser.app/). Built for native Zen, with optional integration into [OnePlane](https://github.com/NoctHarborStudio/zen-oneplane-horizontal-tabs).

**Current development preview: `0.6.0-preview.25`** · Target: Zen 1.24.2b / Sine 2.3.3.

> Preview software. Core features have been tested by the maintainer/user in Zen; compatibility across operating systems, themes and configurations is not guaranteed. Install in a test profile first.

## Available features

| Feature | What it does | Status |
| --- | --- | --- |
| **Magnetic Bookmarks** | Native bookmark magnification, smooth neighbor movement, downward expansion and spring-based liquid indicator. | User-tested |
| **Downloads Dock** | Native sidebar indicator, flight notification, edge-connected fluid reveal, recent and full downloads, live transfer data and native file actions. | Core accepted; latest wave refinement pending visual validation |
| **Smart Search** | Grouped 6+6 recent tabs and recommendations, activity timestamps, exact tab switching. | Grouped grid; live validation pending |
| **Page Progress** | Symmetric, center-out page-loading line without percentages. | User-tested |
| **Center Assembly** | One-shot startup assembly of tabs, address bar, bookmarks and controls without an opaque window cover. | Implemented; startup flash / FPS follow-up deferred |
| **Center Disassembly** | 520 ms reverse animation on the native close-window command. | User-tested |
| **Startup appearance** | Optional suppression of Gecko's blank window and Windows pre-XUL skeleton, with reversible preferences. | Implemented |

## Magnetic Bookmarks

Hover a bookmark to expand its native card downward, with neighbors making space instead of overlapping. Default magnification is 142%, duration 240 ms, with a liquid indicator and optional glow. Native labels/icons use actual sizes and pixel-aligned positioning rather than text scaling. Native clicks, folders, context menus and bookmark data are preserved. The shared controller works with OnePlane's stable background contour and suspends hover effects during its address wave.

## Downloads Dock

- Real download speed, progress and status from Gecko's Downloads API.
- Automatic flight notification followed by a 780 ms fluid wave that begins at the sidebar edge, grows from a point and reverses on close. The latest four downloads are shown first.
- **All downloads** expands the same panel into a full-height list. Sort by time or size in either direction; open completed files or show them in their folder. Optional average speed and elapsed time are available for transfers observed in the current session.
- Confirmed **Clear** removes eligible finished list entries only, not files on disk, active/partial/blocked downloads or browsing history.
- Automatic notifications dismiss after two seconds outside the card; manual interaction pins the downloads panel. Compact Mode is held only when opened through its sidebar icon, not through automatic notifications or their All downloads action.
- Mirrors left/right native placement, uses the native sidebar palette and supports an optional OnePlane host. Native Library history and other Library sections remain untouched.

## Page Progress

A small gray loading line grows symmetrically from the top center of the browser. Uses native navigation events and does not display invented percentages. The indicator is independent of the Downloads Dock.

## Smart Search

When the native address bar opens with an empty query (including Ctrl+T when Zen opens its floating search), recent active tabs appear above regular suggestions. Two grouped sections, up to six recent tabs and six native recommendations, two columns filled top-to-bottom where space permits, with chronological rails and a permanent divider. Relative activity time on the left; the active tab is included. The active tab comes first. Current workspace and Essentials receive priority when choosing the six entries; selected entries are displayed in descending activation time. Each recent result shows its title and domain, optional workspace/container identity when relevant, and the native-style action label. Selecting it uses the exact existing native tab, including OnePlane's mirrored UI. Typed search and private browsing remain unchanged. No separate history store or network requests. [Architecture](docs/smart-search.md).

## Startup and closing

**Center Assembly** (1050 ms by default) assembles real browser chrome, including the optional OnePlane tab row. The page and native background remain visible; there are no opaque startup overlays. Late script loads skip the animation instead of re-hiding the painted interface. **Center Disassembly** (520 ms) is its short reverse, with native close confirmations preserved. System shutdown, global quit and individual tab closure bypass the closing effect.

The optional placeholder suppression sets only `browser.startup.blankWindow` and `browser.startup.preXulSkeletonUI` to false and restores previous values when disabled. It does not control OS-level window animations, Mica initialization or Windhawk.

## Installation

1. Open **Settings → Sine Mods**.
2. Install the preview source below (the `main` branch is documentation only).
3. Enable the mod and restart Zen if the scripts have not loaded.

```text
NoctHarborStudio/zen-refined-ui-improvements/tree/preview
```

Sine requires permission to run JavaScript from unpublished GitHub mods. Review the [source](https://github.com/NoctHarborStudio/zen-refined-ui-improvements/tree/preview) before granting it. Zen Refined does not change that global permission or require OnePlane, Nebula, Windhawk or manual theme edits.

## Settings

All options are available through Sine. Individual modules can be disabled independently; reduced-motion preferences are respected.

| Setting | Default |
| --- | --- |
| Magnetic Bookmarks | On |
| Bookmark magnification / duration | 142% / 240 ms |
| Liquid hover indicator / glow | On / On |
| Stabilize OnePlane background | On |
| Disable Firefox startup placeholder windows (restart required) | On |
| Center Assembly / duration | On / 1050 ms |
| Center Disassembly | On |
| Download indicator / transfer statistics | On / On |
| Page loading indicator | On |
| Smart Search (6 recent + 6 recommended) | On |

## Development pipeline

The following are **planned, not available yet**:

1. **Smart Compact Mode** — intentional edge-hover and multi-monitor behavior, reusing native delay preferences where possible.
2. **Smart Context Menu** — compact organization and configurable native tab commands.
Smart Search grouped grid is implemented in preview.21; native-browser testing remains pending.

Native Zen Library already provides history search and recently closed tabs, so a separate History Dock is not planned. Other visual refinements will be based on reproducible issues. Semi-Compact Mode and startup performance investigations remain deferred.

## Compatibility & known limitations

Zen Refined is standalone; OnePlane is optional. The two mods share Magnetic Bookmarks through a per-window lease, with no runtime network dependency or duplicate controller. The startup flash reported on Windows persists after removing the mod's opaque covers; native DWM/Mica/Windhawk investigation is deferred. Actual theme compatibility, mixed-DPI monitors, keyboard accessibility, reduced motion, unload/reload and uncommon native states require broader testing. No claim of engine-wide speed improvements.

- [Roadmap](docs/roadmap.md) · [Known issues](docs/known-issues.md) · [Validation](docs/validation.md)
- [Indicator architecture](docs/indicators.md) · [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE). Independent community project, not affiliated with Zen Browser. Adaptive Page Transitions is retired; its [historical archive](legacy/adaptive-page-transitions/README.md) is not loaded.
