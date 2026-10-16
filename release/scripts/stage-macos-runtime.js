import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  repo: { type: "string" }, app: { type: "string" }, node: { type: "string" }, version: { type: "string" },
} });

try {
  for (const name of ["repo", "app", "node", "version"]) {
    if (!values[name]) throw new Error(`Missing --${name}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(values.version)) throw new Error("Invalid release version; use major.minor.patch");
  const repo = path.resolve(values.repo);
  const app = path.resolve(values.app);
  const runtime = path.join(app, "Contents/Resources/BXBRuntime");
  const sources = [
    "backend/src", "backend/bridge", "apps/macos/swiftui/Runtime/macos-backend.js",
    "package.json", "package-lock.json", "LICENSE",
  ];
  await fs.access(path.join(app, "Contents/MacOS"));
  await fs.access(values.node);
  for (const source of sources) await fs.access(path.join(repo, source));
  if (await fs.stat(runtime).then(() => true, () => false)) throw new Error("Runtime already exists; use a fresh app build");
  const nodeTarget = path.join(app, "Contents/Helpers/node");
  if (await fs.stat(nodeTarget).then(() => true, () => false)) throw new Error("Bundled Node already exists");
  await fs.mkdir(runtime, { recursive: true });
  for (const source of sources) {
    const target = path.join(runtime, source === "apps/macos/swiftui/Runtime/macos-backend.js" ? "Runtime/macos-backend.js" : source);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(path.join(repo, source), target, { recursive: true, dereference: false });
  }
  for (const name of ["package.json", "package-lock.json"]) {
    const file = path.join(runtime, name);
    const contents = JSON.parse(await fs.readFile(file, "utf8"));
    contents.version = values.version;
    if (contents.packages?.[""]) contents.packages[""].version = values.version;
    await fs.writeFile(file, `${JSON.stringify(contents, null, 2)}\n`);
  }
  await fs.mkdir(path.dirname(nodeTarget), { recursive: true });
  await fs.copyFile(values.node, nodeTarget, fs.constants.COPYFILE_EXCL);
  await fs.chmod(nodeTarget, 0o755);
  console.log(`Staged macOS runtime: ${runtime}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
