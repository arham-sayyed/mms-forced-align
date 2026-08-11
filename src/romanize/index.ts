// src/romanize/index.ts
import { detectScript } from "./scriptDetect";
import { cleanNativeWord, RomanizeError } from "./clean";
import { romanizeBrahmicWord } from "./brahmic";
import { romanizePersoArabicWord } from "./persoArabic";
import { langInfo, isBrahmicScript, SUPPORTED_LANGUAGE_CODES, type LanguageCode } from "./lcodes";

export { RomanizeError, SUPPORTED_LANGUAGE_CODES };
export type { LanguageCode };

export function romanizeWord(word: string, langCode: LanguageCode): string {
  const { lcode, script: expectedScript } = langInfo(langCode);
  const cleaned = cleanNativeWord(word);

  if (expectedScript === "Latin") {
    // en-IN: expect already-Latin text; still route through detectScript so
    // a caller accidentally passing native-script text under "en-IN" gets a
    // loud error instead of silently mangled output. Real uroman leaves
    // already-Latin text's casing untouched (verified against
    // golden-sentences.json's "en" fixture: "Today I had..." stays
    // capitalized) -- unlike the code-switch fallback below, which
    // deliberately lowercases.
    const detected = detectScript(cleaned);
    if (detected !== "Latin") {
      throw new RomanizeError(
        `romanizeWord: expected Latin script for language "en-IN", got ${detected} in word "${word}"`
      );
    }
    return cleaned;
  }

  const detected = detectScript(cleaned);
  if (detected === "Latin") {
    // Code-switched word (e.g. an English brand name inside an Indic
    // sentence) -- pass through rather than erroring.
    return cleaned.toLowerCase();
  }
  if (detected !== expectedScript) {
    throw new RomanizeError(
      `romanizeWord: word "${word}" is ${detected} script, expected ${expectedScript} for language "${langCode}"`
    );
  }

  if (isBrahmicScript(expectedScript)) {
    return romanizeBrahmicWord(cleaned, expectedScript, lcode);
  }
  if (expectedScript === "Arabic") {
    return romanizePersoArabicWord(cleaned);
  }
  throw new RomanizeError(`romanizeWord: unsupported script ${expectedScript} for language "${langCode}"`);
}

export function romanizeWords(words: string[], langCode: LanguageCode): string[] {
  const out = words.map((w) => romanizeWord(w, langCode));
  if (out.length !== words.length) {
    // Unreachable given .map()'s semantics, but the invariant is load-bearing
    // enough (see plan Global Constraints: "zero word loss is non-negotiable")
    // to assert explicitly rather than trust .map() silently forever.
    throw new RomanizeError(
      `romanizeWords: word count mismatch, got ${out.length} outputs for ${words.length} inputs`
    );
  }
  return out;
}
