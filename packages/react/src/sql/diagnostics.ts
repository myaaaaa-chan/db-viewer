import { type Extension, RangeSet, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  gutterLineClass,
  hoverTooltip,
} from "@codemirror/view";

export type EditorError = { readonly from: number; readonly to: number; readonly message: string };

export const setEditorError = StateEffect.define<EditorError | null>();
export const flashRun = StateEffect.define<{ readonly from: number; readonly to: number } | null>();

// 文を編集したら、位置がずれた下線を残さず消す。
const errorField = StateField.define<EditorError | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(setEditorError)) return effect.value;
    return tr.docChanged ? null : value;
  },
});

class ErrorGutterMarker extends GutterMarker {
  override elementClass = "dbv-gutter-error";
}
const errorGutterMarker = new ErrorGutterMarker();

const errorDecorations = EditorView.decorations.compute([errorField], (state): DecorationSet => {
  const error = state.field(errorField);
  if (!error) return Decoration.none;
  const line = state.doc.lineAt(error.from);
  return Decoration.set([
    Decoration.line({ class: "dbv-err-line" }).range(line.from),
    Decoration.mark({ class: "dbv-err" }).range(error.from, Math.max(error.to, error.from + 1)),
  ]);
});

const errorGutter = gutterLineClass.compute([errorField], (state) => {
  const error = state.field(errorField);
  if (!error) return RangeSet.empty;
  return RangeSet.of([errorGutterMarker.range(state.doc.lineAt(error.from).from)]);
});

const SVG_NS = "http://www.w3.org/2000/svg";

const errorIcon = (): SVGElement => {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "dbv-err-tooltip-icon");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "9");
  const mark = document.createElementNS(SVG_NS, "path");
  mark.setAttribute("d", "M12 8v5M12 16h.01");
  svg.append(circle, mark);
  return svg;
};

const errorTooltip = hoverTooltip(
  (view, pos) => {
    const error = view.state.field(errorField);
    if (!error || pos < error.from || pos > error.to) return null;
    return {
      pos: error.from,
      end: error.to,
      above: false,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "dbv-err-tooltip";
        dom.append(
          errorIcon(),
          Object.assign(document.createElement("span"), { textContent: error.message }),
        );
        return { dom };
      },
    };
  },
  { hoverTime: 100 },
);

// 実行した範囲の行を、一瞬だけ強調する。
const runField = StateField.define<{ readonly from: number; readonly to: number } | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(flashRun)) return effect.value;
    if (value && tr.docChanged) {
      return { from: tr.changes.mapPos(value.from), to: tr.changes.mapPos(value.to) };
    }
    return value;
  },
});

const runDecorations = EditorView.decorations.compute([runField], (state): DecorationSet => {
  const range = state.field(runField);
  if (!range) return Decoration.none;
  const first = state.doc.lineAt(range.from).number;
  const last = state.doc.lineAt(range.to).number;
  const lines = [];
  for (let n = first; n <= last; n++) {
    lines.push(Decoration.line({ class: "dbv-run-line" }).range(state.doc.line(n).from));
  }
  return Decoration.set(lines);
});

export const diagnosticsExtension: Extension = [
  errorField,
  errorDecorations,
  errorGutter,
  errorTooltip,
  runField,
  runDecorations,
];
