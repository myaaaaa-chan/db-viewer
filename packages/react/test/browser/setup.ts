import { afterEach, vi } from "vitest";
import "../../src/styles.css";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
