# fanqie-publisher-skill — Codex CLI Agent Adapter

Publish prepared novel chapters from local Markdown files to the Fanqie Novel writer web backend via browser automation (Playwright).

## Read First

All authoritative project definitions and business logic reside in the following shared files. Do not act without reading them:

- [`SKILL.md`](./SKILL.md) — full skill definition, commands, safety rules, and publishing flow
- [`references/workflow.md`](./references/workflow.md) — validated step-by-step publish workflow
- [`references/selectors.md`](./references/selectors.md) — semantic CSS selectors for Fanqie backend pages
- [`scripts/publish_fanqie.js`](./scripts/publish_fanqie.js) — the sole publishing entrypoint (read flags, not copy logic)
- [`package.json`](./package.json) — dependency: `playwright` only

## Prerequisites

- Node.js + npm, Python 3
- Chromium/Chrome browser (Playwright-controllable via CDP)
- A Fanqie author account with an opened backend session
- Run `npm install` in the repository root before first use

**Do not** claim that any of these are automatically installed or available.

## Entry Points

| Action | Command |
|--------|---------|
| Syntax checks + editor test | `npm run test:all` |
| Preview chapter parse | `python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview` |
| Login / reconnect | `npm run login` (or `node scripts/login_fanqie.js --cdp http://127.0.0.1:9222`) |
| Safe fill-only publish | `node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only` |
| Real publish | Only after explicit user confirmation: use the same reviewed arguments, **remove `--fill-only`**, and add `--confirm-publish`, e.g. `node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --confirm-publish`; never combine the two flags |

Login requires a manual QR code scan. The login script saves reusable browser storage state locally at `state/fanqie-storage-state.json`; treat it as sensitive local state, and re-run login when the session expires.

## UTF-8 / Unicode Safeguards

- Chapter files **must** be valid UTF-8 with no BOM.
- Use `scripts/prepare_chapters.py --preview` to verify parsing before any publish attempt.
- The editor input flow (`scripts/editor_input.js`) validates CJK, emoji, and newline round-trip fidelity.
- A round-trip mismatch raises `Unicode 一致性校验失败` — do not downgrade it to success.
- Always inspect a single filled chapter visually before batch operations.

## Publish Safety Protocol

1. **Preview first**: `python3 scripts/prepare_chapters.py --dir "<chapters>" --preview`
2. **Fill-only dry run**: `node scripts/publish_fanqie.js --fill-only` — fills the editor but does **not** submit
   - Verify: chapter number, title, body, volume assignment, page state
3. **Final publish modal is not published**: the `确认发布` click is the actual submit — verify modal contents (volume, chapter title, AI=否) before clicking
4. **Post-publish verification**: always navigate back to chapter management and confirm row status is `审核中` or `已发布`
5. **Scheduled publish**: opening the scheduled timer in the modal is not publication; only `确认发布` with a timer set is the real action

**Never report success** without post-publish chapter-management verification. A chapter is only "published" when its row is found in the management table with the expected status.

## Status Differentiation

Clearly distinguish between these outcomes — never conflate them:

| State | Meaning |
|-------|---------|
| `preview-only` | Chapter parse preview was displayed; no publish action taken |
| `fill-only` | Editor fields were filled but the submit button was not clicked |
| `to-final-modal` | The final publish dialog was reached but not confirmed |
| `submitted-unverified` | Submit was clicked, but the management page did not contain the target chapter row; this is **not** a verified success |
| `published-verified` | Submit was clicked, the management page was reloaded, and the target chapter row was found with status `审核中` or `已发布` |
| `login-expired-or-timeout` | Session expired or manual QR login timed out; report failure and re-run `npm run login` |
| `input-validation-failed` | Chinese/Emoji round-trip or another input validation failed; fix the input and do not report publication |
| `error` | Any unexpected script error, timeout, or missing dependency |

## Shared Safety Rules (from SKILL.md)

- 50,000 characters/day is a practical ceiling unless backend behavior proves otherwise
- Scheduled chapters become non-editable ~30 min before publish time
- In the final publish modal, explicitly set `是否使用AI → 否`
- Login state expires — re-run `login_fanqie.js` when needed
- Selectors change when the backend updates — inspect before assuming stability
- **Do not** claim automatic dependency installation, automatic login, or bypass of human confirmation
- **Do not** perform real publish without the current user's explicit per-round confirmation and `--confirm-publish`

## Notes

- This file is a **thin adapter** only. All business logic, selectors, and implementation reside in [`SKILL.md`](./SKILL.md), [`references/`](./references/), and [`scripts/`](./scripts/).
- For batch publish, schedule, volume selection, and retry: read [`SKILL.md`](./SKILL.md).
- For other platforms: see respective platform files in the repository root.
