// Eruda-based developer tools, docked as an inline bottom pane.
//
// Layout: [ViewModeBar] / [main content] / [eruda pane] / [UsageFooter].
//
// `inline: true` makes eruda's dev-tools panel `position: static` inside
// its own `.eruda-container` root. The panel's descendants still use
// `position: absolute`, so a positioned ancestor is required. Eruda's
// `:host { all: initial }` shadow-root rule wipes any `position` set on
// the host itself — even inline `!important` styles appear to be reset.
// So `App.tsx` puts `position: relative` on the *wrapper* of the host
// instead; eruda leaves that element alone, and the dev-tools panel
// uses it as its containing block, filling the 50vh pane.

import { useStore } from "./store";

let eruda: typeof import("eruda") | null = null;
let erudaLoading: Promise<typeof import("eruda")> | null = null;

async function initEruda(container: HTMLElement) {
  if (eruda) return eruda;
  if (!erudaLoading) {
    erudaLoading = import("eruda").then((mod) => {
      mod.default.init({
        container,
        inline: true,
        useShadowDom: true,
        defaults: { theme: "Dark" },
      });
      eruda = mod;
      return mod;
    });
  }
  return erudaLoading;
}

export async function mountDevTools(container: HTMLElement) {
  await initEruda(container);
}

export function toggleDevTools() {
  const { devtoolsVisible, setDevtoolsVisible } = useStore.getState();
  setDevtoolsVisible(!devtoolsVisible);
}
