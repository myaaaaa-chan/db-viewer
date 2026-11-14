import {
  type Dialect,
  type Statement,
  splitStatements,
  statementAt,
} from "@myaaaaa_chan/db-viewer-core";

export type EditorSelection = { readonly anchor: number; readonly head: number };

// Cmd/Ctrl+Enter で実行する範囲を決める。
// - 選択がなければ、カーソル位置の 1 文
// - 選択範囲が 1 文なら、その範囲（U6）
// - 複数の文にまたがる選択は、サーバーが multipleStatements で断るので、選択をそのまま返す
export const resolveRunTarget = (input: {
  readonly text: string;
  readonly selection: EditorSelection;
  readonly dialect: Dialect;
}): Statement | null => {
  const { text, selection, dialect } = input;
  const from = Math.min(selection.anchor, selection.head);
  const to = Math.max(selection.anchor, selection.head);
  if (from === to) return statementAt(text, selection.head, dialect);

  const statements = splitStatements(text.slice(from, to), dialect);
  const [first, second] = statements;
  if (!first) return null;
  if (!second) return { from: from + first.from, to: from + first.to, text: first.text };

  return { from, to, text: text.slice(from, to) };
};
