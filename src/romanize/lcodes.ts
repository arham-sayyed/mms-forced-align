// src/romanize/lcodes.ts
import type { BrahmicScript } from "./brahmic";
import type { ScriptName } from "./scriptDetect";
import { RomanizeError } from "./clean";

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

export const SUPPORTED_LANGUAGE_CODES: readonly LanguageCode[] = Object.freeze(
  Object.keys(LANG_INFO)
) as readonly LanguageCode[];

export function langInfo(code: LanguageCode): LangInfo {
  const info = LANG_INFO[code];
  if (info === undefined) {
    throw new RomanizeError(
      `langInfo: unrecognized language code "${code}". Supported codes: ${SUPPORTED_LANGUAGE_CODES.join(", ")}`
    );
  }
  return info;
}

// Record<BrahmicScript, true> rather than a plain string array so the
// compiler -- not just this function's runtime behavior -- enforces that
// this set stays in sync with the BrahmicScript union: adding a 10th
// Brahmic script to that type without adding it here is now a type error,
// not a silently-wrong predicate.
const BRAHMIC_SCRIPTS: Record<BrahmicScript, true> = {
  Devanagari: true,
  Bengali: true,
  Gurmukhi: true,
  Gujarati: true,
  Oriya: true,
  Tamil: true,
  Telugu: true,
  Kannada: true,
  Malayalam: true,
};

export function isBrahmicScript(script: ScriptName): script is BrahmicScript {
  return Object.prototype.hasOwnProperty.call(BRAHMIC_SCRIPTS, script);
}
