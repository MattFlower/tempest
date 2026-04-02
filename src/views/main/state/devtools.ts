// Eruda-based developer tools toggle.
// Lazy-loads eruda on first use to avoid startup cost.

let erudaReady: Promise<typeof import("eruda")> | null = null;
let visible = false;

function getEruda() {
  if (!erudaReady) {
    erudaReady = import("eruda").then((mod) => {
      mod.default.init({
        useShadowDom: true,
        defaults: { displaySize: 50, theme: "Dark" },
      });
      mod.default.hide();
      return mod;
    });
  }
  return erudaReady;
}

export async function toggleDevTools() {
  const eruda = await getEruda();
  if (visible) {
    eruda.default.hide();
  } else {
    eruda.default.show();
  }
  visible = !visible;
}
