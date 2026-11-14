import type { DbViewerError } from "@myaaaaa_chan/db-viewer-core";
import type { MessageKey } from "../i18n/messages";

// DB が返したメッセージは翻訳しない（raw）。それ以外は辞書のキーと値で表す。
export type ErrorText =
  | { readonly type: "raw"; readonly text: string }
  | {
      readonly type: "message";
      readonly key: MessageKey;
      readonly values?: Readonly<Record<string, string | number>>;
    };

export const errorText = (error: DbViewerError): ErrorText => {
  switch (error.kind) {
    case "query":
    case "readOnlyViolation":
    case "internal":
      return { type: "raw", text: error.message };
    case "unauthorized":
      return { type: "message", key: "error.unauthorized" };
    case "invalidRequest":
      return {
        type: "message",
        key: "error.invalidRequest",
        values: { issues: error.issues.join("; ") },
      };
    case "connectionNotFound":
      return {
        type: "message",
        key: "error.connectionNotFound",
        values: { connection: error.connection },
      };
    case "tableNotFound":
      return {
        type: "message",
        key: "error.tableNotFound",
        values: { table: `${error.table.schema}.${error.table.name}` },
      };
    case "multipleStatements":
      return { type: "message", key: "error.multipleStatements" };
    case "timeout":
      return {
        type: "message",
        key: "error.timeout",
        values: { seconds: Math.round(error.timeoutMs / 1000) },
      };
    case "busy":
      return { type: "message", key: "error.busy", values: { max: error.maxConcurrentQueries } };
    case "cancelled":
      return { type: "message", key: "error.cancelled" };
    case "unsupported":
      return { type: "message", key: "error.unsupportedCancel" };
  }
};
