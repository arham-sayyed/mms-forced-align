// test/romanize/brahmic.bengali.test.ts
import { describe, it, expect } from "vitest";
import { romanizeBrahmicWord } from "../../src/romanize/brahmic";
import goldenWords from "../fixtures/romanize/golden-words.json";

describe("romanizeBrahmicWord: Bengali script (ben, asm)", () => {
  const cases = (goldenWords as Array<{ lang: string; lcode: string; script: string; word: string; uroman: string }>)
    .filter((c) => c.lang === "bn" || c.lang === "as");

  for (const c of cases) {
    it(`[${c.lang}] "${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizeBrahmicWord(c.word, "Bengali", c.lcode)).toBe(c.uroman);
    });
  }
});
