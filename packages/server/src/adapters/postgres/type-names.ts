// 結果の列の型は、DB が返す（dataTypeID, dataTypeModifier）を format_type に渡して名前にする。
// 同じ組は同じ名前なので、アダプターごとに覚えておき、見たことのない組だけ DB に尋ねる。
export type TypeField = {
  readonly dataTypeID: number;
  readonly dataTypeModifier: number;
};

// missing と同じ順で型名を返す。DB が答えなかったものは null
export type TypeNameLookup = (
  missing: ReadonlyArray<TypeField>,
) => Promise<ReadonlyArray<string | null>>;

const keyOf = (field: TypeField): string => `${field.dataTypeID}:${field.dataTypeModifier}`;

export const createTypeNameCache = () => {
  const names = new Map<string, string>();

  return {
    resolve: async (
      fields: ReadonlyArray<TypeField>,
      lookup: TypeNameLookup,
    ): Promise<ReadonlyArray<string | null>> => {
      const missing = new Map<string, TypeField>();
      for (const field of fields) {
        const key = keyOf(field);
        if (!names.has(key)) missing.set(key, field);
      }
      if (missing.size > 0) {
        const found = await lookup(Array.from(missing.values()));
        Array.from(missing.keys()).forEach((key, index) => {
          const name = found[index];
          if (name !== undefined && name !== null) names.set(key, name);
        });
      }
      return fields.map((field) => names.get(keyOf(field)) ?? null);
    },
  };
};
