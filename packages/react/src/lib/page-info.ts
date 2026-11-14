export type PageInfo = {
  readonly from: number | null;
  readonly to: number | null;
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
};

// total（件数）は「件数を取得」を押したときだけ分かる。分からないうちは、ページが満杯なら次があるものとして扱う。
export const pageInfo = (input: {
  readonly page: number;
  readonly limit: number;
  readonly rowCount: number;
  readonly total: number | null;
}): PageInfo => {
  const { page, limit, rowCount, total } = input;
  const offset = page * limit;
  const hasNext = total === null ? rowCount === limit : offset + rowCount < total;
  if (rowCount === 0) return { from: null, to: null, hasPrev: page > 0, hasNext: false };
  return { from: offset + 1, to: offset + rowCount, hasPrev: page > 0, hasNext };
};
