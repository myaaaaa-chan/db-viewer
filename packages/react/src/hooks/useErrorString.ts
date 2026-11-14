import type { DbViewerError } from "@myaaaaa_chan/db-viewer-core";
import { useCallback } from "react";
import { useT } from "../i18n/useT";
import { errorText } from "../lib/error-text";

// DB のメッセージはそのまま、それ以外は辞書の文言にした、エラーの文字列。
export const useErrorString = (): ((error: DbViewerError) => string) => {
  const { t } = useT();
  return useCallback(
    (error) => {
      const text = errorText(error);
      return text.type === "raw" ? text.text : t(text.key, text.values);
    },
    [t],
  );
};
