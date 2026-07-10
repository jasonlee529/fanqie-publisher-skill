# fanqie-publisher

[![Release](https://img.shields.io/github/v/release/amm10090/fanqie-publisher-skill?display_name=tag&style=flat-square)](https://github.com/amm10090/fanqie-publisher-skill/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](./LICENSE)
[![OpenClaw Skill](https://img.shields.io/badge/OpenClaw-Skill-blue?style=flat-square)](./SKILL.md)
[![Playwright](https://img.shields.io/badge/Playwright-Automation-45ba4b?style=flat-square)](https://playwright.dev/)

面向 OpenClaw 的番茄小说发布 Skill。它通过 Playwright 接管浏览器，把本地 Markdown 章节填入番茄作者后台，支持立即发布、平台原生定时发布和发布后状态校验。

> 这不是番茄官方 SDK 或公开 API 封装。页面改版可能影响自动化流程，真实发布前请先用安全模式验证。

## 核心能力

- 单章或批量读取 Markdown 章节
- 自动拆分章节号、标题与正文
- 适配新版章节编辑器，可靠输入中文、Emoji 和换行
- 登录失效时引导二维码登录并复用浏览器会话
- 支持立即发布和番茄后台原生定时发布
- 处理错别字、内容风险检测、最终发布设置等中间弹窗
- 发布后回到章节管理页核对章节状态
- 提供 `--fill-only` 等安全模式，避免误发布

## 环境要求

- Node.js 与 npm
- Python 3
- 可由 Playwright 接管的 Chromium/Chrome 浏览器
- 已开通番茄作者后台的账号

## 安装

```bash
git clone https://github.com/amm10090/fanqie-publisher-skill.git
cd fanqie-publisher-skill
npm install
```

作为 OpenClaw Skill 使用时，将仓库目录交给 OpenClaw，并以 [`SKILL.md`](./SKILL.md) 作为完整操作说明。

## 章节格式

一个 `.md` 文件对应一章。推荐文件名和内容如下：

```text
第001章_标题.md

# 第001章 标题

第一段正文。

第二段正文。
```

解析器会移除正文中的首个 Markdown 标题，并把 `第001章 标题` 拆成章节号 `1` 与标题 `标题`。更多规则见 [`references/data-format.md`](./references/data-format.md)。

## 快速开始

### 1. 预览解析结果

```bash
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview
```

### 2. 连接已登录浏览器

以下示例使用 Chrome DevTools Protocol：

```bash
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222
```

如果登录态失效，脚本会引导二维码登录。需要让上层程序读取二维码路径时，可改用 `scripts/login_fanqie_notify.js`。

### 3. 先做安全填充

```bash
node scripts/publish_fanqie.js \
  --cdp http://127.0.0.1:9222 \
  --file "/path/to/chapter.md" \
  --mode immediate \
  --fill-only
```

确认章节号、标题、正文、分卷和页面状态都正确后，再把 `--fill-only` 改为 `--confirm-publish` 进行真实发布。

批量发布、定时发布、分卷选择、重试和全部参数见 [`SKILL.md`](./SKILL.md)。

## 安全边界

- 首次运行或页面改版后，先发布一章或只使用 `--fill-only`
- 真正提交前确认目标书籍、分卷、章节号、标题和正文
- 不要提交登录态、浏览器会话、后台截图、二维码或临时状态文件
- 脚本把 `50,000` 字/日作为经验性安全阈值；它不是官方公开额度
- 定时章节进入发布时间前约 30 分钟后，后台可能不再允许可靠修改

## 平台限制

番茄后台可能出现引导浮层、错别字提示、内容风险检测、版本冲突或发布设置弹窗。选择器和流程会随页面变化，遇到异常时请先检查页面，再更新：

- [`references/selectors.md`](./references/selectors.md) — 语义控件与选择器清单
- [`references/workflow.md`](./references/workflow.md) — 已验证的发布流程
- [`references/editor-recon.md`](./references/editor-recon.md) — 新版编辑器勘测记录

## 开发与测试

```bash
npm run test:all
```

该命令执行 JavaScript 语法检查和编辑器输入测试。核心入口：

- `scripts/publish_fanqie.js` — 发布主流程
- `scripts/editor_input.js` — Unicode 正文输入与回读校验
- `scripts/login_fanqie.js` — 登录与会话处理
- `scripts/prepare_chapters.py` — Markdown 章节解析

## 许可证

本项目采用 [MIT License](./LICENSE)。
