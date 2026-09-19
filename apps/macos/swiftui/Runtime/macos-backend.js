import os from "node:os";
import path from "node:path";

// The shared bridge currently derives its durable data paths from APPDATA.
// Point that base at the standard macOS Application Support directory so the
// native client reuses the existing Electron client's local session and files.
process.env.APPDATA ||= path.join(os.homedir(), "Library", "Application Support");
process.env.BXB_MACOS_NATIVE = "1";

await import("../../../../backend/bridge/winui-backend.js");
