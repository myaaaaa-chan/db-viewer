import * as v from "valibot";

export const readonlyObject = <const TEntries extends v.ObjectEntries>(entries: TEntries) =>
  v.pipe(v.object(entries), v.readonly());

export const readonlyArray = <const TItem extends v.GenericSchema>(item: TItem) =>
  v.pipe(v.array(item), v.readonly());
