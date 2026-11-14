import { createHttpDataSource, DbViewer } from "@myaaaaa_chan/db-viewer-react";
import "@myaaaaa_chan/db-viewer-react/styles.css";
import { createRoot } from "react-dom/client";

const dataSource = createHttpDataSource({ endpoint: "/admin/db" });

const root = document.getElementById("root");
if (root === null) throw new Error("#root not found");

createRoot(root).render(
  <div style={{ height: "100%" }}>
    <DbViewer dataSource={dataSource} />
  </div>,
);
