import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const defaultAppSupportDir = () =>
  process.env.BANXUEBANG_APP_SUPPORT_DIR || resolveAppSupportDir();

function resolveAppSupportDir() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "BXB Student");
  }

  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
      "BXB Student",
    );
  }

  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    "BXB Student",
  );
}

const defaultSessionFile = () =>
  process.env.BANXUEBANG_SESSION_FILE ||
  path.join(defaultAppSupportDir(), ".banxuebang", "session.json");

export class SessionStore {
  constructor(sessionFile = defaultSessionFile()) {
    this.sessionFile = sessionFile;
  }

  async load() {
    try {
      const raw = await readFile(this.sessionFile, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async save(session) {
    const dir = path.dirname(this.sessionFile);
    await mkdir(dir, { recursive: true });
    await writeFile(this.sessionFile, `${JSON.stringify(session, null, 2)}\n`, "utf8");
    return session;
  }

  async clear() {
    try {
      await rm(this.sessionFile, { force: true });
    } catch (error) {
      if (error && error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}
