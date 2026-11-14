import { describe, expect, it } from "vitest";
import { createAuthorize, generateToken } from "./token";

const requestWith = (authorization?: string) =>
  new Request("http://127.0.0.1/api", {
    method: "POST",
    ...(authorization === undefined ? {} : { headers: { authorization } }),
  });

describe("generateToken", () => {
  it("32 バイトを base64url にした 43 文字で、呼ぶたびに違う", () => {
    const a = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });
});

describe("createAuthorize", () => {
  const authorize = createAuthorize("secret-token");

  it("Bearer のトークンが一致したときだけ通す", () => {
    expect(authorize(requestWith("Bearer secret-token"))).toBe(true);
  });

  it("ヘッダーなし、別のトークン、長さの違うトークン、別の方式は通さない", () => {
    expect(authorize(requestWith())).toBe(false);
    expect(authorize(requestWith("Bearer secret-tokeN"))).toBe(false);
    expect(authorize(requestWith("Bearer secret-token-and-more"))).toBe(false);
    expect(authorize(requestWith("Bearer "))).toBe(false);
    expect(authorize(requestWith("Basic secret-token"))).toBe(false);
    expect(authorize(requestWith("secret-token"))).toBe(false);
  });
});
