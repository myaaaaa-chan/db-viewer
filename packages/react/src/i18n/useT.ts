import type { i18n } from "i18next";
import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import { formatInteger } from "../lib/format";
import { createDbvI18n, DBV_NS } from "./instance";
import type { MessageKey } from "./messages";

export const DbvI18nContext = createContext<i18n | null>(null);

// <DbViewerProvider> の外（<ResultGrid> を単独で使う場合）で使う、英語だけの専用インスタンス。
let fallbackInstance: i18n | null = null;
const fallbackI18n = (): i18n => {
  fallbackInstance ??= createDbvI18n({ language: "en" });
  return fallbackInstance;
};

export type Translate = (
  key: MessageKey,
  values?: Readonly<Record<string, string | number>>,
) => string;

// 件数を含む文言。count で単数形・複数形を選び、桁区切りにした数を formatted に渡す。
export type TranslateCount = (
  key: MessageKey,
  count: number | string,
  values?: Readonly<Record<string, string | number>>,
) => string;

// 組み込み先の I18nextProvider は見ない。常に dbv 専用のインスタンスを明示して渡す。
export const useT = (): {
  readonly t: Translate;
  readonly tc: TranslateCount;
  readonly language: string;
} => {
  const instance = useContext(DbvI18nContext) ?? fallbackI18n();
  const { t, i18n: bound } = useTranslation(DBV_NS, { i18n: instance });
  const translate = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  return {
    t: (key, values) => translate(key, values ? { ...values } : undefined),
    tc: (key, count, values) =>
      translate(key, {
        ...values,
        count: Number(count),
        formatted: formatInteger(count, bound.language),
      }),
    language: bound.language,
  };
};
