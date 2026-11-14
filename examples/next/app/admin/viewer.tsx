"use client";

import { createHttpDataSource, DbViewer } from "@myaaaaa_chan/db-viewer-react";
import "@myaaaaa_chan/db-viewer-react/styles.css";
import { useState } from "react";

export function Viewer() {
  const [dataSource] = useState(() => createHttpDataSource({ endpoint: "/admin/db" }));
  return (
    <div style={{ height: "100vh" }}>
      <DbViewer dataSource={dataSource} />
    </div>
  );
}
