# mms-forced-align

CTC forced alignment for Node.js/TypeScript — given audio and the transcript
you already know was spoken in it, get back the start/end time of every word.
This is **not** speech-to-text: you already know the words, this package only
figures out *when* each one happens.

Uses Meta's MMS (Massively Multilingual Speech) forced-aligner acoustic model
(via an ONNX export) for the neural forward pass, and a from-scratch
TypeScript CTC Viterbi decoder for the alignment itself. Other forced-aligner
packages exist in JS (e.g. DTW-based approaches), but no published JS
implementation of *MMS-based CTC forced alignment* existed before this —
`torchaudio.pipelines.MMS_FA` and similar tools were Python-only.

## Install

```bash
npm install mms-forced-align
```

## Quick start

```ts
import { createAligner } from "mms-forced-align";

const aligner = await createAligner(); // downloads + caches the model on first use
const timings = await aligner.align(
  waveform,       // Float32Array, mono PCM, values in [-1, 1]
  16000,          // sampleRate — must be exactly 16000
  ["hello", "world"] // transcript words, in order
);
// [{ word: "hello", start: 0.12, end: 0.48 }, { word: "world", start: 0.52, end: 0.91 }]

await aligner.dispose();
```

Reuse one `aligner` across many `align()` calls — loading the ONNX session is
the expensive part.

Transcript words must be pre-cleaned before calling `align()`: the model's
vocabulary is 26 lowercase Latin letters plus apostrophe only — no digits, no
punctuation. Naively splitting a real sentence (`transcript.split(" ")`) will
include tokens like `"kiya."` or `"2024"` that throw `VocabError` — `align()`
throws rather than guessing what you meant. Strip punctuation/digits first:

```ts
const words = transcript.split(" ").map((w) => w.replace(/[^\w']/g, ""));
```

## Options

`createAligner(options)` accepts:

- `cacheDir?: string` — override where the model is downloaded/cached
  (default `~/.cache/mms-forced-align/`).
- `quantized?: boolean` — defaults to `true`. Uses the int8-quantized ONNX
  model (smaller download, faster inference). The default trades a few
  frames of word-boundary accuracy at speech pauses/silence for size and
  speed — in golden-fixture testing it missed the 20ms tolerance on 8/37
  words (up to 60.3ms off). Pass `quantized: false` for the full-precision
  model (~4x the download size): this package's TypeScript decoder was
  verified to reproduce `torchaudio.pipelines.MMS_FA`'s word timings to
  0.0ms across all 37 golden-fixture words with `quantized: false`. Use
  `quantized: false` when boundary-accurate timing (e.g. karaoke, subtitle
  sync at pauses) matters more than download size or latency.

  **Recommended for most callers:** an independent CPU benchmark against
  `torchaudio.pipelines.MMS_FA` (116-word Hinglish transcript, 3 runs per
  config) found `quantized: false` faster to align than both the default
  quantized model (21.33s vs 26.97s avg, ~21% faster) and Python/torchaudio's
  fp32 pipeline (~42% faster), while using less peak memory than the
  quantized model would suggest (~1.8GB vs Python's ~2.6GB) and matching
  Python's word timings to sub-millisecond average accuracy. The quantized
  model's only clear advantage is a smaller download/lower load latency —
  worth it mainly for cold-start-sensitive, single-shot invocations (e.g. a
  serverless function aligning one short clip per call). For a long-running
  process that loads the aligner once and reuses it (the pattern this
  package is designed for — see "Reuse one `aligner`" above), pass
  `quantized: false`.

## Scope (v1)

- Single model: `mms-300m-1130-forced-aligner`.
- Plain Latin-script/romanized transcript text only (e.g. English, or
  transliterated text like Hinglish) — this is what the model's base
  vocabulary (26 letters + apostrophe) handles.
- CPU inference only (`onnxruntime-node`), no GPU.
- Input must already be decoded mono PCM `Float32Array` at 16000 Hz — decode
  and resample your audio yourself (e.g. via `ffmpeg`) before calling
  `align()`. Passing a different sample rate throws rather than silently
  resampling.

**Not yet supported:**
- The `<star>` token for out-of-vocabulary/deleted words.
- Batch alignment of multiple clips in one call.
- GPU execution.
- Chunking of long audio — split long files yourself before aligning.

## Indic native-script romanization

The model's vocabulary is Latin-only, but `align()` still requires words in
that vocabulary. For text in an Indic script, this package can romanize the
transcript internally and align against the romanized form, while handing
you back timings keyed to your original native-script words. Three exports
cover this:

- `romanizeWord(word, langCode)` / `romanizeWords(words, langCode)` —
  transliterate one word or a list of words from a supported native script to
  the Latin form the model expects. Throws `RomanizeError` rather than
  silently dropping or mangling a word: on a script mismatch (e.g. Tamil text
  passed with `langCode: "hi-IN"`) or on content that can't be romanized.
  Already-Latin words (e.g. an English brand name code-switched into an Indic
  sentence) pass through unchanged, case preserved, instead of erroring.
- `alignNative(aligner, waveform, sampleRate, nativeWords, langCode)` —
  romanizes `nativeWords` internally, aligns the romanized form, then remaps
  the resulting timings back onto your original native-script words by
  index. Word count is guaranteed to match on both sides — it throws rather
  than ever returning a mis-indexed or word-dropped result.

```typescript
import { createAligner, alignNative } from "mms-forced-align";

const aligner = await createAligner();
const timings = await alignNative(
  aligner,
  waveform,       // Float32Array, mono PCM, values in [-1, 1]
  16000,          // sampleRate — must be exactly 16000
  ["आज", "मैंने", "काफी", "कुछ", "किया"],
  "hi-IN"
);
// [{ word: "आज", start: ..., end: ... }, ...] -- native-script words, real timings

await aligner.dispose();
```

`SUPPORTED_LANGUAGE_CODES` (and the `LanguageCode` type) list every value
accepted as `langCode`. As of this release there are 21 entries — 20 Indic
languages plus `en-IN` as a Latin passthrough (for already-romanized/English
text mixed into an otherwise-Indic pipeline):

| `LanguageCode` | Language | Script |
| --- | --- | --- |
| `hi-IN` | Hindi | Devanagari |
| `mr-IN` | Marathi | Devanagari |
| `ne-IN` | Nepali | Devanagari |
| `sa-IN` | Sanskrit | Devanagari |
| `mai-IN` | Maithili | Devanagari |
| `doi-IN` | Dogri | Devanagari |
| `kok-IN` | Konkani | Devanagari |
| `brx-IN` | Bodo | Devanagari |
| `bn-IN` | Bengali | Bengali |
| `as-IN` | Assamese | Bengali |
| `pa-IN` | Punjabi | Gurmukhi |
| `gu-IN` | Gujarati | Gujarati |
| `od-IN` | Odia | Oriya |
| `ta-IN` | Tamil | Tamil |
| `te-IN` | Telugu | Telugu |
| `kn-IN` | Kannada | Kannada |
| `ml-IN` | Malayalam | Malayalam |
| `ur-IN` | Urdu | Perso-Arabic |
| `ks-IN` | Kashmiri | Perso-Arabic |
| `sd-IN` | Sindhi | Perso-Arabic |
| `en-IN` | English | Latin (passthrough) |

**Not supported (explicit product decision):** `sat-IN` (Santali/Ol Chiki) and
`mni-IN` (Manipuri/Meitei Mayek). uroman's own data for these two scripts is
incomplete/unreliable, so porting it into this package wouldn't produce
accurate romanization either — these may be revisited if/when upstream data
improves.

**Known limitation — a handful of Perso-Arabic characters (`ur-IN`/`ks-IN`/`sd-IN`)
have no vocab-safe romanization.** A small number of Arabic Supplement/Extended
letters romanize (matching real uroman) to output outside `[a-z']` — notably
Sindhi `۽` ("and"), which real uroman itself renders as `&`. Rather than hand
the aligner text it can't consume, `romanizeWord`/`romanizeWords`/`alignNative`
throw `RomanizeError` for these words, naming the exact character responsible,
instead of inventing a non-uroman-matching substitute or failing silently
further downstream.

The character-level romanization data this package uses is extracted
directly from [uroman](https://github.com/isi-nlp/uroman) (see
[`src/romanize/data/README.md`](./src/romanize/data/README.md) for
provenance and regeneration instructions); the romanization *algorithm* is
this package's own from-scratch TypeScript implementation of the relevant
subset of uroman's approach, built against that data. Practically, this
means `romanizeWord`/`romanizeWords`/`alignNative`'s accuracy for a given
language tracks uroman's own accuracy for that language — it is not a
separate, hand-built approximation with its own error profile.

## Model download & licensing — read before using commercially

On first use, `createAligner()` downloads the ONNX model weights from Hugging
Face (`onnx-community/mms-300m-1130-forced-aligner-ONNX`) and caches them
under `~/.cache/mms-forced-align/` (override with `cacheDir`). Weights are
never bundled in this npm package.

**The model weights themselves are licensed CC-BY-NC-4.0 (non-commercial)**,
per both the [ONNX export](https://huggingface.co/onnx-community/mms-300m-1130-forced-aligner-ONNX)
and the [source model](https://huggingface.co/MahmoudAshraf/mms-300m-1130-forced-aligner)
on Hugging Face. This package's own code is MIT-licensed, but if you plan to
use this in a commercial product, review that license yourself — it may
restrict your use case even though this package doesn't redistribute the
weights.

## Credits

- [`onnx-community/mms-300m-1130-forced-aligner-ONNX`](https://huggingface.co/onnx-community/mms-300m-1130-forced-aligner-ONNX) — the ONNX model this package loads.
- [`MahmoudAshraf/mms-300m-1130-forced-aligner`](https://huggingface.co/MahmoudAshraf/mms-300m-1130-forced-aligner) — source model.
- [`MahmoudAshraf/ctc-forced-aligner`](https://github.com/MahmoudAshraf97/ctc-forced-aligner) — the Python tool this package's decode algorithm was validated against.
- Meta AI — [MMS (Massively Multilingual Speech)](https://ai.meta.com/blog/multilingual-model-speech-recognition/), the underlying acoustic model family.
