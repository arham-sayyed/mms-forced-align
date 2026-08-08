# mms-forced-align

CTC forced alignment for Node.js/TypeScript — given audio and the transcript
you already know was spoken in it, get back the start/end time of every word.
This is **not** speech-to-text: you already know the words, this package only
figures out *when* each one happens.

Uses Meta's MMS (Massively Multilingual Speech) forced-aligner acoustic model
(via an ONNX export) for the neural forward pass, and a from-scratch
TypeScript CTC Viterbi decoder for the alignment itself — no published JS
implementation of this existed before, only Python.

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
- Non-Latin scripts requiring uroman-style romanization.
- Batch alignment of multiple clips in one call.
- GPU execution.
- Chunking of long audio — split long files yourself before aligning.

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
