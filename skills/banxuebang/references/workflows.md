# Workflow Examples

Use the exact schema from `bxb.mjs describe TOOL`; identifiers below are examples, not real account data. Send JSON with `--args-file` or through MCP.

## Login and Inspect Homework

1. `session_status {}` checks the selected local session. If absent, `login_in_browser {"headless":false}` opens a browser for the user to sign in.
2. `list_terms {}` and `list_courses {}` discover actual identifiers. Query an explicit course with `list_tasks`; switch context only when needed and intended.
3. `collect_task_submission_context {"task_id":"TASK_ID"}` reads task text, reference text, and readable attachments. Missing materials must remain explicit.
4. For a PDF whose diagrams/scans matter, use `render_pdf_pages {"file":"assignment.pdf","max_pages":12}` and inspect the page images. Use `page_numbers` for additional selected pages. Report uninspected pages when relevant.

The standalone runtime returns text and pixels for the calling agent; it does not call a second model to describe them. `render_pdf_pages` defaults to saved image paths in CLI mode; `include_data_urls:true` is optional. MCP returns image blocks automatically. `read_workspace_image` returns a normalized image, including BMP/AVIF conversion where necessary.

## Import Files and Prepare a Draft

`import_workspace_files` copies local files into the selected workspace without replacing existing files:

```json
{"paths":["/absolute/path/report.pdf","/absolute/path/main.py"],"conflict_policy":"skip"}
```

Use the returned workspace-relative paths for reads and attachment binding. `conflict_policy:"keep-both"` retains both versions under different names. Nonempty folders cannot be deleted with `delete_workspace_file`; it is not a recursive-delete endpoint.

Create a draft with bound files:

```json
{
  "task_id":"TASK_ID",
  "task_title":"Programming assignment",
  "draft_text":"The solution and its source file are attached.",
  "attachments":[{"file":"main.py","kind":"source"}]
}
```

`attachments` is an optional array on `draft_task_submission`. On `update_submission_draft`, supplying it replaces the list. Retain an existing copy with `{"attachment_id":"ATTACHMENT_ID"}`; add a workspace file with `{"file":"report.pdf"}`. Omit the array to keep all attachments; `[]` removes all. A draft may contain attachments without body text, but the body and attachments cannot both be empty.

Binding makes a separate copy with byte-count and SHA-256 metadata. Workspace edits do not change that copy. Up to 20 attachments per draft and 25 MiB per file are supported. To replace an outdated attachment, bind the new workspace file and remove the old attachment reference, then review again.

## Source Code and Screenshots Together

After `draft_task_submission` returns the draft ID, call `render_code_as_vscode_image`:

```json
{
  "file_name":"main.py",
  "code":"print('Hello')\n",
  "language":"python",
  "theme":"dark",
  "draft_id":"DRAFT_ID"
}
```

The tool saves the original source filename in a unique workspace subdirectory and renders code with line numbers. It binds the source file and every PNG page to the draft and returns it to `pending_review`. Repeated calls append new copies; remove superseded versions explicitly rather than assuming a later render replaces them. Neither rendering nor binding uploads anything.

Read `get_submission_draft` to find the actual attachment IDs. Review each selected copy with `preview_submission_draft_attachment`:

```json
{"draft_id":"DRAFT_ID","attachment_id":"ATTACHMENT_ID"}
```

It returns text or an image when supported, otherwise file metadata for local inspection. The original code remains available even when screenshots are the intended visual deliverable.

## Confirm and Deliver Selected Attachments

1. Show the user the body, source code, screenshots, target task, and proposed attachment selection. Obtain review approval.
2. `approve_submission_draft {"draft_id":"DRAFT_ID"}` verifies all bound copies and records approval.
3. `prepare_draft_submission {"draft_id":"DRAFT_ID","attachment_ids":["SOURCE_ID","SCREENSHOT_ID"]}` returns the actual submission mode, destination, retained files, selected uploads, body, and confirmation token.
4. Show that concrete preview. After the user confirms delivery, call `submit_approved_draft`:

```json
{
  "draft_id":"DRAFT_ID",
  "attachment_ids":["SOURCE_ID","SCREENSHOT_ID"],
  "confirmation_token":"TOKEN_FROM_THE_REVIEWED_PREVIEW"
}
```

It uploads only those independent copies, verifies their hashes, and preserves existing remote attachments as part of resubmission. Changing text, selected IDs, task state, or reviewed bytes invalidates the preview. An omitted `attachment_ids` array means no new file uploads.

Do not use the lower-level `upload_submission_file` or `submit_task_result` to bypass a failed draft confirmation or unresolved result. They remain available for explicitly requested direct operations, with the same need to establish the real destination and content before the remote write.

## Teacher Messages and Recovery

`prepare_draft_private_message` returns contact suggestions and text chunks. Present the selected contact and exact chunks before `send_approved_draft_private_message`. Draft attachments are never included in this text-only route.

When a request returns an unknown outcome, inspect the actual task or private thread before retrying. The persisted attempt guards intentionally block ambiguous duplicates, including after a process restart. For a partially delivered message, preserve its confirmed chunks and use a new prepared preview of that same attempt; do not delete records or create another draft to resend all chunks.
