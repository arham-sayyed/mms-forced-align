import { describe, it, expect } from "vitest";
import { romanizeBrahmicWord } from "../../src/romanize/brahmic";
import goldenWords from "../fixtures/romanize/golden-words.json";

describe("romanizeBrahmicWord: Telugu (tel), Kannada (kan), Malayalam (mal)", () => {
  const scriptFor: Record<string, string> = { te: "Telugu", kn: "Kannada", ml: "Malayalam" };
  const cases = (goldenWords as Array<{ lang: string; lcode: string; script: string; word: string; uroman: string }>)
    .filter((c) => ["te", "kn", "ml"].includes(c.lang));

  for (const c of cases) {
    it(`[${c.lang}] "${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizeBrahmicWord(c.word, scriptFor[c.lang] as any, c.lcode)).toBe(c.uroman);
    });
  }
});
