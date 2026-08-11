import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "ocr_vision.swift");

/**
 * Run macOS Vision OCR on an image file. Returns recognized text.
 * Throws if the Swift runtime is unavailable or OCR fails.
 */
export async function runOcr(imagePath) {
  const { stdout } = await execFileAsync("swift", [scriptPath, imagePath], {
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return String(stdout || "").trim();
}
