import type { Aligner, WordTiming } from "./align";
import { AlignError } from "./align";
import { romanizeWords, type LanguageCode } from "./romanize";

/**
 * Aligns a native-script (non-Latin) transcript by romanizing it internally
 * (see src/romanize/), running the existing Aligner on the romanized words,
 * then remapping the result back onto the ORIGINAL native-script words by
 * index. Word count is guaranteed equal on both sides -- romanizeWords()
 * throws rather than ever dropping/merging a word (see romanize/index.ts).
 *
 * Reuse one Aligner across many calls, same as align() itself -- this
 * function does not create or own the Aligner.
 */
export async function alignNative(
  aligner: Aligner,
  waveform: Float32Array,
  sampleRate: number,
  nativeWords: string[],
  langCode: LanguageCode
): Promise<WordTiming[]> {
  const romanizedWords = romanizeWords(nativeWords, langCode);

  if (romanizedWords.length !== nativeWords.length) {
    // Belt-and-suspenders: romanizeWords() already guarantees this, but this
    // invariant is exactly what "zero word loss" means for this package --
    // never let a violation here surface as a silent mis-indexed result.
    throw new AlignError(
      `alignNative: romanization produced ${romanizedWords.length} words for ` +
        `${nativeWords.length} input words -- refusing to align with a mismatched count`
    );
  }

  const timings = await aligner.align(waveform, sampleRate, romanizedWords);

  return timings.map((t, i) => ({
    ...t,
    word: nativeWords[i],
  }));
}
