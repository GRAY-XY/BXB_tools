import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const defaultSessionFile = () =>
  process.env.BANXUEBANG_SESSION_FILE ||
  path.join(process.cwd(), ".banxuebang", "session.json");

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
