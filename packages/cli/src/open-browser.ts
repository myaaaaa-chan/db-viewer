import { spawn } from "node:child_process";

const commandFor = (platform: NodeJS.Platform, url: string): readonly [string, Array<string>] => {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["cmd", ["/c", "start", "", url.replaceAll("&", "^&")]];
  return ["xdg-open", [url]];
};

// 開けなくても CLI は止めない（URL は表示してある）。
export const openBrowser = (url: string): void => {
  const [command, args] = commandFor(process.platform, url);
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
};
