export type ModifierLabels = { readonly copy: string; readonly run: string };

// 画面に出すキーの表記。Apple の端末は ⌘、それ以外は Ctrl。
export const modifierLabels = (platform: string): ModifierLabels =>
  /Mac|iPhone|iPad|iPod/i.test(platform)
    ? { copy: "⌘C", run: "⌘↵" }
    : { copy: "Ctrl+C", run: "Ctrl+↵" };

export const currentModifierLabels = (): ModifierLabels =>
  modifierLabels(typeof navigator === "undefined" ? "" : navigator.platform);
