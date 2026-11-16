# Zen Refined known issues

Baseline: `0.6.0-preview.15`. Distinguish reported behavior from compatibility risks and unverified causes.

## Confirmed in user testing

### Startup window flash

- Reported: intermittent opaque-to-transparent window flash at startup. The two opaque Zen Refined startup overlays were a concrete candidate, not a measured Windows root cause.
- Preview.15 removes both, skips after the first chrome paint and settles interrupted effects without changing native materials. Real Windows/Zen/Windhawk verification remains pending.
- Native window creation, DWM, Gecko before Sine loads and external Windhawk behavior are outside the mod's control.

### Center Assembly — intermittent startup stutter / low apparent FPS

- **Observed:** the startup animation is visually accepted, but occasional frame drops remain noticeable, particularly during the horizontal tab fan-out.
- **Status:** known issue; optimization deferred at the user's request. No measured FPS or profiler trace is available yet.
- **Scope:** browser-window startup with Center Assembly and OnePlane. Do not assume the root cause is known.
- **When resumed:** profile Gecko startup, style/layout, painting, WebRender composition, and concurrent OnePlane initialization. Retain the accepted animation design rather than replacing it merely to improve FPS.

## Limitations and risks (not newly confirmed defects)

- **Early startup:** Sine cannot intercept the native window before scripts load. Center Assembly animates browser chrome, not the OS window; delayed initialization can cause fallback to normal startup. Gecko placeholder suppression cannot guarantee removal of OS-level flashes.
- **Bookmark text rendering:** transformed text can blur or shimmer in Gecko/WebRender. The current native-size bookmark implementation was accepted after the prior fixes. Keep this as a regression risk, not an active report of broken text.
- **Runtime compatibility:** other themes/mods, overflow, native menus, DPI, reduced motion, unload and less common startup states still need broader validation. See [validation checklist](validation.md).

## Deferred design idea

A reverse browser-window closing animation is not a known defect and is tracked only in the [roadmap](roadmap.md).

### Floating search color/translucency

User reports near-black native search inconsistent with blue-gray toolbar; shared design approved in both roadmaps. Deferred implementation; preserve native search behavior.

### Smart Search registration on preview.17

User console confirms legacy resource:///modules/sessionstore/SessionStore.sys.mjs import failed on Zen 1.24.2b while installed Refined is .17. Already addressed by .18 using canonical moz-src module and optional fallback. Actual .18 registration/results require user confirmation. Do not infer a new .18 failure from the .17 log.

### Center Assembly — missing appearance animation on projected workspace

- Observed: user reports OnePlane preview.29 opens the workspace correctly on another monitor but the normal appearance animation does not play.
- Status: confirmed user report, queued in roadmap. Root cause not established; inspect startup/first-paint/activation integration before changing code. Existing approved Center Assembly design and native projection behavior must be preserved.
