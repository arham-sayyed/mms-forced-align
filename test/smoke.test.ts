import { describe, it, expect } from "vitest";
import { createAligner } from "../src/index";

describe("smoke", () => {
  it("createAligner is exported and callable", () => {
    expect(typeof createAligner).toBe("function");
  });
});
