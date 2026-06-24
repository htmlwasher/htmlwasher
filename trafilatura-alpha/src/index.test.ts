import { describe, expect, it } from "vitest";

import { VERSION } from "./index.js";

describe("trafilatura-alpha scaffold", () => {
  it("exports a non-empty VERSION string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });
});
