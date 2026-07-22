import { deflateSync, inflateSync } from "node:zlib";

/**
 * A minimal PNG encoder, for the golden-image regression harness.
 *
 * Test-only, and deliberately not in `src`: `packages/core` is pure TypeScript
 * with no DOM *and* no Node built-ins in its public surface, so a renderer that
 * needs `node:zlib` cannot live there. The app encodes through a canvas
 * instead; this exists so a regression harness can run headless.
 *
 * The validation ladder pins physics. Nothing pins *images* — a change to
 * exposure, orientation, resampling or channel order passes every rung and
 * still ruins the picture. Reference renders plus a diff catch precisely the
 * class of defect unit tests are blind to. They are a **regression guard, not
 * validation**: a golden image proves the render has not changed, never that
 * it was right in the first place.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encode 8-bit RGBA (row-major, 4 bytes/pixel) as a PNG. */
export function encodePng(rgba: Uint8ClampedArray, width: number, height: number): Buffer {
  if (rgba.length !== width * height * 4) {
    throw new Error(`expected ${width * height * 4} bytes, got ${rgba.length}`);
  }
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const o = y * (width * 4 + 1);
    raw[o] = 0; // filter: none — the images are small and this stays reproducible
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, o + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    // Fixed level so the same pixels always produce the same file, which lets
    // a mismatch be diagnosed by byte comparison before decoding anything.
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

export interface ImageDiff {
  /** Largest single-channel difference, 0…255. */
  readonly maxChannelDelta: number;
  /** Mean absolute channel difference, 0…255. */
  readonly meanChannelDelta: number;
  /** Fraction of pixels differing by more than 1/255 in any channel. */
  readonly changedFraction: number;
}

/**
 * Compare two RGBA buffers.
 *
 * All three numbers are reported because they fail differently: a re-scaled
 * exposure moves the mean everywhere, a flipped axis moves a large fraction by
 * a lot, and a single-pixel centring slip moves almost nothing except the max.
 * A harness that watched only one of them would sleep through the other two.
 */
export function diffRgba(a: Uint8ClampedArray, b: Uint8ClampedArray): ImageDiff {
  if (a.length !== b.length) throw new Error(`size mismatch: ${a.length} vs ${b.length}`);
  let max = 0;
  let sum = 0;
  let changed = 0;
  let channels = 0;
  for (let i = 0; i < a.length; i += 4) {
    let pixelMax = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[i + c]! - b[i + c]!);
      if (d > pixelMax) pixelMax = d;
      sum += d;
      channels++;
    }
    if (pixelMax > max) max = pixelMax;
    if (pixelMax > 1) changed++;
  }
  return {
    maxChannelDelta: max,
    meanChannelDelta: channels > 0 ? sum / channels : 0,
    changedFraction: a.length > 0 ? changed / (a.length / 4) : 0,
  };
}

/** Decode the RGBA pixels of a PNG this module wrote. */
export function decodePng(png: Buffer): { rgba: Uint8ClampedArray; width: number; height: number } {
  // Only the subset `encodePng` emits: 8-bit RGBA, filter 0, one IDAT.
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const parts: Buffer[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") parts.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const o = y * (width * 4 + 1);
    if (raw[o] !== 0) throw new Error(`unsupported PNG filter ${raw[o]} on row ${y}`);
    for (let i = 0; i < width * 4; i++) rgba[y * width * 4 + i] = raw[o + 1 + i]!;
  }
  return { rgba, width, height };
}
