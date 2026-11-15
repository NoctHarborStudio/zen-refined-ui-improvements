/* Shared registration; last browser window unload unregisters the actor. */
const NAME = "ZenRefinedRegionalReveal";
const BASE = "chrome://sine/content/9d788b55-d497-41da-8444-993c603e89e4/actors/";
let users = 0;
export function acquireTransitionActor() {
  if (!users) {
    ChromeUtils.registerWindowActor(NAME, {
      parent: { esModuleURI: BASE + "ZenRefinedRegionalRevealParent.sys.mjs" },
      child: {
        esModuleURI: BASE + "ZenRefinedRegionalRevealChild.sys.mjs",
        events: {
          DOMWindowCreated: { capture: true },
          pointerdown: { capture: true, mozSystemGroup: true },
          pointermove: { capture: true, mozSystemGroup: true },
          scroll: { capture: true },
          click: { capture: true, mozSystemGroup: true },
          pageshow: { capture: true },
          popstate: { capture: true },
          DOMContentLoaded: { capture: true }
        }
      },
      allFrames: false,
      matches: ["http://*/*", "https://*/*"]
    });
  }
  users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--users === 0) ChromeUtils.unregisterWindowActor(NAME);
  };
}

export class ZenRefinedRegionalRevealParent extends JSWindowActorParent {
  receiveMessage(message) {
    const browser = this.manager.browsingContext.top.embedderElement;
    if (!browser || this.manager !== browser.browsingContext?.currentWindowGlobal) return;
    browser.ownerGlobal?.__zenRefinedPageTransitions?.receive?.(browser, this.manager, message);
  }
}
