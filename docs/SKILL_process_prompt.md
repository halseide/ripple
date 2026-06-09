---
name: ripple-process-prompt
description: >-
  Process a captured Ripple UI prompt from the /raw inbox. Reads the prompt
  file, determines the category (fix, feature, design, copy, data, question),
  and executes the correct workflow for that category. NEVER makes code changes
  for a 'question' prompt — answer only. Updates prompt_log.json and archives
  the file on completion.
---

# Ripple — Process Prompt from /raw

## Overview

Ripple captures UI feedback directly from the live page via Shift+Right-Click.
Each capture is saved as a markdown file in `[VAULT_PATH]\raw\` with a structured
frontmatter block. This skill governs how the agent processes those files.

### Why This Skill Exists

On 2026-06-05 the agent read a `category: question` prompt, diagnosed a UX gap,
and immediately called the CRM application API to change a live record — without being
asked to. The user had to stop it and demand a re-eval. This skill exists to
prevent that failure mode and all similar ones.

---

## Preconditions

- The user has said "process prompt in /raw" or similar.
- At least one `prompt_*.md` file exists in `[VAULT_PATH]\raw\`.

---

## Step 1 — Read the Inbox

List all files in `[VAULT_PATH]\raw\` that match `prompt_*.md` and are NOT in
the `Archive\` subdirectory.

```powershell
Get-ChildItem "[VAULT_PATH]\raw\" -File | Where-Object { $_.Name -like "prompt_*.md" }
```

If there are multiple prompts, process them **one at a time**, oldest first
(`capturedAt` ascending). Ask the user before proceeding to the next prompt

---

## Step 2 — Parse the Prompt File

Read the frontmatter and body of the prompt file. Extract:

| Field | Description |
|---|---|
| `prompt_id` | Unique ID — used for commit messages and log updates |
| `project_key` | Which project this came from (e.g. `project-beta`, `project-alpha`) |
| `category` | **The most important field. Governs everything below.** |
| `page_url` | The live URL where the element was captured |
| `element_selector` | The DOM path to the exact element |
| `element_context` | Human-readable tag + class summary |
| `prompt` | The user's actual words |

Map `page_url` → physical file using `ripple.config.json` (`git_repo` field for
the matching `project_key`). Use `element_selector` to locate the relevant lines.

---

## Step 3 — Category Dispatch

> [!CAUTION]
> Read the `category` field BEFORE doing anything else.
> The category determines your **entire** response mode.
> **Do not skip this step. Do not assume the category.**

### `question` — Answer Only

> [!WARNING]
> **STOP. DO NOT WRITE CODE. DO NOT CALL APIS. DO NOT MAKE ANY CHANGES.**
>
> A `question` prompt means the user is asking for an analysis or recommendation. Your only job is to **answer the question in plain text**.
>
> You may:
> - Explain how the current code works
> - Describe tradeoffs between options
> - Recommend an approach
> - Ask a clarifying question back
>
> You must NOT:
> - Write or edit any file (other than prompt_log.json as described below)
> - Call any API or run any command that modifies state in the project
> - Make a commit

**After answering in chat, you MUST:**

1. Call `POST api/update_prompt.php` with:
   ```json
   {
     "promptId": "<id>",
     "status": "answered",
     "answer": "<your full plain-text answer>",
     "answeredAt": "<ISO timestamp>"
   }
   ```
2. Leave the `.md` file in `/raw/` — **do NOT archive it**.
3. Say: *"Answer written to the dashboard thread. The prompt stays open — you can reply, re-categorize, or dismiss it from the Prompt Log."*

**The thread stays live until the user dismisses it or re-submits it as a different category.**

---

### `fix` — Targeted Code Repair

A bug, broken layout, or incorrect behavior. The scope is narrow.

**Workflow:**
1. Run `git log --oneline -3` in the project repo first.
2. Locate the exact lines using the element selector.
3. Make the minimal change that fixes the issue — do not refactor.
4. Commit with: `[Vibe] fix: <description> - Resolves Prompt: <prompt_id>`
5. Update `prompt_log.json` → `status: shipped`, fill `resolvedAt`, `commitHash`, `commitMessage`.
6. Archive the prompt file to `[VAULT_PATH]\raw\Archive\`.

---

### `feature` — New Capability

A request for something that doesn't exist yet.

**Workflow:**
1. **Pause and plan.** Do not start coding immediately.
2. Write a brief implementation plan (2–5 bullet points) and present it to the
   user for approval before touching any file.
3. Once approved, implement, commit, log, and archive as above.
4. Commit prefix: `[Vibe] feat: <description> - Resolves Prompt: <prompt_id>`

---

### `design` — Visual / Layout Change

Spacing, color, typography, animation, or aesthetic adjustment.

**Workflow:**
1. Locate the relevant CSS or inline style using the selector.
2. Make the change. If the change affects more than one element, list what you
   changed and why before committing.
3. Commit prefix: `[Vibe] design: <description> - Resolves Prompt: <prompt_id>`
4. Log and archive.

---

### `copy` — Text / Wording Change

A label, heading, placeholder, tooltip, or body text edit.

**Workflow:**
1. Find the exact string in the file.
2. Replace it. Do not change surrounding markup unless broken.
3. Commit prefix: `[Vibe] copy: <description> - Resolves Prompt: <prompt_id>`
4. Log and archive.

---

### `data` — Data / Content Issue

Wrong value, missing field, stale content, or data display problem.

**Workflow:**
1. Determine whether the issue is in the data source (JSON, DB, API) or the
   rendering layer. Fix at the root cause, not the symptom.
2. If a data file change is needed, note what changed and why.
3. Commit prefix: `[Vibe] data: <description> - Resolves Prompt: <prompt_id>`
4. Log and archive.

---

## Step 4 — Update prompt_log.json

File: `[WEB_ROOT]\ripple\data\prompt_log.json`

For completed actionable prompts (`fix`, `feature`, `design`, `copy`, `data`):
```json
{
  "status": "shipped",
  "resolvedAt": "<ISO timestamp>",
  "commitHash": "<short hash>",
  "commitMessage": "<full commit message>"
}
```

For `question` prompts: call `POST api/update_prompt.php` with
`status: "answered"`, `answer: "<text>"`, `answeredAt: "<now>"`.
Do NOT leave status as `pending` after answering — the dashboard
thread will not show the answer unless you write it.

---

## Step 5 — Archive

Move the processed file to `[VAULT_PATH]\raw\Archive\`:

```powershell
Move-Item "[VAULT_PATH]\raw\<prompt_file>.md" "[VAULT_PATH]\raw\Archive\"
```

**Archive rules:**

| Status | Archive? |
|---|---|
| `shipped` | ✅ Yes — archive immediately after commit is confirmed |
| `dismissed` | ✅ Yes — archive when user dismisses via dashboard |
| `answered` | ❌ No — thread is still open, leave in `/raw/` |
| `pending` | ❌ No |

**Never archive on `answered`.** The user may still want to execute the suggestion. Wait for `dismissed`.

---

## Commit Message Format

```
[Vibe] <category>: <short description of what changed>
- Resolves Prompt: <prompt_id>
```

Example:
```
[Vibe] fix: remove quote marks from About modal text
- Resolves Prompt: prompt_1780670987_example
```

---

## Common Mistakes

| Mistake | Correct Behavior |
|---|---|
| Acting on a `question` prompt | **Answer only.** No code, no API calls, no commits. |
| Answering a question but NOT writing to prompt_log.json | Always call `api/update_prompt.php` with the answer — the dashboard thread will be blank otherwise |
| Archiving an `answered` prompt | Only archive on `shipped` or `dismissed`. `answered` means the thread is still open. |
| Fixing the wrong element because the selector was ambiguous | Re-read the `element_context` field and `page_url` to confirm the exact node before editing |
| Forgetting to run `git log --oneline` before editing | Always run it first — it is required by the user's rules |
| Archiving before confirming the commit succeeded | Verify the commit hash exists before moving the file |
| Updating `prompt_log.json` before the fix is verified | Log only after the commit is confirmed |
| Processing multiple prompts without pausing | Do one at a time. Ask before starting the next if the first was complex. |
