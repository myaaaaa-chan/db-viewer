import type { Messages } from "./en";

export type { Messages };

export type DeepPartial<T> = {
  readonly [K in keyof T]?: T[K] extends string ? string : DeepPartial<T[K]>;
};

type Leaves<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

type WithoutPluralSuffix<K extends string> = K extends `${infer Base}_${"one" | "other"}`
  ? Base
  : K;

// t() に渡せるキー。単数形・複数形の接尾辞（_one / _other）は i18next が付けるので、キーには含めない。
export type MessageKey = WithoutPluralSuffix<Leaves<Messages>>;

type Json = { [key: string]: unknown };

const isPlainObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// 辞書の深い結合。override にある葉だけを base の上に重ねる。入力は変更しない。
export const mergeMessages = <T extends Json>(base: T, override: Json | undefined): T => {
  if (!override) return base;
  const merged: Json = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = merged[key];
    merged[key] =
      isPlainObject(current) && isPlainObject(value) ? mergeMessages(current, value) : value;
  }
  return merged as T;
};
