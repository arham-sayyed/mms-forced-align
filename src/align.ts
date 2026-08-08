import { loadModel, runAcousticModel } from "./model";
import { wordsToTokenIds, BLANK_ID } from "./vocab";
import {
  viterbiAlign,
  collapseToLetterSpans,
  groupIntoWordSpans,
  framesToSeconds,
} from "./decode";

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  score?: number;
}

export interface CreateAlignerOptions {
  cacheDir?: string;
  quantized?: boolean;
}

export interface Aligner {
  align(waveform: Float32Array, sampleRate: number, words: string[]): Promise<WordTiming[]>;
  dispose(): Promise<void>;
}

export class AlignError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlignError";
  }
}

export async function createAligner(options: CreateAlignerOptions = {}): Promise<Aligner> {
  const bundle = await loadModel(options);

  return {
    async align(waveform, sampleRate, words) {
      if (sampleRate !== 16000) {
        throw new AlignError(
          `mms-forced-align: align() requires sampleRate === 16000, got ${sampleRate}. ` +
            `Resample before calling align() — this package does not resample audio for you.`
        );
      }

      if (words.length === 0) {
        throw new AlignError(
          "mms-forced-align: align() requires at least one word, got an empty array"
        );
      }

      const { tokenIds, wordLengths } = wordsToTokenIds(words);
      const { emission, numFrames, vocabSize } = await runAcousticModel(bundle, waveform);

      const statePerFrame = viterbiAlign(emission, numFrames, vocabSize, tokenIds, BLANK_ID);
      const letterSpans = collapseToLetterSpans(statePerFrame, tokenIds);
      const wordSpans = groupIntoWordSpans(letterSpans, wordLengths);

      // wav2vec2's conv feature-extractor stack does not downsample at an exact,
      // constant 320-samples-per-frame ratio for every input length (kernel/stride/
      // padding effects on the conv stack mean the true ratio varies slightly by
      // clip length). Deriving the ratio from this clip's actual sample count and
      // emission frame count (matching torchaudio's own reference approach: samples
      // / num_frames / sample_rate) avoids a systematic, time-growing drift that a
      // fixed 320 constant introduces.
      const samplesPerFrame = waveform.length / numFrames;

      return wordSpans.map((span, i) => ({
        word: words[i],
        start: framesToSeconds(span.startFrame, samplesPerFrame),
        end: framesToSeconds(span.endFrame + 1, samplesPerFrame), // +1: endFrame is inclusive, end time is exclusive
        score: wordConfidence(emission, vocabSize, statePerFrame, span, tokenIds, BLANK_ID),
      }));
    },

    async dispose() {
      await bundle.dispose();
    },
  };
}

/**
 * Cheap confidence score: mean per-frame probability of the winning token across the
 * word's frames, including blank-state frames within the word's span (those frames
 * fall back to blankId). Note this is not purely a "non-blank letter" average — CTC
 * blank probabilities run close to 1.0 between letters, so scores skew high.
 */
function wordConfidence(
  emission: Float32Array,
  vocabSize: number,
  statePerFrame: number[],
  span: { startFrame: number; endFrame: number },
  tokenIds: number[],
  blankId: number
): number {
  let sum = 0;
  let count = 0;
  for (let frame = span.startFrame; frame <= span.endFrame; frame++) {
    const s = statePerFrame[frame];
    const isBlank = s % 2 === 0;
    const tokenId = isBlank ? blankId : tokenIds[(s - 1) / 2];
    sum += Math.exp(emission[frame * vocabSize + tokenId]);
    count++;
  }
  return count > 0 ? sum / count : 0;
}
