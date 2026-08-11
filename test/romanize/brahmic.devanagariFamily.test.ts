import { describe, it, expect } from "vitest";
import { romanizeBrahmicWord } from "../../src/romanize/brahmic";
import goldenWords from "../fixtures/romanize/golden-words.json";

describe("romanizeBrahmicWord: Devanagari family (mar, nep, san, mai, doi, kok, brx)", () => {
  const langs = ["mr", "ne", "sa", "mai", "doi", "kok", "brx"];
  const cases = (goldenWords as Array<{ lang: string; lcode: string; script: string; word: string; uroman: string }>)
    .filter((c) => langs.includes(c.lang));

  it("has test cases for all 7 languages", () => {
    const covered = new Set(cases.map((c) => c.lang));
    for (const l of langs) expect(covered.has(l)).toBe(true);
  });

  for (const c of cases) {
    it(`[${c.lang}] "${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizeBrahmicWord(c.word, "Devanagari", c.lcode)).toBe(c.uroman);
    });
  }
});
