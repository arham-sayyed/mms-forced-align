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

  if (timings.length !== nativeWords.length) {
    // Belt-and-suspenders on the way back out, mirroring the check above on
    // the way in. The bundled align() guarantees timings.length matches its
    // input via decode.ts's own span-count check, but Aligner is an exported
    // public interface (src/align.ts) -- a caller-supplied custom
    // implementation returning a short/long timings array would otherwise
    // silently mis-index nativeWords[i] below rather than fail loudly.
    throw new AlignError(
      `alignNative: aligner returned ${timings.length} timings for ${nativeWords.length} input words -- ` +
        `refusing to remap with a mismatched count`
    );
  }

  return timings.map((t, i) => ({
    ...t,
    word: nativeWords[i],
  }));
}
