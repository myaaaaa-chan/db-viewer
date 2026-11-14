import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DbViewer, type Theme } from "../src/index";
import "../src/styles.css";
import { createDemoDataSource } from "./data";

// 確認用ページ。?theme=light|dark|system と ?lang=en|ja で初期値を決められる。
const params = new URLSearchParams(location.search);
const initialTheme = (params.get("theme") as Theme | null) ?? "system";
const initialLanguage = params.get("lang") ?? "en";

function App() {
  const dataSource = useMemo(createDemoDataSource, []);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [language, setLanguage] = useState(initialLanguage);
  return (
    <>
      <div className="bar">
        <label>
          theme{" "}
          <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
            <option>system</option>
            <option>light</option>
            <option>dark</option>
          </select>
        </label>
        <label>
          language{" "}
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option>en</option>
            <option>ja</option>
          </select>
        </label>
      </div>
      <div className="stage">
        <DbViewer dataSource={dataSource} theme={theme} language={language} />
      </div>
    </>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
