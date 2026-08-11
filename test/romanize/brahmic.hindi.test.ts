import { describe, it, expect } from "vitest";
import { romanizeBrahmicWord } from "../../src/romanize/brahmic";
import goldenWords from "../fixtures/romanize/golden-words.json";

describe("romanizeBrahmicWord: Hindi (hin, Devanagari)", () => {
  const cases = (goldenWords as Array<{ lang: string; lcode: string; script: string; word: string; uroman: string }>)
    .filter((c) => c.lang === "hi");

  it("has test cases loaded from the fixture", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const c of cases) {
    it(`romanizes "${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizeBrahmicWord(c.word, "Devanagari", c.lcode)).toBe(c.uroman);
    });
  }
});
