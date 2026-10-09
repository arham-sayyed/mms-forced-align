import arabicData from "./data/arabic.json";
import { RomanizeError } from "./clean";

const CHARS: Record<string, string> = arabicData.chars;
const MULTI_CHAR_OVERRIDES: Record<string, string> = arabicData.multiCharOverrides;
const START_OF_WORD_OVERRIDES: Record<string, string> = arabicData.startOfWordOverrides;

// Longest-match-first, mirroring brahmic.ts's multiCharOverrides handling.
const MULTI_CHAR_KEYS = Object.keys(MULTI_CHAR_OVERRIDES).sort((a, b) => b.length - a.length);
const START_OF_WORD_KEYS = Object.keys(START_OF_WORD_OVERRIDES).sort((a, b) => b.length - a.length);

// Matches Python's str.isalpha() (what uroman.py's is_at_start_of_word
// itself uses): Python's isalpha() checks General_Category in
// {Lu,Ll,Lt,Lm,Lo} specifically -- it is NOT the same as Unicode's broader
// derived "Alphabetic" property, which also covers many combining marks
// (Arabic harakat like FATHA/SUKUN are Other_Alphabetic=Yes despite being
// General_Category Mn). JS's `\p{Alphabetic}` tests that broader property,
// so using it here would wrongly treat every harakat mark as a "letter" and
// make isAtStartOfWordPosition never fire after one -- caught by this file's
// own verification tests. `\p{L}` tests General_Category=Letter directly,
// matching Python's isalpha() exactly for our purposes.
const ALPHABETIC = /\p{L}/u;

/**
 * Ported from uroman.py's is_at_start_of_word (~line 1312), simplified for
 * our single-pass, unambiguous (no lattice) engine. Real uroman's check is
 * NOT "is this literal index 0" -- it's a two-step test at the boundary
 * immediately before `i`:
 *
 *   1. If the raw ORIGINAL character immediately before `i`
 *      (`self.s[end-1:end]` in uroman.py) is itself alphabetic, `i` is *not*
 *      start-of-word. This check looks at the source character, regardless
 *      of what it romanizes to.
 *   2. Otherwise (previous source char is a non-letter, e.g. a combining
 *      mark, digit, or punctuation, or `i` is 0), fall through to the
 *      ROMANIZED text produced for whatever unit immediately precedes `i`:
 *      if that romanization is non-empty and its last character is
 *      alphabetic, `i` is *not* start-of-word; if it's empty (e.g. SUKUN,
 *      which romanizes to "") or ends in a non-letter (e.g. the hamza
 *      letters' "'"), `i` *is* start-of-word.
 *
 * This was found by an adversarial probe: the original
 * implementation only ever fired startOfWordOverrides at literal index 0,
 * so a word like "sukun + ای" (a combining mark immediately followed by the
 * "ای" -> "i" sequence) wrongly produced "ai" instead of real uroman's "i" --
 * 56/303 mismatches in the reviewer's targeted sweep, all of the shape
 * <combining-mark-or-digit> + "ای...". Every example below is verified
 * against real uroman (python `uroman` package, lcode="urd"):
 *
 *   SUKUN + ای          -> "i"    (prev source char non-letter, prev rom "" empty)
 *   digit "١" + ای       -> "1i"   (prev source char non-letter, prev rom "1" non-alpha)
 *   HAMZA-ABOVE + ای     -> "'i"   (prev source char non-letter, prev rom "'" non-alpha)
 *   "ء" (hamza letter) + ای -> "'ai" (prev source char IS a letter (Lo) even
 *                                     though its own romanization "'" is
 *                                     non-alpha -- step 1 disqualifies before
 *                                     step 2 is ever reached)
 *   "ب" + FATHA + ای     -> "baai" (FATHA's romanization "a" is alphabetic,
 *                                    so step 2 disqualifies)
 *   "ب" + SUKUN + ای     -> "bi"   (SUKUN's romanization "" is empty, so step
 *                                    2 does NOT disqualify, despite "ب"
 *                                    appearing earlier in the word -- this is
 *                                    strictly a check on what's *immediately*
 *                                    before `i`, not "no letter anywhere yet")
 */
function isAtStartOfWordPosition(
  i: number,
  codepoints: string[],
  precedingUnitRom: string
): boolean {
  if (i === 0) return true;
  if (ALPHABETIC.test(codepoints[i - 1])) return false;
  if (precedingUnitRom.length === 0) return true;
  return !ALPHABETIC.test(precedingUnitRom[precedingUnitRom.length - 1]);
}

/**
 * Perso-Arabic is an abjad -- no virama/vowel-sign/default-vowel machinery
 * like the Brahmic engine needs. The bulk of uroman's own Arabic-block data
 * (src/romanize/data/arabic.json, extracted by scripts/extract-uroman-data.py)
 * is a flat, context-free, lcode-independent character substitution -- the
 * same table serves Urdu, Kashmiri, and Sindhi. Unicode Arabic text is stored
 * in logical (unshaped) order, so no positional letter-form handling is
 * needed either.
 *
 * Two exceptions to "flat and context-free" were found during an
 * exhaustive differential sweep against real uroman and
 * are handled below:
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
 *    when at "start of word", elsewhere falling through to ordinary
 *    per-character concatenation ("ا" + "ی" = "a" + "i" = "ai", which
 *    matches uroman's own `::t-alt ai` for that entry). This is not a rare
 *    edge case -- it fires on extremely common words, e.g. Urdu "ایک" (ek,
 *    "one") -> "ik", not "aik". Crucially, "start of word" here is NOT
 *    literal index 0 -- see isAtStartOfWordPosition above.
 */
export function romanizePersoArabicWord(word: string): string {
  const codepoints = Array.from(word);
  let out = "";
  let i = 0;
  // Romanization of the most recently consumed unit (single char or
  // multi-char match); "" at the very start of the word. Used only to
  // evaluate isAtStartOfWordPosition's step 2.
  let precedingUnitRom = "";

  while (i < codepoints.length) {
    if (isAtStartOfWordPosition(i, codepoints, precedingUnitRom)) {
      let matchedSow = false;
      for (const key of START_OF_WORD_KEYS) {
        const keyChars = Array.from(key);
        if (codepoints.slice(i, i + keyChars.length).join("") === key) {
          const rom = START_OF_WORD_OVERRIDES[key];
          out += rom;
          precedingUnitRom = rom;
          i += keyChars.length;
          matchedSow = true;
          break;
        }
      }
      if (matchedSow) continue;
    }

    let matched = false;
    for (const key of MULTI_CHAR_KEYS) {
      const keyChars = Array.from(key);
      if (codepoints.slice(i, i + keyChars.length).join("") === key) {
        const rom = MULTI_CHAR_OVERRIDES[key];
        out += rom;
        precedingUnitRom = rom;
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
    precedingUnitRom = rom;
    i += 1;
  }
  return out;
}
