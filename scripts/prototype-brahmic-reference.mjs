import fs from "fs";
import path from "path";

const DATA_DIR = path.join(import.meta.dirname, "..", "extracted");

function loadScript(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name.toLowerCase()}.json`), "utf-8"));
}

const CONSONANT_ONLY = /^[bcdfghjklmnpqrstvwxyz]+$/;

// lcode -> deletes word-final default vowel?
function deletesFinalSchwa(scriptName, lcode) {
  if (scriptName === "Devanagari") return lcode !== "san";
  return ["asm", "ben", "guj", "kas", "pan"].includes(lcode);
}

function romanizeBrahmicWord(word, scriptName, lcode) {
  const data = loadScript(scriptName);
  const { chars, multiCharOverrides, vowelSigns, virama, categories } = data;

  // Build ordered multi-char source keys, longest first, for greedy matching.
  const multiKeys = Object.keys(multiCharOverrides || {}).sort((a, b) => b.length - a.length);

  const codepoints = Array.from(word); // iterate by Unicode codepoint, not UTF-16 code unit
  const units = []; // { rom: string, isBareConsonant: bool }
  let i = 0;
  while (i < codepoints.length) {
    // try longest multi-char override first
    let matched = null;
    for (const key of multiKeys) {
      const keyChars = Array.from(key);
      if (codepoints.slice(i, i + keyChars.length).join("") === key) {
        matched = { len: keyChars.length, rom: multiCharOverrides[key] };
        break;
      }
    }
    if (matched) {
      units.push({ rom: matched.rom, isBareConsonant: CONSONANT_ONLY.test(matched.rom) });
      i += matched.len;
      continue;
    }
    const c = codepoints[i];
    if (virama && c === virama) {
      // virama: permanently kills the previous consonant's default vowel
      // (it's now a closed consonant, part of a conjunct/cluster) and
      // contributes nothing itself.
      const prev = units[units.length - 1];
      if (prev && prev.isBareConsonant) {
        prev.isBareConsonant = false; // resolved: no vowel, ever
      }
      i += 1;
      continue;
    }
    if (vowelSigns && Object.prototype.hasOwnProperty.call(vowelSigns, c)) {
      // vowel sign: replace previous bare-consonant unit's implicit vowel.
      const prev = units[units.length - 1];
      if (prev && prev.isBareConsonant) {
        prev.rom = prev.rom + vowelSigns[c];
        prev.isBareConsonant = false;
      } else {
        units.push({ rom: vowelSigns[c], isBareConsonant: false });
      }
      i += 1;
      continue;
    }
    const rom = chars[c];
    if (rom === undefined) {
      units.push({ rom: c, isBareConsonant: false }); // unknown char, passthrough (flag for review)
      i += 1;
      continue;
    }
    // uroman data files prefix some targets (e.g. anusvara) with "+" to mean
    // "concatenate directly onto whatever precedes, no syllable of its own" --
    // for our per-word model that's equivalent to just stripping the marker.
    const cleanRom = rom.startsWith("+") ? rom.slice(1) : rom;
    // Only actual LETTERS (category Lo/Lu/Ll) are candidates for default-vowel
    // insertion. Signs (anusvara, visarga, candrabindu -- category Mc/Mn) are
    // never bare consonants even if their romanization looks consonant-only
    // (e.g. anusvara -> "m").
    const isLetter = (categories?.[c] || "").startsWith("L");
    const isBareConsonant = isLetter && CONSONANT_ONLY.test(cleanRom);
    units.push({ rom: cleanRom, isBareConsonant });
    i += 1;
  }

  // Second pass: bare consonants not already resolved by a following vowel
  // sign/virama (handled above) need the default vowel appended, except the
  // trailing one, whose fate depends on schwa-deletion + single-syllable rule.
  const nSyllables = units.filter((u) => !u.isBareConsonant || true).length; // placeholder, recompute below properly
  let out = "";
  for (let idx = 0; idx < units.length; idx++) {
    const u = units[idx];
    if (!u.isBareConsonant) {
      out += u.rom;
      continue;
    }
    const isLast = idx === units.length - 1;
    if (!isLast) {
      out += u.rom + data.defaultVowel;
      continue;
    }
    // last unit, and it's still a bare consonant (no vowel sign/virama consumed it)
    const nUnits = units.length;
    if (nUnits === 1) {
      out += u.rom + data.defaultVowel; // single-syllable word: always keep (start-of-word short-circuit)
    } else if (deletesFinalSchwa(scriptName, lcode)) {
      out += u.rom; // delete
    } else {
      out += u.rom + data.defaultVowel; // keep
    }
  }
  return out;
}

export { romanizeBrahmicWord };
