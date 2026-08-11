import arabicData from "./data/arabic.json";
import { RomanizeError } from "./clean";

const CHARS: Record<string, string> = arabicData.chars;
const MULTI_CHAR_OVERRIDES: Record<string, string> = arabicData.multiCharOverrides;
const START_OF_WORD_OVERRIDES: Record<string, string> = arabicData.startOfWordOverrides;

// Longest-match-first, mirroring brahmic.ts's multiCharOverrides handling.
const MULTI_CHAR_KEYS = Object.keys(MULTI_CHAR_OVERRIDES).sort((a, b) => b.length - a.length);
const START_OF_WORD_KEYS = Object.keys(START_OF_WORD_OVERRIDES).sort((a, b) => b.length - a.length);

/**
 * Perso-Arabic is an abjad -- no virama/vowel-sign/default-vowel machinery
 * like the Brahmic engine needs. The bulk of uroman's own Arabic-block data
 * (src/romanize/data/arabic.json, extracted by scripts/extract-uroman-data.py)
 * is a flat, context-free, lcode-independent character substitution -- the
 * same table serves Urdu, Kashmiri, and Sindhi. Unicode Arabic text is stored
 * in logical (unshaped) order, so no positional letter-form handling is
 * needed either.
 *
 * Two exceptions to "flat and context-free" were found during Task 10's
 * verification (an exhaustive differential sweep against real uroman: every
 * table character at 5 word positions across all 3 lcodes, plus common real
 * words) and are handled below:
 *
 *  - multiCharOverrides: a small number of 2-character sequences romanize
 *    as a unit rather than as the concatenation of their individual
 *    romanizations, regardless of where they appear in the word. E.g.
 *    "ٓا" (maddah-above + alef, U+0653 U+0627 -- an ill-formed but
 *    real-world-attested variant of the precomposed آ) -> "a", and
 *    "اً" (alef + fathatan) -> "an".
 *  - startOfWordOverrides: exactly one sequence in uroman's data is
 *    position-restricted (`::use-only-at-start-of-word` in
 *    romanization-table.txt): "ای" (alef + Farsi yeh, U+0627 U+06CC) -> "i"
 *    only when it opens the word; elsewhere it falls through to ordinary
 *    per-character concatenation ("ا" + "ی" = "a" + "i" = "ai", which
 *    matches uroman's own `::t-alt ai` for that entry). This is not a rare
 *    edge case -- it fires on extremely common words, e.g. Urdu "ایک" (ek,
 *    "one") -> "ik", not "aik".
 */
export function romanizePersoArabicWord(word: string): string {
  const codepoints = Array.from(word);
  let out = "";
  let i = 0;

  if (i === 0) {
    for (const key of START_OF_WORD_KEYS) {
      const keyChars = Array.from(key);
      if (codepoints.slice(0, keyChars.length).join("") === key) {
        out += START_OF_WORD_OVERRIDES[key];
        i = keyChars.length;
        break;
      }
    }
  }

  while (i < codepoints.length) {
    let matched = false;
    for (const key of MULTI_CHAR_KEYS) {
      const keyChars = Array.from(key);
      if (codepoints.slice(i, i + keyChars.length).join("") === key) {
        out += MULTI_CHAR_OVERRIDES[key];
        i += keyChars.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;

    const c = codepoints[i];
    const rom = CHARS[c];
    if (rom === undefined) {
      throw new RomanizeError(
        `romanizePersoArabicWord: no romanization data for character U+${c
          .codePointAt(0)!
          .toString(16)
          .toUpperCase()} ("${c}") in word "${word}". ` +
          `Re-run scripts/extract-uroman-data.py against a fresh uroman clone -- ` +
          `this character may be legitimately missing from our extracted table ` +
          `(e.g. an Arabic Presentation Forms ligature or Extended-B/C character, ` +
          `deliberately out of scope -- see the comment in extract-uroman-data.py).`
      );
    }
    out += rom;
    i += 1;
  }
  return out;
}
