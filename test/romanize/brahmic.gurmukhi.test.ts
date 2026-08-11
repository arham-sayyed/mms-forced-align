import { describe, it, expect } from "vitest";
import { romanizeBrahmicWord } from "../../src/romanize/brahmic";
import goldenWords from "../fixtures/romanize/golden-words.json";

describe("romanizeBrahmicWord: Gurmukhi (pan)", () => {
  const cases = (goldenWords as Array<{ lang: string; lcode: string; script: string; word: string; uroman: string }>)
    .filter((c) => c.lang === "pa");

  for (const c of cases) {
    it(`"${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizeBrahmicWord(c.word, "Gurmukhi", c.lcode)).toBe(c.uroman);
    });
  }
});
