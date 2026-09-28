import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { BanxuebangClient } from "../src/banxuebang-client.js";

async function setup(context) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bxb-homework-download-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const canonicalWorkspace = await fs.realpath(workspace);

  const previousWorkspace = process.env.BANXUEBANG_WORKSPACE_DIR;
  const previousFetch = globalThis.fetch;
  process.env.BANXUEBANG_WORKSPACE_DIR = workspace;
  context.after(async () => {
    if (previousWorkspace === undefined) delete process.env.BANXUEBANG_WORKSPACE_DIR;
    else process.env.BANXUEBANG_WORKSPACE_DIR = previousWorkspace;
    globalThis.fetch = previousFetch;
    await fs.rm(root, { recursive: true, force: true });
  });

  const client = new BanxuebangClient({
    load: async () => ({
      auth: { access_token: "test-token" },
      context: { userInfo: { id: "student-1" } },
      baseUrl: "https://example.test",
    }),
  });
  client.getTaskDetail = async () => ({
    attachments: [{ fileId: "file-1", fileName: "要求.pdf" }],
    mySubmissionAttachments: [],
    peerSubmissionAttachments: [],
  });

  return { client, workspace: canonicalWorkspace };
}

test("downloads a task attachment into the workspace without overwriting an existing file", async (context) => {
  const { client, workspace } = await setup(context);
  globalThis.fetch = async () => new Response("attachment bytes", { status: 200 });

  const result = await client.downloadTaskAttachment({ taskId: "task-1", fileId: "file-1" });

  assert.equal(result.fileName, "要求.pdf");
  assert.equal(result.path, path.join(workspace, "要求.pdf"));
  assert.equal(result.sizeBytes, Buffer.byteLength("attachment bytes"));
  assert.equal(await fs.readFile(result.path, "utf8"), "attachment bytes");
  await assert.rejects(
    client.downloadTaskAttachment({ taskId: "task-1", fileId: "file-1" }),
    { code: "EEXIST" },
  );
  assert.equal(await fs.readFile(result.path, "utf8"), "attachment bytes");
});

test("refuses to download a file that is not attached to the selected task", async (context) => {
  const { client, workspace } = await setup(context);
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response("unexpected");
  };

  await assert.rejects(
    client.downloadTaskAttachment({ taskId: "task-1", fileId: "other-file" }),
    /was not found on task task-1/,
  );
  assert.equal(fetchCalls, 0);
  assert.deepEqual(await fs.readdir(workspace), []);
});

test("leaves no workspace file when the attachment download fails", async (context) => {
  const { client, workspace } = await setup(context);
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });

  await assert.rejects(
    client.downloadTaskAttachment({ taskId: "task-1", fileId: "file-1" }),
    /HTTP 503 file-download/,
  );
  assert.deepEqual(await fs.readdir(workspace), []);
});
