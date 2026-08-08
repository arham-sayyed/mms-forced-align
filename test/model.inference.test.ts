import { describe, it, expect } from "vitest";
import { loadModel, runAcousticModel } from "../src/model";

// Real network download on first run (~317MB, cached afterward). Long timeout.
describe("model inference (integration)", () => {
  it("loads the quantized model and runs a forward pass on 1s of silence", async () => {
    const bundle = await loadModel({ quantized: true });
    try {
      const waveform = new Float32Array(16000); // 1s of silence at 16kHz
      const { emission, numFrames, vocabSize } = await runAcousticModel(bundle, waveform);
      expect(vocabSize).toBe(31);
      expect(numFrames).toBeGreaterThan(0);
      expect(emission.length).toBe(numFrames * vocabSize);
      // emission is log-softmax output: every row should sum to ~1 after exponentiating.
      let rowSum = 0;
      for (let v = 0; v < vocabSize; v++) rowSum += Math.exp(emission[v]);
      expect(rowSum).toBeCloseTo(1, 1);
    } finally {
      await bundle.dispose();
    }
  }, 300_000);
});
