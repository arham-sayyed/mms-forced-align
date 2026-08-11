import { loadBrahmicScriptData } from "./brahmicData";
import { RomanizeError } from "./clean";

export type BrahmicScript =
  | "Devanagari" | "Bengali" | "Gurmukhi" | "Gujarati" | "Oriya"
  | "Tamil" | "Telugu" | "Kannada" | "Malayalam";

const CONSONANT_ONLY = /^[bcdfghjklmnpqrstvwxyz]+$/;

interface Unit {
  rom: string;
  /** Still a bare consonant awaiting a default-vowel decision. Becomes false
   * once resolved by a vowel sign, a virama, or the final default-vowel pass. */
  pending: boolean;
}

/**
 * Word-final schwa deletion, ported from uroman's add_default_abugida_vowel
 * (uroman.py, roughly line 1722-1729 in the isi-nlp/uroman source):
 *
 *   if self.is_at_end_of_word(end):
 *       if (script_name in ("Devanagari",)) and (self.lcode not in ('san',)):
 *           return rom  # bare consonant, no vowel: DELETE
 *       elif self.lcode in ('asm', 'ben', 'guj', 'kas', 'pan'):
 *           return rom  # DELETE
 *       else:
 *           return base_rom_plus_vowel  # KEEP
 *
 * lcode is the ISO 639-3 code (hin, mar, ben, ...), not the script name --
 * they're independent here because e.g. Sanskrit (san) is Devanagari-script
 * but keeps the schwa, while Bengali/Assamese (ben/asm) are Bengali-script
 * but still delete it.
 */
function deletesFinalSchwa(script: BrahmicScript, lcode: string): boolean {
  if (script === "Devanagari") return lcode !== "san";
  return ["asm", "ben", "guj", "kas", "pan"].includes(lcode);
}

export function romanizeBrahmicWord(word: string, script: BrahmicScript, lcode: string): string {
  const data = loadBrahmicScriptData(script);
  const { chars, categories, vowelSigns, virama, multiCharOverrides, defaultVowel } = data;

  const multiKeys = Object.keys(multiCharOverrides).sort((a, b) => b.length - a.length);
  const codepoints = Array.from(word);
  const units: Unit[] = [];

  let i = 0;
  while (i < codepoints.length) {
    let matchedLen = 0;
    let matchedRom: string | null = null;
    for (const key of multiKeys) {
      const keyChars = Array.from(key);
      if (codepoints.slice(i, i + keyChars.length).join("") === key) {
        matchedLen = keyChars.length;
        matchedRom = multiCharOverrides[key];
        break;
      }
    }
    if (matchedRom !== null) {
      units.push({ rom: matchedRom, pending: CONSONANT_ONLY.test(matchedRom) });
      i += matchedLen;
      continue;
    }

    const c = codepoints[i];

    if (virama !== null && c === virama) {
      const prev = units[units.length - 1];
      if (prev?.pending) prev.pending = false; // permanently: no vowel, ever
      i += 1;
      continue;
    }

    if (Object.prototype.hasOwnProperty.call(vowelSigns, c)) {
      const prev = units[units.length - 1];
      if (prev?.pending) {
        prev.rom += vowelSigns[c];
        prev.pending = false;
      } else {
        units.push({ rom: vowelSigns[c], pending: false });
      }
      i += 1;
      continue;
    }

    const rawRom = chars[c];
    if (rawRom === undefined) {
      // Chandrabindu (nasalization mark) is absent from uroman's own
      // per-script auto-table entirely -- see plan Task-list "Known gaps" #2.
      if (/CANDRABINDU/i.test(c) === false && isCandrabinduChar(c)) {
        units.push({ rom: "n", pending: false });
        i += 1;
        continue;
      }
      throw new RomanizeError(
        `romanizeBrahmicWord: no romanization data for character U+${c.codePointAt(0)!
          .toString(16)
          .toUpperCase()} ("${c}") in word "${word}" (script ${script}). ` +
          `Re-run scripts/extract-uroman-data.py against a fresh uroman clone -- ` +
          `this character may be legitimately missing from our extracted table.`
      );
    }
    const rom = rawRom.startsWith("+") ? rawRom.slice(1) : rawRom;
    const isLetter = (categories[c] ?? "").startsWith("L");
    units.push({ rom, pending: isLetter && CONSONANT_ONLY.test(rom) });
    i += 1;
  }

  let out = "";
  for (let idx = 0; idx < units.length; idx++) {
    const u = units[idx];
    if (!u.pending) {
      out += u.rom;
      continue;
    }
    const isLast = idx === units.length - 1;
    if (!isLast) {
      out += u.rom + defaultVowel;
      continue;
    }
    if (units.length === 1) {
      out += u.rom + defaultVowel; // single-syllable word: uroman always keeps it
    } else if (deletesFinalSchwa(script, lcode)) {
      out += u.rom;
    } else {
      out += u.rom + defaultVowel;
    }
  }
  return out;
}

// Placeholder codepoint check for candrabindu -- see Task 5, which gives this
// a real implementation once Bengali/Oriya test cases are in place. Devanagari
// candrabindu is U+0951..U+0952 range historically but varies by script; do
// not guess here, resolve empirically against fixtures in Task 5.
function isCandrabinduChar(_c: string): boolean {
  return false;
}
