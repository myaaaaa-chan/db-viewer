import { describe, expect, it } from "vitest";
import { modifierLabels } from "./platform";

describe("modifierLabels", () => {
  it("Apple の端末では ⌘ を使う", () => {
    expect(modifierLabels("MacIntel")).toEqual({ copy: "⌘C", run: "⌘↵" });
    expect(modifierLabels("iPhone")).toEqual({ copy: "⌘C", run: "⌘↵" });
  });

  it("それ以外では Ctrl を使う", () => {
    expect(modifierLabels("Win32")).toEqual({ copy: "Ctrl+C", run: "Ctrl+↵" });
    expect(modifierLabels("Linux x86_64")).toEqual({ copy: "Ctrl+C", run: "Ctrl+↵" });
  });
});
