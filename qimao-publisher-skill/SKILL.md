# Qimao Publisher Skill — 七猫小说发布

Publish prepared novel chapters from local Markdown files to the Qimao (七猫中文网) writer backend via browser automation (Playwright).

## Read First

All authoritative project definitions and business logic reside in the following files. Do not act without reading them:

- [`SKILL.md`](./SKILL.md) — full skill definition, commands, safety rules, and publishing flow
- [`references/qimao-workflow.md`](./references/qimao-workflow.md) — validated step-by-step publish workflow
- [`references/qimao-selectors.md`](./references/qimao-selectors.md) — semantic CSS selectors for Qimao backend pages
- [`scripts/publish_qimao.js`](./scripts/publish_qimao.js) — the sole publishing entrypoint (read flags, not copy logic)
- [`package.json`](./package.json) — dependency: `playwright` only

## Prerequisites

- Node.js + npm, Python 3
- Chromium/Chrome browser (Playwright-controllable via CDP)
- A Qimao author account with an opened backend session
- Run `npm install` in the `qimao-publisher-skill` directory before first use

**Do not** claim that any of these are automatically installed or available.

## Site Info

- 域名：`zuozhe.qimao.com`
- URL 前缀：`/front/`
- 登录页：`https://zuozhe.qimao.com/front/register-login/login`
- 首页：`https://zuozhe.qimao.com/front/index`
- 作品列表：`https://zuozhe.qimao.com/front/book/list`
- 登录方式：手机验证码 / 账号密码（非扫码）

## Entry Points

| Action | Command |
|--------|---------|
| Syntax checks + editor test | `npm run test:all` |
| Preview chapter parse | `python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview` |
| Login / reconnect | `npm run login` (or `node scripts/login_qimao.js --cdp http://127.0.0.1:9222`) |
| Login with profile alias | `node scripts/login_qimao.js --cdp http://127.0.0.1:9222 --profile <name>` |
| Safe fill-only publish | `node scripts/publish_qimao.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --book-id <BOOK_ID> --mode immediate --fill-only` |
| Real publish | Only after explicit user confirmation: use the same reviewed arguments, **remove `--fill-only`**, and add `--confirm-publish` |

登录需要手动在浏览器中完成手机验证码或账号密码登录（非扫码），并勾选协议同意复选框。脚本会自动检测登录成功并保存状态到 `state/qimao-storage-state.json`。

## UTF-8 / Unicode Safeguards

- Chapter files **must** be valid UTF-8 with no BOM
- Use `scripts/prepare_chapters.py --preview` to verify parsing before any publish attempt
- The editor input flow (`scripts/editor_input.js`) validates CJK, emoji, and newline round-trip fidelity
- A round-trip mismatch raises `Unicode 一致性校验失败` — do not downgrade it to success
- Always inspect a single filled chapter visually before batch operations

## Publish Safety Protocol

1. **Preview first**: `python3 scripts/prepare_chapters.py --dir "<chapters>" --preview`
2. **Fill-only dry run**: `node scripts/publish_qimao.js --fill-only` — fills the editor but does **not** submit
   - Verify: chapter number, title, body, volume assignment, page state
3. **Final publish modal is not published**: the `确认发布` click is the actual submit — verify modal contents before clicking
4. **Post-publish verification**: always navigate back to chapter management and confirm row status
5. **Scheduled publish**: only `确认发布` with a timer set is the real action

**Never report success** without post-publish chapter-management verification.

## Status Differentiation

| State | Meaning |
|-------|---------|
| `preview-only` | Chapter parse preview was displayed; no publish action taken |
| `fill-only` | Editor fields were filled but the submit button was not clicked |
| `to-final-modal` | The final publish dialog was reached but not confirmed |
| `submitted-unverified` | Submit was clicked, but the management page did not contain the target chapter row; this is **not** a verified success |
| `published-verified` | Submit was clicked, the management page was reloaded, and the target chapter row was found with expected status |
| `login-expired-or-timeout` | Session expired or manual login timed out; report failure and re-run `npm run login` |
| `input-validation-failed` | Chinese/Emoji round-trip or another input validation failed; fix the input and do not report publication |
| `error` | Any unexpected script error, timeout, or missing dependency |

## Commands

### 登录

```bash
# CDP 模式连接已有浏览器
node scripts/login_qimao.js --cdp http://127.0.0.1:9222

# 多账号
node scripts/login_qimao.js --cdp http://127.0.0.1:9222 --profile account2
```

### 发布

```bash
# 安全填充测试（不提交）
node scripts/publish_qimao.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --book-id <BOOK_ID> --mode immediate --fill-only

# 到最终弹窗停止
node scripts/publish_qimao.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --book-id <BOOK_ID> --mode immediate --to-final-modal

# 确认发布
node scripts/publish_qimao.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --book-id <BOOK_ID> --mode immediate --confirm-publish

# 批量发布
node scripts/publish_qimao.js --cdp http://127.0.0.1:9222 --dir "/path/to/chapters" --book-id <BOOK_ID> --mode immediate --confirm-publish

# 无头模式（纯Cookie）
node scripts/publish_qimao.js --cookie-only --file "/path/to/chapter.md" --book-id <BOOK_ID> --mode immediate --confirm-publish
```

## Rules

- 登录方式为手机验证码/密码，不支持扫码
- 需勾选协议同意复选框才能登录
- 七猫可能有"作者说"字段（番茄没有），脚本已支持
- 编辑器类型待侦察（可能是 textarea 或 contenteditable），脚本双类型覆盖
- 选择器尚未在登录态下验证，首次使用需通过 `--fill-only` 侦察
- 状态文件：`state/qimao-storage-state.json`
- 截图目录：`state/screenshots-qimao/`
- **Do not** perform real publish without the current user's explicit per-round confirmation and `--confirm-publish`
- **Do not** claim automatic dependency installation, automatic login, or bypass of human confirmation
