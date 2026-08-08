import { describe, it, expect } from "vitest";
import { normalizeWaveform } from "../src/model";

describe("normalizeWaveform", () => {
  it("produces zero mean and ~unit variance", () => {
    const input = new Float32Array([1, 2, 3, 4, 5]);
    const out = normalizeWaveform(input);
    const mean = out.reduce((a, b) => a + b, 0) / out.length;
    const variance = out.reduce((a, b) => a + (b - mean) ** 2, 0) / out.length;
    expect(mean).toBeCloseTo(0, 5);
    expect(variance).toBeCloseTo(1, 2);
  });

  it("matches the exact HF formula (x - mean) / sqrt(var + 1e-7) on a known input", () => {
    const input = new Float32Array([2, 4, 4, 4, 5, 5, 7, 9]);
    const mean = 5;
    const variance = 4; // population variance of this sample set
    const expected = Array.from(input).map((x) => (x - mean) / Math.sqrt(variance + 1e-7));
    const out = normalizeWaveform(input);
    for (let i = 0; i < input.length; i++) {
      expect(out[i]).toBeCloseTo(expected[i], 5);
    }
  });
});
