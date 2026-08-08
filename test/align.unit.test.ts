import { describe, it, expect, vi } from "vitest";

vi.mock("../src/model", () => ({
  loadModel: vi.fn(async () => ({
    session: {},
    dispose: vi.fn(async () => {}),
  })),
  runAcousticModel: vi.fn(),
}));

import { createAligner, AlignError } from "../src/align";
import { runAcousticModel } from "../src/model";

describe("Aligner.align input validation", () => {
  it("throws a clear error when sampleRate is not 16000", async () => {
    const aligner = await createAligner();
    await expect(
      aligner.align(new Float32Array(16000), 44100, ["hi"])
    ).rejects.toThrow(/16000/);
    await expect(
      aligner.align(new Float32Array(16000), 44100, ["hi"])
    ).rejects.toThrow(AlignError);
    await aligner.dispose();
  });

  it("throws a clear error when words is empty, before running the acoustic model", async () => {
    vi.mocked(runAcousticModel).mockClear();
    const aligner = await createAligner();
    await expect(
      aligner.align(new Float32Array(16000), 16000, [])
    ).rejects.toThrow(AlignError);
    await expect(
      aligner.align(new Float32Array(16000), 16000, [])
    ).rejects.toThrow(/empty array/);
    expect(runAcousticModel).not.toHaveBeenCalled();
    await aligner.dispose();
  });
});
