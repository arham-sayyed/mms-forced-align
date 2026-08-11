// test/alignNative.unit.test.ts
import { describe, it, expect, vi } from "vitest";
import { alignNative } from "../src/alignNative";
import type { Aligner, WordTiming } from "../src/align";

function stubAligner(): Aligner {
  return {
    async align(_waveform, _sampleRate, words): Promise<WordTiming[]> {
      // Echo back deterministic fake timings, one per word -- this test is
      // about the romanize -> align -> remap wiring, not real alignment.
      return words.map((w, i) => ({ word: w, start: i, end: i + 1 }));
    },
    async dispose() {},
  };
}

describe("alignNative", () => {
  it("returns timings with the ORIGINAL native-script words, not the romanized ones", async () => {
    const aligner = stubAligner();
    const waveform = new Float32Array(16000);
    const nativeWords = ["आज", "मैंने", "काफी"];

    const result = await alignNative(aligner, waveform, 16000, nativeWords, "hi-IN");

    expect(result).toHaveLength(3);
    expect(result.map((r) => r.word)).toEqual(nativeWords);
  });

  it("preserves start/end timings from the underlying aligner", async () => {
    const aligner = stubAligner();
    const result = await alignNative(aligner, new Float32Array(16000), 16000, ["आज", "काफी"], "hi-IN");
    expect(result[0]).toMatchObject({ start: 0, end: 1 });
    expect(result[1]).toMatchObject({ start: 1, end: 2 });
  });

  it("passes the romanized (not native) words to the underlying aligner", async () => {
    const alignSpy = vi.fn(async (_w: Float32Array, _sr: number, words: string[]) =>
      words.map((w, i) => ({ word: w, start: i, end: i + 1 }))
    );
    const aligner: Aligner = { align: alignSpy, dispose: async () => {} };

    await alignNative(aligner, new Float32Array(16000), 16000, ["आज"], "hi-IN");

    expect(alignSpy).toHaveBeenCalledWith(expect.any(Float32Array), 16000, ["aaj"]);
  });
});
