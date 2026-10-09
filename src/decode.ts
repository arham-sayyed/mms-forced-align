export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecodeError";
  }
}

/** ext = [blank, t0, blank, t1, blank, ..., t(N-1), blank], length L = 2N+1. */
export function buildExtendedSequence(tokenIds: number[], blankId: number): number[] {
  const ext: number[] = [blankId];
  for (const id of tokenIds) {
    ext.push(id, blankId);
  }
  return ext;
}

const NEG_INF = -Infinity;

/**
 * CTC forced-alignment Viterbi decode. Returns, for every frame,
 * which position in the extended label sequence was active — the caller
 * collapses this into letter/word spans.
 */
export function viterbiAlign(
  emission: Float32Array,
  numFrames: number,
  vocabSize: number,
  tokenIds: number[],
  blankId: number
): number[] {
  if (tokenIds.length === 0) {
    throw new DecodeError("viterbiAlign: tokenIds must not be empty");
  }

  const ext = buildExtendedSequence(tokenIds, blankId);
  const L = ext.length;
  const at = (t: number, v: number) => emission[t * vocabSize + v];

  const backpointers: Int8Array[] = []; // values: 0 = from s, 1 = from s-1, 2 = from s-2
  let alphaPrev = new Float64Array(L).fill(NEG_INF);
  alphaPrev[0] = at(0, ext[0]);
  if (L > 1) alphaPrev[1] = at(0, ext[1]);

  for (let t = 1; t < numFrames; t++) {
    const alphaCur = new Float64Array(L).fill(NEG_INF);
    const bp = new Int8Array(L);
    for (let s = 0; s < L; s++) {
      let best = alphaPrev[s]; // stay
      let bestFrom = 0;
      if (s - 1 >= 0 && alphaPrev[s - 1] > best) {
        best = alphaPrev[s - 1]; // advance
        bestFrom = 1;
      }
      const canSkip = s - 2 >= 0 && ext[s] !== blankId && ext[s] !== ext[s - 2];
      if (canSkip && alphaPrev[s - 2] > best) {
        best = alphaPrev[s - 2]; // skip a blank
        bestFrom = 2;
      }
      alphaCur[s] = best === NEG_INF ? NEG_INF : best + at(t, ext[s]);
      bp[s] = bestFrom;
    }
    backpointers.push(bp);
    alphaPrev = alphaCur;
  }

  const endA = alphaPrev[L - 1];
  const endB = L >= 2 ? alphaPrev[L - 2] : NEG_INF;
  if (endA === NEG_INF && endB === NEG_INF) {
    throw new DecodeError(
      "viterbiAlign: no valid alignment path exists for this audio/transcript pair " +
        "(audio is too short for the given transcript, or emission quality is too low)"
    );
  }

  let s = endA >= endB ? L - 1 : L - 2;
  const statePerFrame = new Array<number>(numFrames);
  statePerFrame[numFrames - 1] = s;
  for (let t = numFrames - 1; t > 0; t--) {
    const from = backpointers[t - 1][s];
    if (from === 1) s = s - 1;
    else if (from === 2) s = s - 2;
    // from === 0 (stay): s unchanged
    statePerFrame[t - 1] = s;
  }

  return statePerFrame;
}

export interface LetterSpan {
  tokenIndex: number;
  startFrame: number;
  endFrame: number;
}

export interface FrameSpan {
  startFrame: number;
  endFrame: number;
}

/**
 * Converts extended-sequence state-per-frame into merged per-token frame spans.
 * Even state index -> blank (no letter), odd state index `s` ->
 * token index `(s-1)/2`. Blank/token parity is a property of buildExtendedSequence's
 * layout, not of the blankId value, so no blankId parameter is needed here.
 */
export function collapseToLetterSpans(
  statePerFrame: number[],
  tokenIds: number[]
): LetterSpan[] {
  const spans: LetterSpan[] = [];
  let current: LetterSpan | null = null;

  for (let frame = 0; frame < statePerFrame.length; frame++) {
    const s = statePerFrame[frame];
    const isBlank = s % 2 === 0;
    if (isBlank) {
      current = null;
      continue;
    }
    const tokenIndex = (s - 1) / 2;
    if (tokenIndex < 0 || tokenIndex >= tokenIds.length) {
      throw new DecodeError(
        `collapseToLetterSpans: decoded tokenIndex ${tokenIndex} out of bounds for tokenIds.length=${tokenIds.length}`
      );
    }
    if (current && current.tokenIndex === tokenIndex) {
      current.endFrame = frame;
    } else {
      current = { tokenIndex, startFrame: frame, endFrame: frame };
      spans.push(current);
    }
  }

  return spans;
}

/** Groups per-letter spans into per-word spans using each word's letter count. */
export function groupIntoWordSpans(
  letterSpans: LetterSpan[],
  wordLengths: number[]
): FrameSpan[] {
  const totalLetters = wordLengths.reduce((a, b) => a + b, 0);
  if (letterSpans.length !== totalLetters) {
    throw new DecodeError(
      `groupIntoWordSpans: expected ${totalLetters} letter spans (sum of wordLengths), got ${letterSpans.length}`
    );
  }

  const wordSpans: FrameSpan[] = [];
  let cursor = 0;
  for (const length of wordLengths) {
    const wordLetters = letterSpans.slice(cursor, cursor + length);
    wordSpans.push({
      startFrame: wordLetters[0].startFrame,
      endFrame: wordLetters[wordLetters.length - 1].endFrame,
    });
    cursor += length;
  }
  return wordSpans;
}

/** Converts a frame index to seconds. Default stride is 320 samples/frame (wav2vec2); align() passes the clip's measured ratio instead. */
export function framesToSeconds(
  frame: number,
  samplesPerFrame: number = 320,
  sampleRate: number = 16000
): number {
  return (frame * samplesPerFrame) / sampleRate;
}
