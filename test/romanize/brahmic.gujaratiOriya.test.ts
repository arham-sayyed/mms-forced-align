// test/romanize/brahmic.gujaratiOriya.test.ts
import { describe, it, expect } from "vitest";
import { romanizeBrahmicWord } from "../../src/romanize/brahmic";
import goldenWords from "../fixtures/romanize/golden-words.json";

describe("romanizeBrahmicWord: Gujarati (guj) and Oriya (ori)", () => {
  const cases = (goldenWords as Array<{ lang: string; lcode: string; script: string; word: string; uroman: string }>)
    .filter((c) => c.lang === "gu" || c.lang === "od");

  for (const c of cases) {
    const script = c.lang === "gu" ? "Gujarati" : "Oriya";
    it(`[${c.lang}] "${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizeBrahmicWord(c.word, script as any, c.lcode)).toBe(c.uroman);
    });
  }
});
