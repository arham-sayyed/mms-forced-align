export type ScriptName =
  | "Devanagari" | "Bengali" | "Gurmukhi" | "Gujarati" | "Oriya"
  | "Tamil" | "Telugu" | "Kannada" | "Malayalam" | "Arabic" | "Latin";

const RANGES: Array<[ScriptName, number, number]> = [
  ["Devanagari", 0x0900, 0x097f],
  ["Bengali", 0x0980, 0x09ff],
  ["Gurmukhi", 0x0a00, 0x0a7f],
  ["Gujarati", 0x0a80, 0x0aff],
  ["Oriya", 0x0b00, 0x0b7f],
  ["Tamil", 0x0b80, 0x0bff],
  ["Telugu", 0x0c00, 0x0c7f],
  ["Kannada", 0x0c80, 0x0cff],
  ["Malayalam", 0x0d00, 0x0d7f],
  ["Arabic", 0x0600, 0x06ff],
];

function scriptOfCodepoint(cp: number): ScriptName | null {
  for (const [name, lo, hi] of RANGES) {
    if (cp >= lo && cp <= hi) return name;
  }
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) {
    return "Latin";
  }
  return null; // digits, punctuation, unrelated symbols -- not script-bearing
}

/**
 * The apostrophe is Unicode Script=Common: it belongs to no script, and
 * cleanNativeWord deliberately keeps it. It used to be classified as Latin
 * here, which was fine for "don't" but wrong for Bodo, which writes /ɯ/ with
 * an apostrophe -- बर' ("Boro", the language's own name) came out "Mixed" and
 * romanizeWord threw on it. Treating it as a *weak* Latin signal keeps both
 * behaviours: any real letter in the word decides the script, and the
 * apostrophe only decides when nothing else does.
 */
const WEAK_LATIN = new Set([0x27 /* ' */]);

export function detectScript(word: string): ScriptName | "Mixed" | "Unknown" {
  let found: ScriptName | null = null;
  let weak: ScriptName | null = null;
  for (const ch of word) {
    const cp = ch.codePointAt(0)!;
    if (WEAK_LATIN.has(cp)) {
      weak = "Latin";
      continue;
    }
    const script = scriptOfCodepoint(cp);
    if (script === null) continue; // combining marks / punctuation: ignore for detection
    if (found === null) {
      found = script;
    } else if (found !== script) {
      return "Mixed";
    }
  }
  return found ?? weak ?? "Unknown";
}
