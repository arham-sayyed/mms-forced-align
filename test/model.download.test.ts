import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HF_REPO,
  defaultCacheDir,
  modelFileName,
  ensureModelDownloaded,
} from "../src/model";

describe("defaultCacheDir", () => {
  it("returns a path under the user's home cache dir", () => {
    const dir = defaultCacheDir();
    expect(dir).toContain("mms-forced-align");
  });
});

describe("modelFileName", () => {
  it("returns the quantized filename by default", () => {
    expect(modelFileName(true)).toBe("onnx/model_quantized.onnx");
  });
  it("returns the full-precision filename when quantized=false", () => {
    expect(modelFileName(false)).toBe("onnx/model.onnx");
  });
});

describe("ensureModelDownloaded", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("downloads the file via fetch and writes it into cacheDir", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mms-fa-test-"));
    const body = new Uint8Array([1, 2, 3, 4]);
    const fakeFetch = (async (url: string | URL) => {
      expect(String(url)).toBe(
        `https://huggingface.co/${HF_REPO}/resolve/main/onnx/model_quantized.onnx`
      );
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const path = await ensureModelDownloaded(tmpDir, true, fakeFetch);
    expect(existsSync(path)).toBe(true);
    expect(new Uint8Array(readFileSync(path))).toEqual(body);
  });

  it("does not re-download if the file already exists in cacheDir", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mms-fa-test-"));
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response(new Uint8Array([9]), { status: 200 });
    }) as unknown as typeof fetch;

    await ensureModelDownloaded(tmpDir, true, fakeFetch);
    await ensureModelDownloaded(tmpDir, true, fakeFetch);
    expect(calls).toBe(1);
  });

  it("throws a clear error on a non-OK HTTP response", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mms-fa-test-"));
    const fakeFetch = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    await expect(ensureModelDownloaded(tmpDir, true, fakeFetch)).rejects.toThrow(/404/);
  });

  it("throws a clear error and does not cache the file when the stream ends short of Content-Length", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mms-fa-test-"));
    // Response declares a Content-Length larger than the bytes actually delivered,
    // simulating a proxy/connection issue that ends the stream early without an
    // HTTP-level error — pipeline() resolves successfully despite the truncation.
    const declaredBytes = 10;
    const actualBody = new Uint8Array([1, 2, 3, 4]); // only 4 bytes actually sent
    const fakeFetch = (async () => {
      const headers = new Headers({ "content-length": String(declaredBytes) });
      return new Response(actualBody, { status: 200, headers });
    }) as unknown as typeof fetch;

    await expect(ensureModelDownloaded(tmpDir, true, fakeFetch)).rejects.toThrow(
      /truncated.*expected 10 bytes, got 4/
    );

    const localPath = join(tmpDir, "onnx_model_quantized.onnx");
    expect(existsSync(localPath)).toBe(false);
  });

  it("does not fail the download when Content-Length is absent", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "mms-fa-test-"));
    const body = new Uint8Array([1, 2, 3, 4]);
    const fakeFetch = (async () => {
      // Response constructed from a body without an explicit Content-Length header
      // set may still auto-compute one for a plain Uint8Array in some runtimes, so
      // explicitly strip it to exercise the "header absent" path.
      const response = new Response(body, { status: 200 });
      response.headers.delete("content-length");
      return response;
    }) as unknown as typeof fetch;

    const path = await ensureModelDownloaded(tmpDir, true, fakeFetch);
    expect(existsSync(path)).toBe(true);
    expect(new Uint8Array(readFileSync(path))).toEqual(body);
  });
});
