# BXB Homework WinUI Prototype

This directory is a native Windows UI prototype for BXB Homework.

This is the current primary native Windows client. The older Electron client lives in `apps/legacy/electron/`.

- WinUI 3 native window.
- Windows App SDK `NavigationView` shell.
- C# starts a Node backend process.
- C# calls the existing local Banxuebang tool layer through JSONL stdio.

## Required Local Tooling

Recommended tooling:

```powershell
winget install Microsoft.DotNet.SDK.8
winget install Microsoft.VisualStudio.2022.BuildTools
```

When installing Visual Studio Build Tools, include:

- .NET desktop build tools
- Windows App SDK / WinUI workload or individual components
- Windows 10/11 SDK

## Run

After installing the tooling, build with Visual Studio MSBuild, not plain `dotnet build`.
WinUI / Windows App SDK projects need VS AppxPackaging tasks that the standalone .NET SDK MSBuild does not provide.

```powershell
cd <repo>\apps\windows\winui
.\build.ps1
```

The debug executable is generated at:

```text
<repo>\apps\windows\winui\BxbHomework.WinUI\bin\x64\Debug\net8.0-windows10.0.19041.0\BXBHomework.exe
```

## Package For Users

The user-facing WinUI build is packaged as a per-user NSIS installer. It includes:

- The WinUI self-contained output.
- `resources\payload` with `backend\src`, `backend\bridge`, root `package.json`, frontend version metadata, root `node_modules`, and the Playwright browser archive.
- `resources\node\node.exe`, so end users do not need to install Node.js.

Install the root dependencies with `npm ci`, then build the installer from the repository root:

```powershell
.\apps\windows\winui\package-winui.ps1 -Configuration Release
```

Outputs:

```text
<repo>\release\artifacts\windows\winui-unpacked\BxbHomework.WinUI.exe
<repo>\release\artifacts\windows\BXB Homework Setup <version>.exe
<repo>\release\artifacts\windows\BXB Homework Setup <version>.exe.sha256
```

The package script prepares the required bundled Node runtime and updates the Playwright Chromium archive, then writes the app to:

```text
%LOCALAPPDATA%\Programs\BXB Homework
```

The installer and its SHA-256 sidecar are written to `release\artifacts\windows\`. See [`release/README.md`](../../../release/README.md) for versioning, release upload, and verification steps.

It creates desktop and Start Menu shortcuts named `BXB Homework`. The app currently shares the existing application data directory under `%APPDATA%\bxb-homework-electron`.

## Backend Protocol

In development mode, the app starts:

```powershell
node <repo>\backend\bridge\winui-backend.js
```

In packaged mode, the app starts:

```text
resources\node\node.exe resources\payload\backend\bridge\winui-backend.js
```

Each request is one JSON line:

```json
{"id":"1","method":"session.status","params":{}}
```

Each response is one JSON line:

```json
{"id":"1","ok":true,"result":{}}
```

Current prototype method groups:

- `app.info`
- `app.openPath`
- `session.status`
- `session:login` (headless credential login; credentials are never persisted by the Node bridge)
- `tool.call`
- `modelConfig.load`
- `modelConfig.save`
- `modelConfig.clear`
- `modelConfig.list`
- `modelConfig.test`
- `conversation.list`
- `conversation.create`
- `conversation.select`
- `conversation.rename`
- `conversation.delete`
- `agent.chat`
- `agent.compact`
- `agent.reset`
- `workspace.importPaths`
- `workspace.savePastes`
- `workspace.rename`
- `workspace.delete`
- `workspace.open`
- `workspace.imageDataUrl`
- `update.check`
- `update.status`
- `update.download`
- `update.install`
- `update.cancel`
- `update.openUrl`

The WinUI shell currently exposes native pages for Home, Agent, Homework, Drafts, Private Messages, Workspace, Updates, and Settings. Agent messages show a live inline `Thinking` row with the current step and an expandable structured timeline; individual step arguments and results are collapsed by default. Complex confirmation flows such as draft submission, private-message sending, and installer launch are available in the backend but should still be surfaced through dedicated confirmation UI before normal use.

On launch, navigation stays hidden behind a startup view until the local Node backend, application/model configuration, and saved session state are ready. Initialization failures remain on that view with an in-app retry action.

Draft JSON is stored in `%APPDATA%\bxb-homework-electron\.banxuebang\drafts`. The installer migrates drafts written by older builds under the packaged payload before replacing the installation directory.

### Draft Attachments and Code Previews

Windows draft review supports a text body together with source files, code screenshots, and other workspace files:

- In Drafts, expand the attachment section and choose **Add from workspace**. Preview or remove each bound file, and use its checkbox to choose whether it will be uploaded with the next Task submission.
- Binding creates an independent copy under `drafts/attachments/<draftId>/<attachmentId>/`. Renaming, changing, or deleting the workspace original does not change the reviewed copy. Each draft supports up to 20 files, up to 25 MiB each.
- Expand a file in the draft pane to compare its contents with the body, or open the larger preview. Code and text files have a read-only preview; images render inline. Other supported document types use text extraction. Unsupported formats can be inspected through their containing folder.
- Body and attachment changes return the draft to `pending_review`. Unsaved body edits block approval and delivery. Approval and submission verify the stored file sizes and SHA-256 hashes.
- The Task confirmation screen lists the selected new files separately from retained remote attachments. Only the selected copies are uploaded after explicit confirmation. A text-free draft is allowed when an attachment is selected.
- Teacher private messages remain text-only. Their confirmation screen explicitly states that bound attachments will not be sent.
- Deleting a draft or expiring a rejected draft also removes its attachment copies. Backend draft migration copies and verifies attachment data before migrating its JSON record.

The assistant's `render_code_as_vscode_image` tool now saves the source file as well as all PNG pages. A unique subdirectory preserves the source filename (for example, `Main.java`) without replacing earlier files. Passing `draft_id` binds those outputs to the existing draft and returns it to review. Rendering and binding do not upload anything.

The local tool protocol accepts these additive fields:

```json
{"name":"update_submission_draft","arguments":{"draft_id":"<id>","attachments":[{"attachment_id":"<existing-id>"},{"file":"Code Previews/abcd1234/main.py","kind":"source"}]}}
```

`attachments` replaces the list when provided; omit it to keep all current copies. New files use workspace-relative `file`; existing copies use `attachment_id`. The same attachment input is supported on `draft_task_submission`. Use `preview_submission_draft_attachment({ draft_id, attachment_id })` to read a verified copy.

Both `prepare_draft_submission` and `submit_approved_draft` accept an explicit `attachment_ids` array. The confirmation token binds that selection and its file hashes together with the text and destination. Omitting the array means text-only delivery, so older clients cannot silently upload files they do not display. Native macOS attachment review is not implemented by this Windows change.

The Agent composer accepts pasted images, saves them to the managed workspace, and shows removable pending attachments. BMP and AVIF clipboard images are converted to PNG before saving. Existing workspace images in these formats are also converted to PNG in memory before preview or model requests, so previously saved attachments remain usable. Image MIME types are determined from the encoded bytes rather than the file name. With image captioning disabled, the active chat provider receives those images directly as multimodal content. With image captioning enabled, its provider transcribes them first and only the transcription is passed to chat. Conversation persistence stores file metadata rather than Base64 image data.

PDF tools extract the text layer and render bounded page images for visual analysis. PDF page images follow the same model-role selection: the image-caption provider handles them when enabled, otherwise the active chat provider is used as the multimodal visual analyzer.

The Agent always receives a backend-owned core policy. Settings stores only lower-priority custom instructions. Legacy editable system prompts migrate automatically, while context compaction and image/PDF visual transcription keep separate specialized prompts.

Agent replies use SSE streaming and update the active assistant message incrementally. If a stream disconnects before completing, the backend keeps the partial response visible, retries the stream once, and then waits for a complete non-streaming response. Agent-only tool results are compacted before the next model round, while direct UI tool responses are unchanged. The default configurable context window is 200,000 tokens.
