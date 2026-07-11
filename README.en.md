# Fanqie Publisher Skill

[![Release](https://img.shields.io/github/v/release/amm10090/fanqie-publisher-skill?display_name=tag&style=flat-square)](https://github.com/amm10090/fanqie-publisher-skill/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](./LICENSE)
[![OpenClaw Skill](https://img.shields.io/badge/OpenClaw-Skill-blue?style=flat-square)](./SKILL.md)
[![Playwright](https://img.shields.io/badge/Playwright-Automation-45ba4b?style=flat-square)](https://playwright.dev/)

**Publish prepared novel chapters from local Markdown files to the Fanqie Novel writer backend** via browser automation (Playwright + CDP).

> This is **not** an official Fanqie SDK or public API wrapper. Backend redesigns may break automation; always verify with safe mode before real publishing.

**🌐 [简体中文](./README.md) · English**

---

## Features

- Parse Markdown chapters with automatic chapter-number, title, and body splitting
- Single-chapter or batch publish from a local directory
- Reliable Chinese, Emoji, and Unicode input via the redesigned Fanqie editor with round-trip read-back validation
- QR-code login guidance when session expires, with browser session reuse
- Immediate publish and platform-native scheduled publish
- Intercept and handle typo warnings, content-risk detection, and final-publish-setting modals
- Post-publish verification: return to chapter management and confirm status (`审核中` or `已发布`)
- Safe `--fill-only` mode — fill editor fields without submitting anything
- Clear stage distinctions: preview-only → fill-only → at-final-modal → submitted-but-unverified → verified publication

## Platform Support

| Platform | Status | Entry File | Notes |
|----------|--------|------------|-------|
| [OpenClaw](https://github.com/openclaw/openclaw) | ✅ **Confirmed** | [`SKILL.md`](./SKILL.md) | Native skill format with YAML frontmatter, commands, and rules. Injected prompt files: `AGENTS.md`, `SOUL.md`, `TOOLS.md`. |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | ✅ **Confirmed** | [`SKILL.md`](./SKILL.md) (reused) | Reuses the same `SKILL.md`. Import via `hermes claw migrate` (official migration path). See [Hermes Agent tutorial](#hermes-agent). |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) | ✅ **Confirmed** | [`CLAUDE.md`](./CLAUDE.md) | Thin adapter — references shared `SKILL.md` and `references/` for business logic. |
| [OpenAI Codex CLI](https://github.com/openai/codex) | ✅ **Confirmed** | [`AGENTS.md`](./AGENTS.md) | Thin adapter. All business logic sourced from `SKILL.md`, `references/`, and `scripts/`. |
| [Cline](https://github.com/cline/cline) | ✅ **Confirmed** | [`.clinerules`](./.clinerules) | Thin adapter. All business logic sourced from `SKILL.md`, `references/`, and `scripts/`. |

> Each thin adapter (except OpenClaw/Hermes) is a **lightweight entry-point only**. Business logic, selectors, and safety rules live in `SKILL.md`, `references/`, and `scripts/`. No adapter duplicates the publishing implementation.

## Requirements

- **Node.js** with npm
- **Python 3**
- **Chromium/Chrome** browser (controllable via Playwright CDP)
- A **Fanqie author account** with backend access
- `npm install` in the repository root before first use

> Do not claim automatic dependency installation or assume these are automatically available. Each must be installed or configured manually.

## Quick Start

```bash
git clone https://github.com/amm10090/fanqie-publisher-skill.git
cd fanqie-publisher-skill
npm install
```

**Basic workflow:**

1. Prepare your chapters as `.md` files (one file = one chapter)
2. Preview the parse: `python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview`
3. Connect a logged-in browser via CDP: `node scripts/login_fanqie.js --cdp http://127.0.0.1:9222`
4. Safe fill-only test: `node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only`
5. After verifying content and page state, obtain the user's explicit confirmation in the current turn, then **remove `--fill-only`** and add `--confirm-publish` for real publication

## Chapter Format

Each `.md` file represents one chapter:

```text
第001章_标题.md

# 第001章 标题

First paragraph of body content.

Second paragraph.
```

The parser strips the first Markdown heading from the body, splits `第001章 标题` into serial `1` and display title `标题`, and fills the Fanqie editor accordingly. Leading zeroes in the serial number are removed for the numeric input.

## Platform Tutorials

### OpenClaw

Place the cloned repository directory into your OpenClaw workspace skills folder, or point OpenClaw at this directory. The [`SKILL.md`](./SKILL.md) file serves as the full skill definition with:

- YAML frontmatter (`name`, `description`) for automatic skill discovery
- Complete `commands` section with all entry points
- `rules` section with safety ceilings, login handling, and platform limits
- The validated step-by-step publish workflow

OpenClaw also injects `AGENTS.md`, `SOUL.md`, and `TOOLS.md` as global prompt files at the workspace level.

```bash
# After skill is loaded, available commands:
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

For batch publish, scheduled publish, volume selection, and retry: read [`SKILL.md`](./SKILL.md).

---

### Hermes Agent

Hermes Agent uses the **same `SKILL.md`** file as OpenClaw. Import via the official migration command.

#### Prerequisites

- Hermes Agent installed (official repository: [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent))
- This repository checked out locally

#### Migration Path (Official)

Hermes provides `hermes claw migrate` to import OpenClaw skills into `~/.hermes/skills/openclaw-imports/`. Its `--source` option expects an **OpenClaw root directory**, not this repository directly.

**Step 1 — Verify the command and dry-run flag:**

```bash
hermes claw migrate --help
```

This should show `--source` as the path to an OpenClaw directory and `--dry-run` as "Preview only — stop after showing what would be migrated."

**Step 2 — Stage this repository in an OpenClaw-compatible source layout:**

Run these commands from the repository root:

```bash
OPENCLAW_SOURCE="$(mktemp -d "${TMPDIR:-/tmp}/fanqie-openclaw-source-XXXXXX")"
SKILL_SOURCE="$OPENCLAW_SOURCE/workspace/skills/fanqie-publisher"
mkdir -p "$SKILL_SOURCE"
cp SKILL.md package.json "$SKILL_SOURCE/"
cp -R references scripts "$SKILL_SOURCE/"
```

This copies only the skill definition and shared runtime files into a temporary source tree. It does not copy `.git`, `state/`, login tokens, screenshots, or chapter files.

**Step 3 — Preview the migration with `--dry-run`:**

```bash
hermes claw migrate --source "$OPENCLAW_SOURCE" --dry-run
```

The dry-run output will list what will be migrated and what will be skipped. **Inspect it carefully before making any change.** The source must resolve to the temporary OpenClaw root, while the planned skill target should be `~/.hermes/skills/openclaw-imports/fanqie-publisher/`.

**Step 4 — Run the actual migration only after reviewing the preview:**

```bash
hermes claw migrate --source "$OPENCLAW_SOURCE"
```

After the migration succeeds and you verify the imported files, remove only the temporary directory stored in `OPENCLAW_SOURCE` if you no longer need it. Never use an unverified path in a recursive cleanup command.

**⚠️ Important safety notes:**
- **Always run `--dry-run` first** and inspect the output before any real migration
- The migration imports `SKILL.md`, `package.json`, `references/`, and `scripts/` — it does **not** copy `.git`, `state/`, login tokens, or user chapter files
- The actual `publish_fanqie.js` script is **not executed** during migration — only file-copied
- **Protect your real configuration**: if you test in an isolated environment, always verify that your real `~/.hermes` and `~/.openclaw` directories are never used as migration targets. Protecting real user data is the top priority.
- After migration, the skill at `~/.hermes/skills/openclaw-imports/fanqie-publisher/` contains valid relative references to `references/` and `scripts/`

**Once loaded in Hermes, use the same commands:**

```bash
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

---

### Claude Code

Claude Code reads [`CLAUDE.md`](./CLAUDE.md) from the project root. It is a thin adapter that directs Claude to:

1. Read `SKILL.md`, `references/workflow.md`, `references/selectors.md`, and `scripts/publish_fanqie.js` (flags only)
2. Use the shared commands from the `SKILL.md` entry points
3. Follow the same safety rules (50,000 char/day ceiling, 30-minute scheduled-edit window, explicit `是否使用AI → 否`)

```bash
# Preview chapter parse
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview

# Login or reconnect
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222

# Safe fill-only publish
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

For real publish: same reviewed arguments, **remove `--fill-only`**, add `--confirm-publish`.

---

### Codex CLI

Codex CLI reads [`AGENTS.md`](./AGENTS.md) from the project root. This thin adapter:

- References `SKILL.md` for all business logic and safety rules
- References `references/` for selector and workflow details
- References `scripts/publish_fanqie.js` for the sole publishing entrypoint
- Does **not** claim automatic installation, automatic login, or bypass of human confirmation

**Commands are identical to other platforms:**

```bash
# Syntax check + editor test
npm run test:all

# Preview chapters
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview

# Login
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222

# Safe fill-only
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

---

### Cline

Cline reads [`.clinerules`](./.clinerules) from the project root. This thin adapter follows the same design: reference shared files, use shared commands, enforce shared safety rules.

**Commands:**

```bash
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

**Real publish example (note: `--fill-only` is removed, NOT combined with `--confirm-publish`):**

```bash
node scripts/publish_fanqie.js \
  --cdp http://127.0.0.1:9222 \
  --file "/path/to/chapter.md" \
  --mode immediate \
  --confirm-publish
```

## Safe Publishing Workflow

Always progress through these stages. Never skip steps.

### Stage 1: Preview Only
```bash
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview
```
Verify chapter numbers, titles, and body text are parsed correctly.

### Stage 2: Fill Only (Safe Mode)
```bash
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```
Fields are filled in the editor. **Nothing is submitted.** Verify chapter number, title, body, volume selection, and page state.

### Stage 3: At Final Modal
With `--fill-only`, the script fills fields and navigates through typo/risk-detection modals to reach the final publish dialog, then stops before clicking `确认发布`. This confirms all intermediate gates are passable.

### Stage 4: Submitted But Unverified
After real publish with `--confirm-publish`, the submit button is clicked but the management page has not been checked. **This is not a verified success.**

### Stage 5: Verified Publication ✅
The script returns to chapter management and confirms the target row exists with status `审核中` (under review) or `已发布` (published). Only this stage confirms successful publication.

> **Real publish example (correct):** Use the same arguments as your fill-only test, **remove `--fill-only`**, and add `--confirm-publish`. Do **not** use both `--fill-only` and `--confirm-publish` together.

## Safety Boundaries

- Start with one chapter or `--fill-only` before any real publish
- Verify target book, volume, chapter number, title, and body before submitting
- **50,000 characters/day** is a practical safety ceiling (not an official quota)
- Scheduled chapters become **non-editable ~30 minutes before their publish time** — do not attempt last-minute edits
- Never commit login tokens, browser sessions, screenshots, QR codes, or temporary state files
- Selectors change when the Fanqie backend updates — inspect before assuming stability
- In the final publish modal, **always set `是否使用AI → 否`**

## Troubleshooting

### Chinese / Emoji / Unicode Input Issues

The redesigned Fanqie editor requires special handling for non-ASCII characters:

- The script uses **character-by-character input** with **round-trip read-back validation** for Chinese text, Emoji, and special Unicode characters
- If input validation fails, the script reports `input-validation-failed` — fix the source text and retry; do not report publication
- Empty editor decorator nodes are handled automatically; if the body field appears unresponsive, verify the editor is fully loaded before filling

### Login Issues

- If the session expires, the script guides you through **QR-code login** (manual scan required)
- Use `node scripts/login_fanqie.js --cdp http://127.0.0.1:9222` to reconnect
- For programs that need the QR code path: use `scripts/login_fanqie_notify.js` instead
- **No automatic login** is performed — human interaction with the QR code is always required

### Selector / Page State Issues

If a step fails unexpectedly:

1. Check the current page state manually
2. Review [`references/selectors.md`](./references/selectors.md) for updated semantic selectors
3. Review [`references/workflow.md`](./references/workflow.md) for the validated publish flow
4. Review [`references/editor-recon.md`](./references/editor-recon.md) for editor reconnaissance notes
5. Update selectors in `scripts/publish_fanqie.js` if the backend changed

### Modal / Dialog Handling

The publish flow may encounter several intermediate dialogs:

| Dialog | Trigger | Action |
|--------|---------|--------|
| Typo/spellcheck warning | After clicking `下一步` | Click `提交` to continue |
| Content risk detection | After typo check | Click `确定` to continue |
| Guided tour / onboarding | First visit to editor | Try `知道了` / `我知道了` / `下一步` / `跳过` |
| Final publish settings | Before submission | Set `是否使用AI → 否`, choose immediate or scheduled, click `确认发布` |

## FAQ

**Q: Can this publish on a schedule?**
A: Yes — use `--mode schedule` with `--scheduled-time`. This uses the Fanqie backend's native scheduled-publish UI rather than an external cron job.

**Q: Can I publish multiple chapters at once?**
A: Yes — use `--dir` instead of `--file`, optionally with `--volume` for volume selection.

**Q: What happens if I hit the daily limit?**
A: The script uses 50,000 characters/day as a practical safety ceiling. For high-volume days, pass `--already-published-chars` to let the script stop before hitting the suspected limit.

**Q: Does this work if the Fanqie backend changes?**
A: The automation relies on CSS selectors and DOM structure. Backend redesigns may break specific selectors — update `references/selectors.md` and test with `--fill-only` first.

**Q: Can I use this without opening a browser?**
A: No — a Chromium/Chrome browser session controlled via CDP is required.

## Reference Files

| File | Purpose |
|------|---------|
| [`SKILL.md`](./SKILL.md) | Full skill definition, commands, safety rules, and publishing flow |
| [`references/workflow.md`](./references/workflow.md) | Validated step-by-step publish workflow |
| [`references/selectors.md`](./references/selectors.md) | Semantic CSS selectors for Fanqie backend pages |
| [`references/editor-recon.md`](./references/editor-recon.md) | Editor reconnaissance and modal-handling notes |
| [`references/data-format.md`](./references/data-format.md) | Chapter source format specification |
| [`scripts/publish_fanqie.js`](./scripts/publish_fanqie.js) | Main publish entrypoint (single source of truth) |
| [`scripts/prepare_chapters.py`](./scripts/prepare_chapters.py) | Markdown chapter parser and preview |
| [`scripts/login_fanqie.js`](./scripts/login_fanqie.js) | Login and session handling |
| [`scripts/editor_input.js`](./scripts/editor_input.js) | Unicode input with round-trip read-back validation |
| [`CHANGELOG.md`](./CHANGELOG.md) | Release history |

## Development & Testing

```bash
npm run test:all
```

This runs JavaScript syntax checks and editor input tests. Core source files:

- `scripts/publish_fanqie.js` — publishing main flow
- `scripts/editor_input.js` — Unicode input and read-back validation
- `scripts/login_fanqie.js` — login and session handling
- `scripts/prepare_chapters.py` — Markdown chapter parsing

## Contributing

Contributions are welcome. Please follow these guidelines:

1. Open an issue first to discuss changes
2. Keep thin adapters thin — business logic belongs in `SKILL.md`, `references/`, and `scripts/`
3. Update `references/selectors.md` when the Fanqie backend changes
4. Test all changes with `--fill-only` before submitting
5. Do not commit login tokens, browser sessions, screenshots, or user data
6. Maintain UTF-8 encoding; test Chinese and Emoji input after editor changes

## License

[MIT](./LICENSE)
