import { existsSync, mkdirSync, createWriteStream, renameSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as ort from "onnxruntime-node";

export const HF_REPO = "onnx-community/mms-300m-1130-forced-aligner-ONNX";

export function defaultCacheDir(): string {
  return join(homedir(), ".cache", "mms-forced-align");
}

export function modelFileName(quantized: boolean): string {
  return quantized ? "onnx/model_quantized.onnx" : "onnx/model.onnx";
}

export async function ensureModelDownloaded(
  cacheDir: string,
  quantized: boolean,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const relPath = modelFileName(quantized);
  const localPath = join(cacheDir, relPath.replace("/", "_"));

  if (existsSync(localPath)) {
    return localPath;
  }

  const url = `https://huggingface.co/${HF_REPO}/resolve/main/${relPath}`;
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) {
    throw new Error(
      `mms-forced-align: failed to download model from ${url} (HTTP ${response.status})`
    );
  }

  mkdirSync(dirname(localPath), { recursive: true });
  // Unique per download attempt: two concurrent createAligner() calls (or two
  // processes) racing to download the same model must not write to the same
  // temp file, or the last renameSync could win with an interleaved/corrupt
  // result. renameSync itself stays atomic on the same filesystem, so with a
  // unique temp path concurrent downloads just waste bandwidth instead of
  // corrupting the cache.
  const tmpPath = `${localPath}.${process.pid}.${randomUUID()}.download`;

  const contentLengthHeader = response.headers.get("content-length");
  const expectedBytes = contentLengthHeader !== null ? Number(contentLengthHeader) : null;

  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(tmpPath));

  if (expectedBytes !== null && !Number.isNaN(expectedBytes)) {
    const actualBytes = statSync(tmpPath).size;
    if (actualBytes !== expectedBytes) {
      unlinkSync(tmpPath);
      throw new Error(
        `mms-forced-align: download of ${url} appears truncated ` +
          `(expected ${expectedBytes} bytes, got ${actualBytes}) — try again`
      );
    }
  }

  renameSync(tmpPath, localPath);

  return localPath;
}

/** Wav2Vec2FeatureExtractor's zero_mean_unit_var_norm, replicated exactly (spec-verified formula). */
export function normalizeWaveform(waveform: Float32Array): Float32Array {
  const n = waveform.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += waveform[i];
  mean /= n;

  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = waveform[i] - mean;
    variance += d * d;
  }
  variance /= n;

  const denom = Math.sqrt(variance + 1e-7);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (waveform[i] - mean) / denom;
  return out;
}

export interface ModelBundle {
  session: ort.InferenceSession;
  dispose(): Promise<void>;
}

export async function loadModel(
  options: { cacheDir?: string; quantized?: boolean } = {}
): Promise<ModelBundle> {
  const cacheDir = options.cacheDir ?? defaultCacheDir();
  const quantized = options.quantized ?? true;

  const modelPath = await ensureModelDownloaded(cacheDir, quantized);
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
    graphOptimizationLevel: "all",
  });

  return {
    session,
    dispose: async () => {
      await session.release();
    },
  };
}

export async function runAcousticModel(
  bundle: ModelBundle,
  waveform: Float32Array
): Promise<{ emission: Float32Array; numFrames: number; vocabSize: number }> {
  const normalized = normalizeWaveform(waveform);
  const inputName = bundle.session.inputNames[0];
  const outputName = bundle.session.outputNames[0];

  const inputTensor = new ort.Tensor("float32", normalized, [1, normalized.length]);
  const results = await bundle.session.run({ [inputName]: inputTensor });
  const outputTensor = results[outputName];

  const dims = outputTensor.dims; // [1, numFrames, vocabSize]
  const numFrames = dims[1];
  const vocabSize = dims[2];

  // The ONNX export's "logits" output is raw (unnormalized) per-frame class scores,
  // not log-probabilities. Forced alignment operates in log-probability space, so
  // apply a numerically-stable log_softmax over the vocab dimension of each frame.
  const logits = outputTensor.data as Float32Array;
  const emission = new Float32Array(logits.length);
  for (let f = 0; f < numFrames; f++) {
    const base = f * vocabSize;
    let max = -Infinity;
    for (let v = 0; v < vocabSize; v++) {
      const x = logits[base + v];
      if (x > max) max = x;
    }
    let sumExp = 0;
    for (let v = 0; v < vocabSize; v++) {
      sumExp += Math.exp(logits[base + v] - max);
    }
    const logSumExp = max + Math.log(sumExp);
    for (let v = 0; v < vocabSize; v++) {
      emission[base + v] = logits[base + v] - logSumExp;
    }
  }

  return {
    emission,
    numFrames,
    vocabSize,
  };
}
