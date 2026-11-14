import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const generateToken = (): string => randomBytes(32).toString("base64url");

const digest = (value: string) => createHash("sha256").update(value).digest();

// 長さの違いが応答時間に出ないよう、ハッシュにしてから定数時間で比べる。
export const createAuthorize = (token: string) => {
  const expected = digest(token);
  return (request: Request): boolean => {
    const header = request.headers.get("authorization") ?? "";
    const match = /^Bearer (.+)$/.exec(header);
    if (match?.[1] === undefined) return false;
    return timingSafeEqual(digest(match[1]), expected);
  };
};
