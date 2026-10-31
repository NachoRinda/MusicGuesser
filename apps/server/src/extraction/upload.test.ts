import { MAX_SCREENSHOT_BYTES } from "@mg/shared";
import { describe, expect, it } from "vitest";
import { validateUpload } from "./upload.js";

const img = (bytes = 100, mediaType = "image/png") => ({ mediaType, data: Buffer.alloc(bytes, 1) });

describe("validateUpload", () => {
  it("accepts 1 or 2 supported images, as Buffers", () => {
    for (const images of [[img()], [img(10, "image/jpeg"), img(10, "image/webp")]]) {
      const res = validateUpload({ images });
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.images).toHaveLength(images.length);
        expect(Buffer.isBuffer(res.images[0]!.data)).toBe(true);
      }
    }
  });

  it("accepts ArrayBuffer / Uint8Array payloads too", () => {
    const res = validateUpload({ images: [{ mediaType: "image/png", data: new Uint8Array([1, 2, 3]).buffer }] });
    expect(res.ok && res.images[0]!.data.length).toBe(3);
  });

  it.each([
    ["no images", { images: [] }],
    ["more than 2", { images: [img(), img(), img()] }],
    ["unsupported type", { images: [img(10, "image/gif")] }],
    ["empty image", { images: [img(0)] }],
    ["too big", { images: [img(MAX_SCREENSHOT_BYTES + 1)] }],
    ["data is not binary", { images: [{ mediaType: "image/png", data: "aGVsbG8=" }] }],
    ["missing request", undefined],
    ["images is not an array", { images: "nope" }],
  ])("rejects %s with INVALID_UPLOAD", (_label, req) => {
    expect(validateUpload(req)).toEqual({ ok: false, error: "INVALID_UPLOAD" });
  });
});
