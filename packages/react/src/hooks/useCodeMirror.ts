import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching } from "@codemirror/language";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { drawSelection, EditorView, keymap, lineNumbers } from "@codemirror/view";
import type { Dialect } from "@myaaaaa_chan/db-viewer-core";
import { type RefObject, useEffect, useRef } from "react";
import type { SqlNamespace } from "../lib/sql-schema";
import { diagnosticsExtension } from "../sql/diagnostics";
import { dbvEditorTheme } from "../sql/editor-theme";
import { sqlLanguage } from "../sql/language";

export type UseCodeMirrorOptions = {
  readonly dialect: Dialect;
  readonly schema: SqlNamespace;
  readonly defaultSchema: string | null;
  readonly ariaLabel: string;
  readonly onRun: () => void;
  readonly onDocChange: (text: string) => void;
};

// CodeMirror の EditorView を container の中に作って持つ。view は呼び出し側が ref で読む。
// 方言とスキーマ（補完）は、作り直さず差し替える。
export const useCodeMirror = (
  containerRef: RefObject<HTMLDivElement | null>,
  viewRef: RefObject<EditorView | null>,
  options: UseCodeMirrorOptions,
): void => {
  const language = useRef(new Compartment());
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const parent = containerRef.current;
    if (!parent) return;
    const { dialect, schema, defaultSchema, ariaLabel } = latest.current;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "",
        extensions: [
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                preventDefault: true,
                run: () => {
                  latest.current.onRun();
                  return true;
                },
              },
            ]),
          ),
          lineNumbers(),
          history(),
          drawSelection(),
          bracketMatching(),
          autocompletion(),
          keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
          language.current.of(sqlLanguage(dialect, schema, defaultSchema)),
          dbvEditorTheme,
          diagnosticsExtension,
          EditorView.contentAttributes.of({ "aria-label": ariaLabel }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onDocChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [containerRef, viewRef]);

  const { dialect, schema, defaultSchema } = options;
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: language.current.reconfigure(sqlLanguage(dialect, schema, defaultSchema)),
    });
  }, [viewRef, dialect, schema, defaultSchema]);
};
