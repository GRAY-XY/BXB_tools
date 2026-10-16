import { createCanvas, loadImage } from "@napi-rs/canvas";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const INVALID_IMAGE_MESSAGE = "无法读取图片，请使用有效的 PNG、JPEG、WebP、GIF、BMP 或 AVIF 文件。";

function modelImageFormat(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return { mimeType: "image/png", extension: ".png" };
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { mimeType: "image/jpeg", extension: ".jpg" };
  }
  if (["GIF87a", "GIF89a"].includes(buffer.toString("ascii", 0, 6))) {
    return { mimeType: "image/gif", extension: ".gif" };
  }
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { mimeType: "image/webp", extension: ".webp" };
  }
  return null;
}

// Use the actual bytes: clipboard streams and imported files can be mislabeled.
export async function normalizeModelImage(buffer) {
  if (!buffer.length || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("图片为空或超过 25 MB。");
  }
  const format = modelImageFormat(buffer);
  if (format) return { buffer, ...format };

  const isBmp = buffer.length >= 26 && buffer.toString("ascii", 0, 2) === "BM"
    && buffer.readUInt32LE(10) >= 26 && buffer.readUInt32LE(10) < buffer.length
    && buffer.readUInt32LE(14) >= 12 && 14 + buffer.readUInt32LE(14) <= buffer.length;
  const isAvif = buffer.length >= 16 && buffer.toString("ascii", 4, 8) === "ftyp"
    && buffer.readUInt32BE(0) >= 16 && buffer.readUInt32BE(0) <= buffer.length
    && (buffer.toString("ascii", 8, 12) === "avif" || buffer.toString("ascii", 8, 12) === "avis");
  if (!isBmp && !isAvif) throw new Error(INVALID_IMAGE_MESSAGE);

  let image;
  let timeout;
  try {
    image = await Promise.race([
      loadImage(buffer),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Image decoding timed out")), 10000);
      }),
    ]);
  } catch {
    throw new Error(INVALID_IMAGE_MESSAGE);
  } finally {
    clearTimeout(timeout);
  }
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  const png = await canvas.encode("png");
  if (png.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("转换后的 PNG 图片超过 25 MB，请缩小图片后重试。");
  }
  return { buffer: png, mimeType: "image/png", extension: ".png" };
}
