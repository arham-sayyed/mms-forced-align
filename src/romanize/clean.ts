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
 */
export function cleanNativeWord(word: string): string {
  const cleaned = word.replace(/[^\p{L}\p{M}']/gu, "");
  if (cleaned.length === 0) {
    throw new RomanizeError(
      `cleanNativeWord: "${word}" has no alphabetic content after stripping punctuation`
    );
  }
  return cleaned;
}
