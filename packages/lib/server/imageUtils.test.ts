// @vitest-environment node
import { Buffer } from "node:buffer";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { convertSvgToPng, detectContentType, resizeImage } from "./imageUtils";

function createImage() {
  return sharp({ create: { width: 12, height: 8, channels: 3, background: "blue" } });
}

describe("image processing with the patched sharp runtime", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    "jpeg",
    "png",
    "webp",
    "avif",
  ] as const)("detects and resizes %s without changing format", async (format) => {
    const buffer = await createImage().toFormat(format).toBuffer();
    const contentType = `image/${format}`;

    expect(await detectContentType(buffer)).toBe(contentType);
    const result = await resizeImage({ buffer, width: 6, height: 4 });

    expect(result.contentType).toBe(contentType);
    expect(await detectContentType(result.buffer)).toBe(contentType);
    expect(await sharp(result.buffer).metadata()).toMatchObject({ width: 6, height: 4 });
  });

  it.each([
    "av1",
    "hevc",
  ] as const)("classifies the HEIF metadata fallback with %s compression", async (compression) => {
    const buffer = await createImage().avif().toBuffer();
    const metadata = await sharp(buffer).metadata();
    expect(metadata).toMatchObject({ format: "heif", compression: "av1" });
    const metadataSpy = vi.spyOn(sharp.prototype, "metadata").mockResolvedValue({ ...metadata, compression });

    expect(await detectContentType(Buffer.from("requires metadata fallback"))).toBe(
      compression === "av1" ? "image/avif" : null
    );
    expect(metadataSpy).toHaveBeenCalledOnce();
  });

  it("converts a synthetic SVG to a readable PNG", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"/>');
    const result = await convertSvgToPng(`data:image/svg+xml;base64,${svg.toString("base64")}`);

    expect(result.startsWith("data:image/png;base64,")).toBe(true);
    expect(await sharp(Buffer.from(result.split(",")[1], "base64")).metadata()).toMatchObject({
      format: "png",
      width: 12,
      height: 8,
    });
  });

  it("rejects unsupported TIFF input", async () => {
    expect(await detectContentType(await createImage().tiff().toBuffer())).toBeNull();
  });

  it("rejects unrecognizable input", async () => {
    expect(await detectContentType(Buffer.from("not an image"))).toBeNull();
  });
});
