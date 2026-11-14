import { createHttpDataSource } from "@myaaaaa_chan/db-viewer-core";
import { DbViewer } from "@myaaaaa_chan/db-viewer-react";
import "@myaaaaa_chan/db-viewer-react/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { takeToken } from "./token";

const token = takeToken(window.location, window.history);

const dataSource = createHttpDataSource({
  endpoint: "/api",
  headers: () => ({ Authorization: `Bearer ${token ?? ""}` }),
});

const language = navigator.language.toLowerCase().startsWith("ja") ? "ja" : "en";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <DbViewer dataSource={dataSource} language={language} />
    </StrictMode>,
  );
}
