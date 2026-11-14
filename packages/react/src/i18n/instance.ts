import i18next, { type i18n } from "i18next";
import { en } from "./en";
import { ja } from "./ja";
import { type DeepPartial, type Messages, mergeMessages } from "./messages";

export const DBV_NS = "dbv";

const BUILTIN: Readonly<Record<string, Messages>> = { en, ja };

export type DbvResources = Readonly<Record<string, DeepPartial<Messages>>>;

// 同梱の辞書の上に、利用者の resources を言語ごとに深く結合する。同梱していない言語は resources だけで作る。
export const buildResources = (overrides: DbvResources = {}) => {
  const languages = new Set([...Object.keys(BUILTIN), ...Object.keys(overrides)]);
  return Object.fromEntries(
    [...languages].map((language) => [
      language,
      { [DBV_NS]: mergeMessages(BUILTIN[language] ?? {}, overrides[language]) },
    ]),
  );
};

// 組み込み先の i18next には触れないよう、専用のインスタンスを作る。resources をその場で渡すので、初期化は同期で終わる。
export const createDbvI18n = (options: {
  readonly language: string;
  readonly resources?: DbvResources;
}): i18n => {
  const instance = i18next.createInstance();
  void instance.init({
    lng: options.language,
    fallbackLng: "en",
    ns: [DBV_NS],
    defaultNS: DBV_NS,
    resources: buildResources(options.resources),
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance;
};
