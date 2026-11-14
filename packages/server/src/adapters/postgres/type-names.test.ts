import { describe, expect, it, vi } from "vitest";
import { createTypeNameCache, type TypeField } from "./type-names";

const field = (dataTypeID: number, dataTypeModifier = -1): TypeField => ({
  dataTypeID,
  dataTypeModifier,
});

const namesOf = (fields: ReadonlyArray<TypeField>) =>
  fields.map(({ dataTypeID, dataTypeModifier }) => `t${dataTypeID}/${dataTypeModifier}`);

describe("createTypeNameCache", () => {
  it("フィールドの順に型名を返し、同じ（oid, typmod）は 1 回だけ DB に尋ねる", async () => {
    const lookup = vi.fn(async (missing: ReadonlyArray<TypeField>) => namesOf(missing));
    const cache = createTypeNameCache();
    const fields = [field(23), field(1043, 259), field(23)];
    expect(await cache.resolve(fields, lookup)).toEqual(["t23/-1", "t1043/259", "t23/-1"]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup.mock.calls[0]?.[0]).toEqual([field(23), field(1043, 259)]);
  });

  it("2 回目以降は、覚えているものを DB に尋ねない", async () => {
    const lookup = vi.fn(async (missing: ReadonlyArray<TypeField>) => namesOf(missing));
    const cache = createTypeNameCache();
    await cache.resolve([field(23), field(25)], lookup);
    lookup.mockClear();
    expect(await cache.resolve([field(25), field(23)], lookup)).toEqual(["t25/-1", "t23/-1"]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("oid が同じでも typmod が違えば、別の型名（varchar(10) と varchar(255)）として尋ねる", async () => {
    const lookup = vi.fn(async (missing: ReadonlyArray<TypeField>) => namesOf(missing));
    const cache = createTypeNameCache();
    await cache.resolve([field(1043, 14)], lookup);
    lookup.mockClear();
    expect(await cache.resolve([field(1043, 14), field(1043, 259)], lookup)).toEqual([
      "t1043/14",
      "t1043/259",
    ]);
    expect(lookup.mock.calls[0]?.[0]).toEqual([field(1043, 259)]);
  });

  it("DB が答えなかった型は null を返し、覚えない（次にまた尋ねる）", async () => {
    const lookup = vi.fn(async () => [null]);
    const cache = createTypeNameCache();
    expect(await cache.resolve([field(99999)], lookup)).toEqual([null]);
    await cache.resolve([field(99999)], lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("尋ねるのに失敗したら、そのまま失敗を伝え、何も覚えない", async () => {
    const cache = createTypeNameCache();
    await expect(
      cache.resolve([field(23)], async () => {
        throw new Error("lookup failed");
      }),
    ).rejects.toThrow("lookup failed");
    const lookup = vi.fn(async (missing: ReadonlyArray<TypeField>) => namesOf(missing));
    expect(await cache.resolve([field(23)], lookup)).toEqual(["t23/-1"]);
  });

  it("フィールドがなければ、DB には尋ねない", async () => {
    const lookup = vi.fn(async () => []);
    expect(await createTypeNameCache().resolve([], lookup)).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });
});
