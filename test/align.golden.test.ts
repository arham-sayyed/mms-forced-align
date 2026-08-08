import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error - node-wav has no bundled types
import wav from "node-wav";
import { createAligner, type Aligner } from "../src/index";

const FIXTURES_DIR = join(__dirname, "fixtures");
const TOLERANCE_SECONDS = 0.02; // ~1 frame, per spec §6

// Fixtures are not checked into the repo (spec §6: generate your own locally
// via `scripts/generate_fixtures.py` from your own audio + transcript — see
// README "Validating against a Python reference"). This test discovers
// whatever golden .wav/.json pairs exist and skips gracefully if none do,
// so a fresh clone's `npm test` doesn't hard-fail for missing fixtures.
const entries = existsSync(FIXTURES_DIR) ? readdirSync(FIXTURES_DIR) : [];
const FIXTURES = entries
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .filter((name) => entries.includes(`${name}.wav`));

const describeOrSkip = FIXTURES.length > 0 ? describe : describe.skip;

describeOrSkip("align (integration, golden fixtures vs Python torchaudio.pipelines.MMS_FA)", () => {
  let aligner: Aligner;

  beforeAll(async () => {
    // Deliberate deviation from a plain createAligner(): use the full-precision
    // model here, not the int8-quantized default. This isolates "is the decode
    // algorithm correctly ported" (spec §6's actual acceptance bar) from
    // int8-quantization noise at low-confidence frames, a separate, expected
    // trade-off the spec already anticipated (§3: full-precision is "an opt-in
    // option for accuracy comparisons during testing"). Approved deviation —
    // see task-8-report.md for the diagnostic evidence behind this choice.
    aligner = await createAligner({ quantized: false });
  }, 300_000);

  afterAll(async () => {
    await aligner.dispose();
  });

  for (const name of FIXTURES) {
    it(`matches the Python reference within ${TOLERANCE_SECONDS * 1000}ms for ${name}`, async () => {
      const wavPath = join(__dirname, "fixtures", `${name}.wav`);
      const jsonPath = join(__dirname, "fixtures", `${name}.json`);
      const { words, golden } = JSON.parse(readFileSync(jsonPath, "utf-8")) as {
        words: string[];
        golden: Array<{ word: string; start: number; end: number }>;
      };

      const buffer = readFileSync(wavPath);
      const decoded = wav.decode(buffer);
      expect(decoded.sampleRate).toBe(16000);
      const waveform: Float32Array = decoded.channelData[0];

      const result = await aligner.align(waveform, 16000, words);

      expect(result).toHaveLength(golden.length);
      result.forEach((timing, i) => {
        expect(timing.start).toBeGreaterThanOrEqual(golden[i].start - TOLERANCE_SECONDS);
        expect(timing.start).toBeLessThanOrEqual(golden[i].start + TOLERANCE_SECONDS);
        expect(timing.end).toBeGreaterThanOrEqual(golden[i].end - TOLERANCE_SECONDS);
        expect(timing.end).toBeLessThanOrEqual(golden[i].end + TOLERANCE_SECONDS);
      });
    }, 120_000);
  }
});
