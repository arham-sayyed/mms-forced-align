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

// Regression coverage for ADDAK doubling before an aspirated (multi-letter
// romanized) consonant -- no current golden fixture exercises this path.
// ADDAK doubling must copy only the FIRST letter of the following
// consonant's romanization (e.g. "kh" -> "k"), not the whole string, per
// real uroman's own doubling regex. Verified against real uroman
// (python `uroman` package, lcode="pan"):
//   ਅੱਖ -> akkha (ਖ = "kh", doubled letter "k", not "kh")
//   ਅੱਛ -> accha (ਛ = "ch", doubled letter "c", not "ch")
//   ਅੱਠ -> atttha (ਠ = "tth", doubled letter "t", not "tth")
describe("romanizeBrahmicWord: Gurmukhi (pan) -- ADDAK before aspirated consonants", () => {
  const cases: Array<[string, string]> = [
    ["ਅੱਖ", "akkha"],
    ["ਅੱਛ", "accha"],
    ["ਅੱਘ", "aggha"],
    ["ਅੱਥ", "attha"],
    ["ਅੱਧ", "addha"],
    ["ਅੱਭ", "abbha"],
    ["ਅੱਠ", "atttha"],
    // Regression coverage: ADDAK before NYA/YYA/YA. Already
    // correct in the current engine (verified against real uroman, python
    // `uroman` package, lcode="pan") -- no code change, just closing a
    // fixture gap.
    ["ਕੱਞ", "kannya"],
    ["ਕੱਯ", "ka'ya"],
    ["ਕੱਵ", "ka'va"],
  ];

  for (const [word, expected] of cases) {
    it(`"${word}" -> "${expected}"`, () => {
      expect(romanizeBrahmicWord(word, "Gurmukhi", "pan")).toBe(expected);
    });
  }
});
