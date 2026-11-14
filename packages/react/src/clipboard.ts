// クリップボードへの書き込み（ブラウザ API の境界）。権限や HTTP の環境で navigator.clipboard が
// 使えないときは、選択して copy コマンドを送る古い方法に切り替える。
export const copyText = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return legacyCopy(text);
  }
};

const legacyCopy = (text: string): boolean => {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
};
