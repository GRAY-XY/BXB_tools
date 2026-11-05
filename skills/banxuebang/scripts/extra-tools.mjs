import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import * as defaultZod from "zod/v4";

export function extraToolDefinitions(client, z = defaultZod) {
  return [
    {
      name: "render_code_as_vscode_image",
      description: "Save the original source file and code-only VS Code-style PNG pages in the workspace. Optionally bind them to a draft for review; never uploads or submits.",
      inputSchema: {
        file_name: z.string().describe("Source filename, such as Main.java or main.py."),
        code: z.string().describe("Complete source code to save and render."),
        language: z.string().optional(), theme: z.enum(["dark", "light"]).optional(),
        draft_id: z.string().optional().describe("Existing draft to receive the source file and all screenshots."),
      },
      execute: async ({ file_name, code, language, theme, draft_id }) => {
        const { renderCodeAsVscodeImages } = await import("../runtime/code-image-preview.js");
        const rendered = await renderCodeAsVscodeImages({ fileName: file_name, code, language, theme,
          workspaceDir: await client.workspaceRoot() });
        if (draft_id) {
          const result = await client.updateSubmissionDraft(draft_id, { appendAttachments: [
            { file: rendered.sourceFile.relativePath, kind: "source" },
            ...rendered.images.map(file => ({ file: file.relativePath, kind: "image" })),
          ] });
          rendered.draftId = draft_id;
          rendered.attachmentCount = result.attachmentCount;
        }
        return rendered;
      },
    },
    {
      name: "import_workspace_files",
      description: "Copy local files or folders into the workspace. Originals are preserved; existing files are skipped or kept with another name.",
      inputSchema: { paths: z.array(z.string()).min(1).max(100), conflict_policy: z.enum(["skip", "keep-both"]).optional() },
      execute: ({ paths, conflict_policy }) => client.importWorkspaceItems({ paths, conflictPolicy: conflict_policy }),
    },
    {
      name: "delete_workspace_file",
      description: "Delete a workspace file or empty folder. Nonempty folders are rejected. Use expected identity metadata from the listing to detect changed targets.",
      inputSchema: { file: z.string(), expected: z.object({ identity: z.string().optional(), modifiedAt: z.string().optional() }).optional() },
      execute: args => client.deleteWorkspaceFile(args),
    },
    {
      name: "read_workspace_image",
      description: "Read a workspace image as a normalized PNG/JPEG/WebP/GIF data URL for the calling agent to inspect. BMP and AVIF are normalized to PNG; no model request is sent.",
      inputSchema: { file: z.string() },
      execute: async ({ file }) => {
        const entry = await client.resolveWorkspaceEntry(file);
        if (!entry.fileStat.isFile() || entry.fileStat.size > 25 * 1024 * 1024) throw new Error("Image must be a regular file no larger than 25 MiB.");
        const { normalizeModelImage } = await import("../runtime/model-image.js");
        const image = await normalizeModelImage(await readFile(entry.path));
        return { path: entry.path, mimeType: image.mimeType, dataUrl: `data:${image.mimeType};base64,${image.buffer.toString("base64")}` };
      },
    },
    {
      name: "render_pdf_pages",
      description: "Render a workspace PDF into page PNGs for the calling agent's visual review. Returns saved paths and optional data URLs; does not invoke a model or upload files.",
      inputSchema: {
        file: z.string().describe("Workspace PDF path."),
        page_numbers: z.array(z.number().int().positive()).max(30).optional(),
        max_pages: z.number().int().min(1).max(30).optional().describe("Default 12; absolute maximum 30."),
        include_data_urls: z.boolean().optional().describe("Default false; MCP still returns native image blocks."),
      },
      execute: async ({ file, page_numbers = [], max_pages = 12, include_data_urls = false }) => {
        const entry = await client.resolveWorkspaceEntry(file);
        if (!entry.fileStat.isFile() || path.extname(entry.path).toLowerCase() !== ".pdf") throw new Error("Expected a workspace PDF file.");
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: await readFile(entry.path) });
        try {
          const pages = [...new Set(page_numbers)].slice(0, max_pages);
          const result = await parser.getScreenshot({ desiredWidth: 1280, imageDataUrl: true, imageBuffer: true,
            ...(pages.length ? { partial: pages } : { first: max_pages }) });
          const root = await client.workspaceRoot();
          const previewRoot = path.join(root, "PDF Previews");
          await client.assertWorkspaceTargetPath(previewRoot);
          await mkdir(previewRoot, { recursive: true });
          if ((await lstat(previewRoot)).isSymbolicLink()) throw new Error("PDF preview directory must not be a symbolic link.");
          const directory = await client.assertWorkspaceTargetPath(path.join(previewRoot, randomUUID()));
          await mkdir(directory);
          const output = [];
          for (const page of result.pages) {
            const target = path.join(directory, `page-${page.pageNumber}.png`);
            await writeFile(target, page.data, { flag: "wx" });
            output.push({ pageNumber: page.pageNumber, path: target, relativePath: path.relative(root, target).replaceAll("\\", "/"),
              width: page.width, height: page.height, sizeBytes: (await stat(target)).size,
              ...(include_data_urls ? { dataUrl: page.dataUrl } : {}) });
          }
          return { totalPages: result.total, renderedPageCount: output.length, pages: output,
            note: "Inspect these page images with the calling agent. No automatic model transcription was performed." };
        } finally { await parser.destroy(); }
      },
    },
  ];
}
