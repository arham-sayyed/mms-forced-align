import { describe, it, expect } from "vitest";
import { romanizePersoArabicWord } from "../../src/romanize/persoArabic";
import goldenWords from "../fixtures/romanize/golden-words-arabic.json";

describe("romanizePersoArabicWord", () => {
  for (const c of goldenWords as Array<{ lang: string; word: string; uroman: string }>) {
    it(`[${c.lang}] "${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizePersoArabicWord(c.word)).toBe(c.uroman);
    });
  }
});
