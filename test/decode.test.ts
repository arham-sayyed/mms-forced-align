import { describe, it, expect } from "vitest";
import {
  buildExtendedSequence,
  viterbiAlign,
  DecodeError,
  collapseToLetterSpans,
  groupIntoWordSpans,
  framesToSeconds,
} from "../src/decode";

const NEG = -1000; // stand-in for -Infinity in test fixtures, avoids NaN in arithmetic

/** Builds a flattened (T,V) row-major log-prob matrix from a per-frame [tokenId, logProb] list. */
function buildEmission(
  numFrames: number,
  vocabSize: number,
  peaks: Array<[frame: number, tokenId: number, logProb: number]>
): Float32Array {
  const emission = new Float32Array(numFrames * vocabSize).fill(NEG);
  for (const [frame, tokenId, logProb] of peaks) {
    emission[frame * vocabSize + tokenId] = logProb;
  }
  return emission;
}

describe("buildExtendedSequence", () => {
  it("interleaves blank between every token, with leading/trailing blank", () => {
    expect(buildExtendedSequence([1, 2], 0)).toEqual([0, 1, 0, 2, 0]);
  });

  it("handles a single-token sequence", () => {
    expect(buildExtendedSequence([5], 0)).toEqual([0, 5, 0]);
  });
});

describe("viterbiAlign", () => {
  it("aligns a simple 2-letter word when T equals the extended length exactly", () => {
    // tokenIds [1,2], blank=0 -> ext=[0,1,0,2,0], L=5. Force statePerFrame=[0,1,2,3,4]
    // by putting an overwhelming peak for ext[s] at frame s.
    const vocabSize = 3;
    const numFrames = 5;
    const emission = buildEmission(numFrames, vocabSize, [
      [0, 0, 0], [1, 1, 0], [2, 0, 0], [3, 2, 0], [4, 0, 0],
    ]);
    const statePerFrame = viterbiAlign(emission, numFrames, vocabSize, [1, 2], 0);
    expect(statePerFrame).toEqual([0, 1, 2, 3, 4]);
  });

  it("uses the legal skip-blank transition for non-repeated adjacent tokens when frames are too tight without it", () => {
    // tokenIds [1,2] (distinct), blank=0 -> ext=[0,1,0,2,0], L=5, but only T=2 frames.
    // The DP is free to start directly at state 1 (skipping the leading blank costs
    // nothing structurally), but reaching state 3 one frame later is only possible via
    // the legal skip-blank transition (ext[3]=2 != ext[1]=1) — advancing through state 2
    // would need a 3rd frame that doesn't exist here.
    const vocabSize = 3;
    const numFrames = 2;
    const emission = buildEmission(numFrames, vocabSize, [
      [0, 1, 0], [1, 2, 0],
    ]);
    const statePerFrame = viterbiAlign(emission, numFrames, vocabSize, [1, 2], 0);
    // state must reach the end (state 3 or 4) — legal skip means no frame is stuck at state 2.
    expect(statePerFrame[numFrames - 1]).toBeGreaterThanOrEqual(3);
    expect(statePerFrame).not.toContain(2);
  });

  it("throws DecodeError when the same skip would require merging two identical letters (illegal)", () => {
    // tokenIds [1,1] (repeated!), blank=0 -> ext=[0,1,0,1,0], L=5, but only T=2 frames.
    // Starting directly at state1 (free) and reaching state3 one frame later would require
    // skipping state2 — ILLEGAL here because ext[3]==ext[1]==1. No other path reaches state3
    // (let alone state4) in only 2 frames -> must throw, not silently merge the two letters.
    const vocabSize = 3;
    const numFrames = 2;
    const emission = buildEmission(numFrames, vocabSize, [
      [0, 1, 0], [1, 1, 0],
    ]);
    expect(() => viterbiAlign(emission, numFrames, vocabSize, [1, 1], 0)).toThrow(DecodeError);
  });

  it("throws DecodeError when there are fewer frames than the minimum required (T < N tokens)", () => {
    const vocabSize = 3;
    const numFrames = 1;
    const emission = buildEmission(numFrames, vocabSize, [[0, 1, 0]]);
    expect(() => viterbiAlign(emission, numFrames, vocabSize, [1, 2], 0)).toThrow(DecodeError);
  });
});

describe("collapseToLetterSpans", () => {
  it("collapses frames into per-token spans, skipping blank frames", () => {
    // statePerFrame from ext=[0,1,0,2,0]: frame0->s0(blank), frame1->s1(tok idx0),
    // frame2->s2(blank), frame3->s3(tok idx1), frame4->s4(blank)
    const spans = collapseToLetterSpans([0, 1, 2, 3, 4], [1, 2]);
    expect(spans).toEqual([
      { tokenIndex: 0, startFrame: 1, endFrame: 1 },
      { tokenIndex: 1, startFrame: 3, endFrame: 3 },
    ]);
  });

  it("merges consecutive frames sharing the same non-blank token index", () => {
    // token held for 3 frames in a row (state stays at s1)
    const spans = collapseToLetterSpans([0, 1, 1, 1, 3], [1, 2]);
    expect(spans).toEqual([
      { tokenIndex: 0, startFrame: 1, endFrame: 3 },
      { tokenIndex: 1, startFrame: 4, endFrame: 4 },
    ]);
  });

  it("throws DecodeError if a decoded token index falls outside tokenIds bounds", () => {
    // state 5 would decode to tokenIndex 2, but tokenIds only has 2 entries (indices 0-1) —
    // this would only happen if statePerFrame came from a mismatched tokenIds array.
    expect(() => collapseToLetterSpans([5], [1, 2])).toThrow(DecodeError);
  });
});

describe("groupIntoWordSpans", () => {
  it("groups letter spans into word spans using wordLengths", () => {
    const letterSpans = [
      { tokenIndex: 0, startFrame: 1, endFrame: 1 }, // word0, letter0
      { tokenIndex: 1, startFrame: 3, endFrame: 4 }, // word0, letter1
      { tokenIndex: 2, startFrame: 6, endFrame: 6 }, // word1, letter0
      { tokenIndex: 3, startFrame: 8, endFrame: 9 }, // word1, letter1
      { tokenIndex: 4, startFrame: 11, endFrame: 11 }, // word1, letter2
    ];
    const wordSpans = groupIntoWordSpans(letterSpans, [2, 3]);
    expect(wordSpans).toEqual([
      { startFrame: 1, endFrame: 4 },
      { startFrame: 6, endFrame: 11 },
    ]);
  });

  it("throws DecodeError if letterSpans count doesn't match sum(wordLengths)", () => {
    const letterSpans = [{ tokenIndex: 0, startFrame: 0, endFrame: 0 }];
    expect(() => groupIntoWordSpans(letterSpans, [2])).toThrow(DecodeError);
  });
});

describe("framesToSeconds", () => {
  it("converts using the default 320/16000 stride", () => {
    expect(framesToSeconds(5)).toBeCloseTo(0.1, 10);
    expect(framesToSeconds(0)).toBe(0);
  });

  it("accepts a custom samplesPerFrame/sampleRate", () => {
    expect(framesToSeconds(10, 160, 16000)).toBeCloseTo(0.1, 10);
  });
});
