import { describe, it, expect } from "vitest";
import { romanizeBrahmicWord } from "../../src/romanize/brahmic";
import goldenWords from "../fixtures/romanize/golden-words.json";

describe("romanizeBrahmicWord: Tamil (tam)", () => {
  const cases = (goldenWords as Array<{ lang: string; lcode: string; script: string; word: string; uroman: string }>)
    .filter((c) => c.lang === "ta");

  for (const c of cases) {
    it(`"${c.word}" -> "${c.uroman}"`, () => {
      expect(romanizeBrahmicWord(c.word, "Tamil", c.lcode)).toBe(c.uroman);
    });
  }
});

/**
 * uroman's "+"-prefixed romanization targets are "rom tails" (uroman.py
 * add_romanization ~line 1846: `if regex.match(r'\+(m|ng|n|h|r)', rom): rom,
 * edge_annotation = rom[1:], 'rom tail'`, then add_default_abugida_vowel
 * ~line 1689: `if 'tail' in annotation: return rom`) -- they attach to the
 * preceding syllable and never take a default abugida vowel.
 *
 * This block lives in the Tamil test file because Tamil is where the rule was
 * found (அஃது was this engine's last remaining Tamil discrepancy
 * against real uroman, out of 1023 differentially-tested words), but the rule
 * is script-agnostic, so the two non-Tamil characters it also fixes are
 * covered here alongside it rather than split across files.
 *
 * Only three characters across all nine supported scripts are affected in
 * practice: every other "+"-target is a combining mark (Mn/Mc), which this
 * engine already excludes from default-vowel insertion via its category
 * check. These three have Unicode General Category Lo (letter) and so used
 * to slip through and pick up a spurious "a".
 *
 * Every expectation below is real `uroman.romanize_string(word, lcode=...)`
 * output from the installed python `uroman` package.
 */
describe("romanizeBrahmicWord: uroman \"+\"-tail rule (no default vowel)", () => {
  const cases: Array<[string, "Tamil" | "Bengali" | "Malayalam", string, string]> = [
    // Tamil aytam U+0B83 "+h" (cat Lo)
    ["ஃ", "Tamil", "tam", "h"],
    ["அஃது", "Tamil", "tam", "ahtu"],
    ["கஃ", "Tamil", "tam", "kah"],
    ["வஃ", "Tamil", "tam", "vah"],
    ["ஃக", "Tamil", "tam", "hka"],
    // ...but the aytam digraphs still win as multi-char overrides (ஃப -> f,
    // ஃஜ -> z), which are NOT tails and do take a default vowel.
    ["ஃப", "Tamil", "tam", "fa"],
    ["ஃஜ", "Tamil", "tam", "za"],
    ["பஃபு", "Tamil", "tam", "pafu"],
    // Bengali VEDIC ANUSVARA U+09FC "+m" (cat Lo)
    ["ৼ", "Bengali", "ben", "m"],
    ["কৼ", "Bengali", "ben", "kam"],
    ["ৼক", "Bengali", "ben", "mk"],
    // Malayalam VEDIC ANUSVARA U+0D04 "+m" (cat Lo)
    ["ഄ", "Malayalam", "mal", "m"],
    ["കഄ", "Malayalam", "mal", "kam"],
    ["ഄക", "Malayalam", "mal", "mka"],
    // Ordinary combining-mark "+"-targets, unchanged by this rule (they were
    // already correct via the Mn/Mc category check) -- guards against the
    // tail rule being implemented as a blanket "+"-strip that also alters
    // these.
    ["கஂ", "Tamil", "tam", "kam"],
    ["কং", "Bengali", "ben", "kang"],
    ["কঁ", "Bengali", "ben", "kan"],
    ["കം", "Malayalam", "mal", "kam"],
  ];

  for (const [word, script, lcode, expected] of cases) {
    it(`[${lcode}] "${word}" -> "${expected}"`, () => {
      expect(romanizeBrahmicWord(word, script, lcode)).toBe(expected);
    });
  }
});
