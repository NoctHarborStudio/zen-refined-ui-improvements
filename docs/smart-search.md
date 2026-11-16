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
