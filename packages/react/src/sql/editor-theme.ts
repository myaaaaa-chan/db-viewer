import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

// 色はすべて --dbv-* の変数を参照する。表と同じ変数なので、テーマの切り替えにそのまま追従する。
const theme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--dbv-text)",
    backgroundColor: "var(--dbv-surface)",
    fontSize: "13px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--dbv-font-mono)",
    lineHeight: "22px",
    overflow: "auto",
  },
  ".cm-content": { padding: "10px 0", caretColor: "var(--dbv-text)" },
  ".cm-line": { padding: "0 16px" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--dbv-text)", borderLeftWidth: "2px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "var(--dbv-sel)" },
  ".cm-gutters": {
    color: "var(--dbv-faint)",
    backgroundColor: "var(--dbv-panel)",
    border: "none",
    borderRight: "1px solid var(--dbv-soft)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 12px 0 16px",
    minWidth: "48px",
    boxSizing: "border-box",
  },
  ".dbv-gutter-error": { color: "var(--dbv-err-text)", fontWeight: "500" },
  ".dbv-run-line": { backgroundColor: "var(--dbv-accent-soft)" },
  ".dbv-err-line": { backgroundColor: "var(--dbv-err-bg)" },
  ".dbv-err": {
    textDecoration: "underline wavy var(--dbv-err-icon)",
    textUnderlineOffset: "4px",
    textDecorationThickness: "1.5px",
    backgroundColor: "var(--dbv-err-bg-strong)",
  },
  ".cm-tooltip": {
    border: "1px solid var(--dbv-line-strong)",
    borderRadius: "6px",
    color: "var(--dbv-text)",
    backgroundColor: "var(--dbv-surface)",
    boxShadow: "0 4px 12px var(--dbv-shadow)",
  },
  ".cm-tooltip:has(> .dbv-err-tooltip)": { marginTop: "6px" },
  ".cm-tooltip-autocomplete > ul": { fontFamily: "var(--dbv-font-mono)", fontSize: "12.5px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    color: "var(--dbv-text)",
    backgroundColor: "var(--dbv-accent-soft)",
  },
  ".cm-completionDetail": { color: "var(--dbv-muted)" },
});

const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.typeName], color: "var(--dbv-accent-text)", fontWeight: "500" },
  { tag: tags.string, color: "var(--dbv-tok-string)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--dbv-tok-number)" },
  { tag: tags.standard(tags.name), color: "var(--dbv-tok-fn)" },
  { tag: tags.comment, color: "var(--dbv-faint)" },
]);

export const dbvEditorTheme = [theme, syntaxHighlighting(highlight)];
