# Smart Search — recent active tabs

First implementation: 0.6.0-preview.17. Native URL-bar provider only, not a replacement search box.

- Uses ProvidersManager.getInstanceForSap("urlbar"), a single provider lease across normal windows, and the query controller's browserWindow. It does not use the most recently focused window as a fallback.
- Runs only on a genuinely empty query with TABS source enabled, no explicit search mode or restriction, normal (non-private) window, and the native open-page preference enabled. Matches native Top Sites priority, reserving two result slots for normal suggestions.
- Reads Zen allStoredTabs (fallback gBrowser.tabs), native lastAccessed, actual workspace UUID, Essentials and container identity. Current space first; then other known spaces by recency. Lazy tabs use SessionStore's existing lazy metadata without loading the page. No database, periodic timer, or persistent tab data.
- Dynamic native selectable result, exact target token per window; stale targets (closed, moved, navigated or container changed) are rejected. Uses gBrowser.selectedTab, whose native Zen selection hook handles workspace switching. OnePlane uses the same actual tabs, not cloned cards or a separate provider.
- Default limit 4, selectable 2–6, capped by result budget. UI labels are initially English. No custom heading or full replacement of native result ranking; exact result placement and style require live validation. Native top-site suggestions may independently include the same URL.
- See validation.md. If unsupported APIs are missing, the script logs a warning and leaves native search available.

## References

- Zen 1.24.2b native Sidebar provider and Space Manager.
- Gecko UrlbarProvidersManager, UrlbarProviderTopSites, UrlbarResult, UrlbarInputBase and SessionStore lazy state.

## Preview.18 registration correction

Use the native Library's moz-src SessionStore path; the former resource alias is a fallback only. Missing lazy metadata skips unloaded entries rather than blocking registration. Runtime diagnostic in Browser Console: `window.__zenRefinedSmartSearchStatus?.()` (registration state, query eligibility and counts; no URLs or titles). A successful registration logs `[Zen Refined] Smart Search provider ready`. The actual browser still needs testing.

## Preview.19

Automatic Browser Console messages identify the provider manager, native query start, eligibility, candidate count, emission and final native result count. No typed text, URLs or titles are logged. Actual address-bar manager and controller identity are preferred, and both native tab and workspace collections are consulted. No global most-recent-window fallback.

## Preview.20

The approved 6+6 grid replaces the initial four-item limit. Only the eligible zero-prefix context budget changes, no global preferences. Native rows retain their order, click and Enter handling; CSS adds two columns and visual group labels with single-column fallback below 530px. Current tab is included, native lastSeenActive and per-window weak activation timestamps are used, and time is computed on query. Startup recovery is bounded and gated on a focused eligible input, not forced opening. Runtime visual/keyboard validation remains pending.

## Preview.21

Explicit grid coordinates preserve native DOM order and fill the left column before the right. Each group starts on a fresh grid row. The recent rail is a noninteractive CSS pseudo-element with sequential dot motion; reduced motion bypasses it. The Zen results max-height token defaults to 244px, overridden only on the grid, with a viewport limit and hidden scrollbar fallback. Tab/Shift+Tab use the native selectedRowIndex setter within the focused eligible grid, never a secondary action. No global keyboard preference changes.

Current workspace/Essentials retain priority during candidate selection, but the final six entries are sorted by activation time across both columns, with the active tab first.

## Preview.22 — first-open recommendations

Preview.21 user testing confirmed both columns, timeline and OnePlane layout, but cold startup showed only Recent tabs until reopening search. The previous recovery incorrectly stopped at the first recent result. Count native recommendations separately, listen for `topsites-refreshed` / `newtab-top-sites-changed`, and retry the focused eligible zero-prefix search with bounded delays (180/500/1000/1800ms, readiness event can expedite). Stop on successful groups, disabled Top Sites with recent results, user navigation, close, typing or exhaustion. Native results remain native; no synthetic history results or preference changes. Live cold-start confirmation pending.

## Preview.23

Timeline travel duration is 850ms per column (2.5× slower), with an 850ms delay on the second column. Easing, rails, reduced-motion behavior and native search logic are unchanged.
