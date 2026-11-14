// 起動時に location.hash からトークンを読み、URL から消す（05_CLI §4）。トークンはメモリ上だけに持つ。
export const takeToken = (location: Location, history: History): string | null => {
  const token = new URLSearchParams(location.hash.slice(1)).get("token");
  if (token !== null) history.replaceState(null, "", location.pathname + location.search);
  return token === "" ? null : token;
};
