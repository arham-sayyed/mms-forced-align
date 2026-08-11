import { describe, it, expect } from "vitest";
import { cleanNativeWord, RomanizeError } from "../../src/romanize/clean";

describe("cleanNativeWord", () => {
  it("strips a trailing danda", () => expect(cleanNativeWord("किया।")).toBe("किया"));
  it("strips trailing latin punctuation", () => expect(cleanNativeWord("hello,")).toBe("hello"));
  it("keeps combining marks (vowel signs / virama)", () => expect(cleanNativeWord("सुन्दरम्")).toBe("सुन्दरम्"));
  it("keeps apostrophes", () => expect(cleanNativeWord("don't")).toBe("don't"));
  it("throws if nothing alphabetic remains", () => {
    expect(() => cleanNativeWord("।।।")).toThrow(RomanizeError);
  });
});
