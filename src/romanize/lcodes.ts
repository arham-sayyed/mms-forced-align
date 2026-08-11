// src/romanize/lcodes.ts
import type { BrahmicScript } from "./brahmic";
import type { ScriptName } from "./scriptDetect";

export type LanguageCode =
  | "hi-IN" | "mr-IN" | "ne-IN" | "sa-IN" | "mai-IN" | "doi-IN" | "kok-IN" | "brx-IN"
  | "bn-IN" | "as-IN"
  | "pa-IN"
  | "gu-IN"
  | "od-IN"
  | "ta-IN"
  | "te-IN"
  | "kn-IN"
  | "ml-IN"
  | "ur-IN" | "ks-IN" | "sd-IN"
  | "en-IN";

interface LangInfo {
  lcode: string; // ISO 639-3, matches uroman's convention and this repo's data
  script: ScriptName;
}

// Verified against real uroman output (test/fixtures/romanize/golden-sentences.json)
// for all 20 -- see plan Global Constraints for the full mapping rationale.
const LANG_INFO: Record<LanguageCode, LangInfo> = {
  "hi-IN": { lcode: "hin", script: "Devanagari" },
  "mr-IN": { lcode: "mar", script: "Devanagari" },
  "ne-IN": { lcode: "nep", script: "Devanagari" },
  "sa-IN": { lcode: "san", script: "Devanagari" },
  "mai-IN": { lcode: "mai", script: "Devanagari" },
  "doi-IN": { lcode: "doi", script: "Devanagari" },
  "kok-IN": { lcode: "kok", script: "Devanagari" },
  "brx-IN": { lcode: "brx", script: "Devanagari" },
  "bn-IN": { lcode: "ben", script: "Bengali" },
  "as-IN": { lcode: "asm", script: "Bengali" },
  "pa-IN": { lcode: "pan", script: "Gurmukhi" },
  "gu-IN": { lcode: "guj", script: "Gujarati" },
  "od-IN": { lcode: "ori", script: "Oriya" },
  "ta-IN": { lcode: "tam", script: "Tamil" },
  "te-IN": { lcode: "tel", script: "Telugu" },
  "kn-IN": { lcode: "kan", script: "Kannada" },
  "ml-IN": { lcode: "mal", script: "Malayalam" },
  "ur-IN": { lcode: "urd", script: "Arabic" },
  "ks-IN": { lcode: "kas", script: "Arabic" },
  "sd-IN": { lcode: "snd", script: "Arabic" },
  "en-IN": { lcode: "eng", script: "Latin" },
};

export const SUPPORTED_LANGUAGE_CODES = Object.keys(LANG_INFO) as LanguageCode[];

export function langInfo(code: LanguageCode): LangInfo {
  return LANG_INFO[code];
}

export function isBrahmicScript(script: ScriptName): script is BrahmicScript {
  return [
    "Devanagari", "Bengali", "Gurmukhi", "Gujarati", "Oriya",
    "Tamil", "Telugu", "Kannada", "Malayalam",
  ].includes(script);
}
