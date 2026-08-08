import { describe, it, expect } from "vitest";
import { BLANK_ID, wordsToTokenIds, VocabError } from "../src/vocab";

describe("BLANK_ID", () => {
  it("is 0", () => {
    expect(BLANK_ID).toBe(0);
  });
});

describe("wordsToTokenIds", () => {
  it("maps a single word to its letter token ids", () => {
    // h=18, i=5
    const { tokenIds, wordLengths } = wordsToTokenIds(["hi"]);
    expect(tokenIds).toEqual([18, 5]);
    expect(wordLengths).toEqual([2]);
  });

  it("concatenates multiple words with no delimiter token", () => {
    // "hi" -> h=18,i=5 ; "so" -> s=11,o=8
    const { tokenIds, wordLengths } = wordsToTokenIds(["hi", "so"]);
    expect(tokenIds).toEqual([18, 5, 11, 8]);
    expect(wordLengths).toEqual([2, 2]);
  });

  it("lowercases before mapping", () => {
    const { tokenIds } = wordsToTokenIds(["HI"]);
    expect(tokenIds).toEqual([18, 5]);
  });

  it("handles apostrophes", () => {
    // d=16,o=8,n=7,'=28,t=10 -> "don't"
    const { tokenIds, wordLengths } = wordsToTokenIds(["don't"]);
    expect(tokenIds).toEqual([16, 8, 7, 28, 10]);
    expect(wordLengths).toEqual([5]);
  });

  it("throws VocabError with the offending word on out-of-vocab characters", () => {
    expect(() => wordsToTokenIds(["hello,"])).toThrow(VocabError);
    expect(() => wordsToTokenIds(["hello,"])).toThrow(/hello,/);
  });

  it("throws VocabError on an empty word", () => {
    expect(() => wordsToTokenIds([""])).toThrow(VocabError);
  });
});
