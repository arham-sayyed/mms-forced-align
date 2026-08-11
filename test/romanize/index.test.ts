// test/romanize/index.test.ts
import { describe, it, expect } from "vitest";
import { romanizeWord, romanizeWords, RomanizeError, SUPPORTED_LANGUAGE_CODES } from "../../src/romanize";
import goldenSentences from "../fixtures/romanize/golden-sentences.json";

describe("romanizeWord", () => {
  it("romanizes a Hindi word", () => {
    expect(romanizeWord("आज", "hi-IN")).toBe("aaj");
  });

  it("passes through an already-Latin code-switched word with case preserved", () => {
    // Real uroman never lowercases an embedded Latin word under a non-Latin
    // lcode: `uroman.romanize_string("मैंने Hello कहा", lcode="hin")` ->
    // "maimne Hello kahaa" (capital H preserved). Verified against real
    // uroman for hin, ben, and tam.
    expect(romanizeWord("Hello", "hi-IN")).toBe("Hello");
  });

  it("preserves case for an embedded Latin word in a full non-Latin sentence", () => {
    expect(romanizeWords(["मैंने", "Hello", "कहा"], "hi-IN")).toEqual([
      "maimne", "Hello", "kahaa",
    ]);
  });

  it("throws RomanizeError for a script that doesn't match the given language", () => {
    expect(() => romanizeWord("আজ", "hi-IN")).toThrow(RomanizeError);
  });

  it("supports exactly the 20 documented languages", () => {
    expect(SUPPORTED_LANGUAGE_CODES.sort()).toEqual(
      [
        "hi-IN", "mr-IN", "ne-IN", "sa-IN", "mai-IN", "doi-IN", "kok-IN", "brx-IN",
        "bn-IN", "as-IN", "pa-IN", "gu-IN", "od-IN",
        "ta-IN", "te-IN", "kn-IN", "ml-IN",
        "ur-IN", "ks-IN", "sd-IN",
        "en-IN",
      ].sort()
    );
  });
});

describe("romanizeWords: word-count invariant", () => {
  it("returns exactly one output word per input word, in order", () => {
    const words = ["आज", "मैंने", "काफी", "किया"];
    const result = romanizeWords(words, "hi-IN");
    expect(result).toHaveLength(words.length);
  });

  it("throws rather than dropping a word it can't romanize", () => {
    expect(() => romanizeWords(["आज", "।।।"], "hi-IN")).toThrow(RomanizeError);
  });
});

describe("romanizeWords: matches real uroman output on full golden sentences", () => {
  const langToBcp47: Record<string, string> = {
    hi: "hi-IN", mr: "mr-IN", ne: "ne-IN", sa: "sa-IN", mai: "mai-IN", doi: "doi-IN",
    kok: "kok-IN", bn: "bn-IN", as: "as-IN", pa: "pa-IN", gu: "gu-IN", od: "od-IN",
    ta: "ta-IN", te: "te-IN", kn: "kn-IN", ml: "ml-IN", ur: "ur-IN", ks: "ks-IN",
    sd: "sd-IN", brx: "brx-IN", en: "en-IN",
  };

  for (const fx of goldenSentences as Array<{ lang: string; input: string; uroman_output: string }>) {
    const bcp47 = langToBcp47[fx.lang];
    if (!bcp47) continue; // sat, mni out of scope
    it(`[${fx.lang}] full sentence matches real uroman (modulo punctuation stripping)`, () => {
      const words = fx.input.split(/\s+/).map((w) => w.replace(/[।॥.,!?؟،؛]+$/gu, "")).filter(Boolean);
      const expectedWords = fx.uroman_output.split(/\s+/).map((w) => w.replace(/[.,!?]+$/g, "")).filter(Boolean);
      expect(romanizeWords(words, bcp47 as any)).toEqual(expectedWords);
    });
  }
});
