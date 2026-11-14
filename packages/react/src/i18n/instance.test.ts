import i18next from "i18next";
import { describe, expect, it } from "vitest";
import { createDbvI18n, DBV_NS } from "./instance";

const translate = (instance: ReturnType<typeof createDbvI18n>, key: string, options?: object) =>
  String(instance.t(key, { ns: DBV_NS, ...options }));

describe("createDbvI18n", () => {
  it("language に合わせた文言を返す", () => {
    expect(translate(createDbvI18n({ language: "en" }), "filter.add")).toBe("Add condition");
    expect(translate(createDbvI18n({ language: "ja" }), "filter.add")).toBe("条件を追加");
  });

  it("language を切り替えられる", async () => {
    const instance = createDbvI18n({ language: "en" });
    await instance.changeLanguage("ja");
    expect(translate(instance, "filter.add")).toBe("条件を追加");
  });

  it("resources は同梱の辞書の上に深く結合する（上書きした文言以外は残る）", () => {
    const instance = createDbvI18n({
      language: "en",
      resources: { en: { filter: { add: "New filter" } } },
    });
    expect(translate(instance, "filter.add")).toBe("New filter");
    expect(translate(instance, "filter.remove")).toBe("Remove condition");
  });

  it("resources で言語を足せる。足りないキーは英語で補う", () => {
    const instance = createDbvI18n({
      language: "fr",
      resources: { fr: { filter: { add: "Ajouter une condition" } } },
    });
    expect(translate(instance, "filter.add")).toBe("Ajouter une condition");
    expect(translate(instance, "filter.remove")).toBe("Remove condition");
  });

  it("単数形と複数形を言語ごとの規則で選ぶ", () => {
    const en = createDbvI18n({ language: "en" });
    expect(translate(en, "grid.rowCount", { count: 1, formatted: "1" })).toBe("1 row");
    expect(translate(en, "grid.rowCount", { count: 2, formatted: "2" })).toBe("2 rows");
    expect(
      translate(createDbvI18n({ language: "ja" }), "grid.rowCount", { count: 2, formatted: "2" }),
    ).toBe("2 行");
  });

  it("値は HTML エスケープしない（DB の名前をそのまま出す）", () => {
    const instance = createDbvI18n({ language: "en" });
    expect(translate(instance, "error.connectionNotFound", { connection: "a&b<c>" })).toBe(
      'The connection "a&b<c>" was not found.',
    );
  });

  it("組み込み先のグローバルな i18next には影響しない", () => {
    createDbvI18n({ language: "ja" });
    expect(Boolean(i18next.isInitialized)).toBe(false);
    expect(i18next.language).toBeUndefined();
  });
});
