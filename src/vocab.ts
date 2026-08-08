import vocabJson from "./vocab.json";

const VOCAB: Record<string, number> = vocabJson;

export const BLANK_ID = VOCAB["<blank>"];

export class VocabError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VocabError";
  }
}

/**
 * Maps transcript words to the model's letter-token-id sequence.
 * Lowercases internally (this model's vocab has no uppercase entries);
 * callers get back only tokenIds/wordLengths here — align.ts is
 * responsible for re-attaching the original word strings to the output.
 */
export function wordsToTokenIds(words: string[]): {
  tokenIds: number[];
  wordLengths: number[];
} {
  const tokenIds: number[] = [];
  const wordLengths: number[] = [];

  for (const word of words) {
    const lower = word.toLowerCase();
    if (lower.length === 0) {
      throw new VocabError("wordsToTokenIds: encountered an empty word");
    }
    let count = 0;
    for (const ch of lower) {
      const id = VOCAB[ch];
      if (id === undefined) {
        throw new VocabError(
          `wordsToTokenIds: character "${ch}" in word "${word}" is not in the model vocabulary ` +
            `(plain Latin letters + apostrophe only — strip punctuation before calling align())`
        );
      }
      tokenIds.push(id);
      count++;
    }
    wordLengths.push(count);
  }

  return { tokenIds, wordLengths };
}
