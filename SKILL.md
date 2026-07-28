---
name: fanqie-publisher
description: Publish prepared novel chapters from local Markdown files to the Fanqie Novel writer web backend via browser automation. Use when the user wants to upload chapters, continue publishing unpublished chapters, save or reuse login state, or schedule Fanqie chapter releases from a local directory.
---

# Fanqie Publisher

Use this skill to publish **chapter title + 正文** from local Markdown files to the Fanqie writer backend.

## Scope

This skill is for:
- uploading one chapter from a `.md` file
- batch publishing chapters from a directory
- immediate publish
- scheduled publish
- saving and reusing browser login state

This skill is **not** for guessing selectors blindly. If the page changes, inspect first, then update `references/selectors.md` and `{baseDir}/scripts/publish_fanqie.js`.

## Source content

Expected source content shape:

- one `.md` file = one chapter
- filename example: `第001章_标题.md`
- first line example: `# 第001章 标题`
- body starts after the heading

## Files

- `scripts/prepare_chapters.py` — parse `.md` files into normalized chapter data
- `scripts/browser_page_picker.js` — pick an existing Fanqie writer tab or open a safe fallback page
- `scripts/fanqie_login_flow.js` — shared login helpers used by the login and publish entrypoints
- `scripts/login_fanqie.js` — open browser, detect login page, capture QR code, and save login state
- `scripts/login_fanqie_notify.js` — wrap login flow and emit machine-readable QR/media-ready output for OpenClaw message delivery
- `scripts/publish_fanqie.js` — publish one or more chapters with Playwright; if the `remote` browser / Windows Chrome 9222 session is not running, auto-try to restore it first; if login expires, fall back to QR login flow; for retryable page-state failures, auto-retry the current chapter once
- `scripts/extract_cookies.js` — extract cookies from live CDP browser; used to prepare for headless publishing
- `scripts/session_manager.js` — unified session management: fast validity pre-checks, cookie export/import, multi-profile support
- `scripts/state.py` — persist publish history and prevent duplicates
- `references/workflow.md` — current known backend workflow
- `references/selectors.md` — selectors and page reconnaissance notes

## Safe workflow

1. Parse chapters first
2. Preview chapter list and extracted titles
3. Log in and save browser state
4. Publish **one chapter** as a live test
5. Only then run batch or scheduled publishing

## Recommended commands

### 1) Preview parsed chapters

```bash
python3 "{baseDir}/scripts/prepare_chapters.py" \
  --dir "/path/to/chapters" \
  --preview
```

### 2) Save login state

If running in WSL with a Windows browser debugging port:

```bash
node "{baseDir}/scripts/login_fanqie.js" --cdp http://127.0.0.1:9222
```

If running with a local GUI browser on Linux:

```bash
node "{baseDir}/scripts/login_fanqie.js"
```

This will open or connect to the writer backend, switch to QR login when needed, save a QR screenshot to `{baseDir}/state/login-qr.png`, and wait for manual scan / login completion.

**Multi-profile support**: Use `--profile <name>` to manage multiple accounts/sessions. Each profile stores its own login state independently:
```bash
node "{baseDir}/scripts/login_fanqie.js" --cdp http://127.0.0.1:9222 --profile account2
```
This saves state to `state/fanqie-storage-state-account2.json`. Pass `--profile` to publish commands to use the corresponding session.

**Cookie export/import**: The session manager supports granular cookie operations:
```bash
# Export cookies to JSON
npm run session:export-cookies [-- --profile <name>]
# Import cookies from JSON
npm run session:import-cookies -- --file <cookies.json> [--profile <name>]
# Extract cookies directly from CDP browser (for headless prep)
npm run session:extract-cookies -- --cdp http://127.0.0.1:9222 [--profile <name>]
# List all profiles
npm run session:list
# Validate session health (offline file check)
npm run session:check [-- --profile <name>]
# Validate session health (online, requires --cdp)
npm run session:validate -- --cdp http://127.0.0.1:9222 [--profile <name>]
```

### 2b) Headless / Cookie-only publishing (no QR scan required)

When running on a headless server (no GUI, no QR code scanning), follow this workflow:

**Step 1 — On GUI machine**: Log in normally and extract cookies
```bash
# Login via QR scan as usual
npm run login -- --cdp http://127.0.0.1:9222

# Extract cookies to a portable JSON file
npm run session:extract-cookies -- --cdp http://127.0.0.1:9222
# Or use the standalone script:
node "{baseDir}/scripts/extract_cookies.js" --cdp http://127.0.0.1:9222
```
This saves cookies to `state/fanqie-cookies.json`.

**Step 2 — Transfer cookies to headless server**: Copy `state/fanqie-cookies.json` to the target machine.

**Step 3 — On headless server**: Import cookies and publish
```bash
# Import cookies into storageState
npm run session:import-cookies -- --file /path/to/fanqie-cookies.json

# Publish with cookie-only mode (auto-enabled when --cdp is NOT provided)
node "{baseDir}/scripts/publish_fanqie.js" \
  --file "/path/to/chapters/第001章_标题.md" \
  --mode immediate \
  --confirm-publish

# Or explicitly enable cookie-only mode
node "{baseDir}/scripts/publish_fanqie.js" \
  --cookie-only \
  --file "/path/to/chapters/第001章_标题.md" \
  --mode immediate \
  --confirm-publish
```

**Notes**:
- When `--cdp` is not provided, the publisher auto-detects headless mode and uses pure cookie authentication
- If cookies are expired, it fails fast with clear guidance instead of polling for a non-existent QR scan
- Cookies typically last for days, but re-extract periodically
- Use `npm run session:validate -- --cdp http://...` to check cookie validity on a machine with a GUI browser

### 3) Fill a single chapter into the Fanqie editor (safe test)

```bash
node "{baseDir}/scripts/publish_fanqie.js" \
  --cdp http://127.0.0.1:9222 \
  --file "/path/to/chapters/第001章_标题.md" \
  --mode immediate \
  --fill-only
```

### 4) Go all the way to the final publish modal, auto-select `AI=否`, but stop before publish

```bash
node "{baseDir}/scripts/publish_fanqie.js" \
  --cdp http://127.0.0.1:9222 \
  --file "/path/to/chapters/第001章_标题.md" \
  --mode immediate \
  --to-final-modal
```

### 5) Immediate publish

```bash
node "{baseDir}/scripts/publish_fanqie.js" \
  --cdp http://127.0.0.1:9222 \
  --file "/path/to/chapters/第001章_标题.md" \
  --mode immediate \
  --confirm-publish
```

### 6) Batch immediate publish from a directory

```bash
node "{baseDir}/scripts/publish_fanqie.js" \
  --cdp http://127.0.0.1:9222 \
  --dir "/path/to/chapters" \
  --start-from "第014章" \
  --limit 3 \
  --mode immediate \
  --confirm-publish
```

Useful flags:
- `--skip-published` — skip chapters already recorded in `{baseDir}/state/publish-state.json`
- `--to-final-modal` — batch-safe stop before final publish
- `--fill-only` — only fill the draft editor for the first selected chapter
- `--daily-limit-chars 50000` — safety guard for suspected Fanqie daily publish ceiling
- `--already-published-chars 47796` — already published chars today, used with the safety guard
- `--schedule-step-minutes 30` — for batch scheduled publish, offset each chapter by N minutes from `--schedule-at`

### 7) Schedule one chapter using Fanqie's own backend scheduling

```bash
node "{baseDir}/scripts/publish_fanqie.js" \
  --cdp http://127.0.0.1:9222 \
  --file "/path/to/chapters/第018章_标题.md" \
  --mode scheduled \
  --schedule-at "2026-03-13 21:00" \
  --confirm-publish
```

### 8) Batch schedule chapters with Fanqie's own backend scheduling

```bash
node "{baseDir}/scripts/publish_fanqie.js" \
  --cdp http://127.0.0.1:9222 \
  --dir "/path/to/chapters" \
  --start-from "第018章" \
  --limit 3 \
  --mode scheduled \
  --schedule-at "2026-03-13 21:00" \
  --schedule-step-minutes 30 \
  --confirm-publish
```

## Current workflow understanding

Current validated publish flow:
1. Open chapter management for the target book
2. Switch to the target volume on chapter management
3. Enter `新建章节` from chapter management so the draft inherits the chosen volume
4. Fill chapter number, title, and正文
5. Save draft and confirm visible word count is not `0`
6. Click the top-right `下一步`
7. Handle typo/spellcheck modal by clicking `提交`
8. Handle risk-detection modal by clicking `确定` when continuing publish
9. In the final publish modal, explicitly choose `是否使用AI` → `否`
10. For scheduled release, click `定时发布` and set date/time
11. Click `确认发布`
12. Return to chapter management and verify row status is `审核中` or `已发布`

This flow has been validated against the live backend. Keep `references/selectors.md` in sync when the page changes.

## 书籍配置（Book Config）

当前账号（龙城飞将529）下的书籍列表：

| 书名 | BOOK_ID | 状态 | 备注 |
|------|---------|------|------|
| 重生踢球：从欧洲低级联赛开始 | 7616021706989128728 | 连载中 | 2.5万字 |
| 裂魂人：我终将成为英雄 | - | 连载中 | 5.4万字 |
| 测试数目 | 7665650299855440958 | 待审核 | 测试用 |

**URL 格式**：
- 章节管理：`https://fanqienovel.com/main/writer/chapter-manage/{BOOK_ID}&{书名编码}?type=1`
- 新建章节：`https://fanqienovel.com/main/writer/{BOOK_ID}/publish/?enter_from=newchapter`

## Rules

- Prefer publishing one chapter first before batch mode
- Never assume a selector is stable without confirming it
- Record each successful publish in state to avoid duplicates
- If login state expires, re-run `login_fanqie.js`
- Before true batch publishing, keep screenshots of each stage for audit
- Treat `50000` chars/day as a practical safety ceiling unless real backend behavior proves otherwise
- For high-volume days, pass `--already-published-chars` so the script can stop before hitting the suspected ceiling
- Prefer Fanqie's own scheduled publish UI for next-day chapter queues instead of external cron when the goal is platform-native scheduling
- **Critical platform limit:** scheduled chapters become effectively non-editable within about **30 minutes before the scheduled publish time**. If the backend warns `请在发布时间前30分钟提交修改内容，否则无法完成修改`, treat that chapter as locked for practical purposes and do not assume the time/content can still be changed.
