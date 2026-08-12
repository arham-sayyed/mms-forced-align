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

  // Task 14: a Bodo word carrying the apostrophe Bodo writes /ɯ/ with. This
  // exercises three layers at once -- cleanNativeWord keeps the apostrophe,
  // detectScript must not call the word "Mixed" because of it, and
  // romanizeBrahmicWord must romanize it to "'". Verified against real
  // uroman: बर' (brx) -> "bar'".
  it("romanizes a Bodo word containing an apostrophe end to end", () => {
    expect(romanizeWord("बर'", "brx-IN")).toBe("bar'");
  });

  // Task 14 review: ॐ / ௐ used to throw, because the extractor scoped each
  // script's character set to UnicodeDataProps.txt's incomplete `::char`
  // list and so filtered out UnicodeDataOverwrite.txt's `::u 0950 ::r om`.
  // Verified against real uroman: "om" for hin, san and tam alike.
  it("romanizes ॐ in ordinary Hindi/Sanskrit text", () => {
    expect(romanizeWords(["ॐ", "नमः", "शिवाय"], "hi-IN")).toEqual(["om", "namah", "shivaay"]);
    expect(romanizeWord("ॐ", "sa-IN")).toBe("om");
  });

  it("romanizes ௐ in Tamil text", () => {
    expect(romanizeWord("ௐ", "ta-IN")).toBe("om");
  });

  it("supports exactly the 20 documented languages", () => {
    // SUPPORTED_LANGUAGE_CODES is frozen (finding #4) -- copy before sorting
    // rather than sorting in place.
    expect([...SUPPORTED_LANGUAGE_CODES].sort()).toEqual(
      [
        "hi-IN", "mr-IN", "ne-IN", "sa-IN", "mai-IN", "doi-IN", "kok-IN", "brx-IN",
        "bn-IN", "as-IN", "pa-IN", "gu-IN", "od-IN",
        "ta-IN", "te-IN", "kn-IN", "ml-IN",
        "ur-IN", "ks-IN", "sd-IN",
        "en-IN",
      ].sort()
    );
  });

  it("SUPPORTED_LANGUAGE_CODES is frozen", () => {
    expect(Object.isFrozen(SUPPORTED_LANGUAGE_CODES)).toBe(true);
  });

  it("throws RomanizeError, not a raw TypeError, for an unrecognized language code", () => {
    expect(() => romanizeWord("आज", "xx-IN" as any)).toThrow(RomanizeError);
  });

  // Final-review finding #1: Sindhi "۽" (U+06FD) is a real, uroman-verified
  // word-forming character (cleanNativeWord whitelists it, arabic.json maps
  // it to real uroman's own output "&") but "&" is not vocab-safe ([a-z']
  // only, see src/vocab.json). romanizeWord must refuse to hand this to the
  // aligner and fail loudly here rather than downstream as an opaque
  // VocabError.
  it("throws RomanizeError for Sindhi ۽, whose real-uroman romanization (\"&\") isn't vocab-safe", () => {
    expect(() => romanizeWord("۽", "sd-IN")).toThrow(RomanizeError);
  });

  // Related empty-output case: a lone Devanagari nukta survives
  // cleanNativeWord's \p{L}\p{M}' filter (it's a combining mark) but
  // romanizes to "" -- the same output guard must catch empty results too,
  // since "" technically matches /^[a-z']*$/i.
  it("throws RomanizeError for a lone Devanagari nukta, which romanizes to an empty string", () => {
    expect(() => romanizeWord("़", "hi-IN")).toThrow(RomanizeError);
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
    const words = fx.input.split(/\s+/).map((w) => w.replace(/[।॥.,!?؟،؛]+$/gu, "")).filter(Boolean);

    // Final-review finding #1: this fixture's sentence contains "۽" (Sindhi
    // "and"), whose real-uroman romanization "&" is not vocab-safe.
    // romanizeWord now throws RomanizeError for it (see the dedicated "۽"
    // test above) rather than passing "&" through, so this sentence can no
    // longer be expected to romanize successfully end to end -- verify it
    // throws instead of silently matching stale expected output.
    if (fx.lang === "sd") {
      it(`[${fx.lang}] full sentence throws RomanizeError (contains non-vocab-safe "۽")`, () => {
        expect(() => romanizeWords(words, bcp47 as any)).toThrow(RomanizeError);
      });
      continue;
    }

    it(`[${fx.lang}] full sentence matches real uroman (modulo punctuation stripping)`, () => {
      const expectedWords = fx.uroman_output.split(/\s+/).map((w) => w.replace(/[.,!?]+$/g, "")).filter(Boolean);
      expect(romanizeWords(words, bcp47 as any)).toEqual(expectedWords);
    });
  }
});
