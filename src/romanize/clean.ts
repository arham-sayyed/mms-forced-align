export class RomanizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RomanizeError";
  }
}

/**
 * Strips everything except Unicode letters (\p{L}), combining marks (\p{M} --
 * vowel signs, virama, nukta, anusvara etc. are marks, not letters, and must
 * be kept), and apostrophe. Mirrors the existing package's Latin-text
 * cleaning convention (README: `w.replace(/[^\w']/g, "")`) but Unicode-aware
 * so it doesn't mangle native scripts.
 *
 * Two Sindhi word-forming characters are also explicitly preserved even
 * though Unicode assigns them General_Category=So (Symbol, other) rather
 * than L/M, which would otherwise cause this filter to silently drop them:
 * U+06FD ARABIC SIGN SINDHI AMPERSAND ("۽", uroman romanizes it to "&") and
 * U+06FE ARABIC SIGN SINDHI POSTPOSITION MEN ("۾", uroman romanizes it to
 * "men"). Both function as ordinary word content in Sindhi text -- uroman
 * romanizes them rather than stripping them -- despite the categorization.
 * Confirmed against real uroman's Sindhi output (see
 * test/fixtures/romanize/golden-sentences.json, lang "sd", and
 * src/romanize/data/arabic.json's entries for these two code points).
 */
export function cleanNativeWord(word: string): string {
  const cleaned = word.replace(/[^\p{L}\p{M}'۽۾]/gu, "");
  if (cleaned.length === 0) {
    throw new RomanizeError(
      `cleanNativeWord: "${word}" has no alphabetic content after stripping punctuation`
    );
  }
  return cleaned;
}
