// src/romanize/index.ts
import { detectScript } from "./scriptDetect";
import { cleanNativeWord, RomanizeError } from "./clean";
import { romanizeBrahmicWord } from "./brahmic";
import { romanizePersoArabicWord } from "./persoArabic";
import { langInfo, isBrahmicScript, SUPPORTED_LANGUAGE_CODES, type LanguageCode } from "./lcodes";

export { RomanizeError, SUPPORTED_LANGUAGE_CODES };
export type { LanguageCode };

// Every code path through romanizeWord must end here before returning. The
// package's entire contract with align()/alignNative() is "produce text the
// model's vocab (26 lowercase letters + apostrophe, see src/vocab.json) can
// consume" -- a result that doesn't satisfy that contract must never reach a
// caller, because it would otherwise surface many layers away as an opaque
// VocabError (or, for empty output, "wordsToTokenIds: encountered an empty
// word") with no indication of which word or language caused it. This is
// deliberately centralized here rather than duplicated in each engine: it
// catches real uroman-verified outputs that are themselves not vocab-safe
// (e.g. Sindhi "۽" -> "&", see arabic.json) as well as any engine bug that
// might slip one through. This must NOT try to invent a different
// romanization for the offending characters -- that would violate the
// "exact match against real uroman" accuracy target this whole package is
// built on. A word that can't be aligned must fail loudly with a clear
// reason, not silently proceed into a VocabError.
const VOCAB_SAFE = /^[a-z']*$/i;

function assertVocabSafe(out: string, original: string, langCode: LanguageCode): string {
  if (out.length === 0) {
    throw new RomanizeError(
      `romanizeWord: word "${original}" (${langCode}) romanized to an empty string, which cannot be aligned`
    );
  }
  if (!VOCAB_SAFE.test(out)) {
    const badChars = [...new Set([...out].filter((ch) => !/^[a-z']$/i.test(ch)))]
      .map((ch) => `"${ch}" (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`)
      .join(", ");
    throw new RomanizeError(
      `romanizeWord: word "${original}" (${langCode}) romanized to "${out}", which contains ` +
        `character(s) outside the vocab-safe [a-z'] set: ${badChars}`
    );
  }
  return out;
}

export function romanizeWord(word: string, langCode: LanguageCode): string {
  const { lcode, script: expectedScript } = langInfo(langCode);
  const cleaned = cleanNativeWord(word);

  if (expectedScript === "Latin") {
    // en-IN: expect already-Latin text; still route through detectScript so
    // a caller accidentally passing native-script text under "en-IN" gets a
    // loud error instead of silently mangled output. Real uroman leaves
    // already-Latin text's casing untouched (verified against
    // golden-sentences.json's "en" fixture: "Today I had..." stays
    // capitalized) -- same case-preserving treatment as the code-switch
    // fallback below.
    const detected = detectScript(cleaned);
    if (detected !== "Latin") {
      throw new RomanizeError(
        `romanizeWord: expected Latin script for language "en-IN", got ${detected} in word "${word}"`
      );
    }
    return assertVocabSafe(cleaned, word, langCode);
  }

  const detected = detectScript(cleaned);
  if (detected === "Latin") {
    // Code-switched word (e.g. an English brand name inside an Indic
    // sentence) -- pass through rather than erroring. Real uroman never
    // lowercases an embedded Latin word under a non-Latin lcode (verified:
    // `uroman.romanize_string("मैंने Hello कहा", lcode="hin")` ->
    // "maimne Hello kahaa", capital H preserved), so this must match the
    // en-IN branch above and preserve case rather than lowercase.
    return assertVocabSafe(cleaned, word, langCode);
  }
  if (detected !== expectedScript) {
    throw new RomanizeError(
      `romanizeWord: word "${word}" is ${detected} script, expected ${expectedScript} for language "${langCode}"`
    );
  }

  if (isBrahmicScript(expectedScript)) {
    return assertVocabSafe(romanizeBrahmicWord(cleaned, expectedScript, lcode), word, langCode);
  }
  if (expectedScript === "Arabic") {
    return assertVocabSafe(romanizePersoArabicWord(cleaned), word, langCode);
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
