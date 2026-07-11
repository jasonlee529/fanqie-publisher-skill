# Fanqie Publisher Skill

[![Release](https://img.shields.io/github/v/release/amm10090/fanqie-publisher-skill?display_name=tag&style=flat-square)](https://github.com/amm10090/fanqie-publisher-skill/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](./LICENSE)
[![OpenClaw Skill](https://img.shields.io/badge/OpenClaw-Skill-blue?style=flat-square)](./SKILL.md)
[![Playwright](https://img.shields.io/badge/Playwright-Automation-45ba4b?style=flat-square)](https://playwright.dev/)

**通过浏览器自动化（Playwright + CDP），将本地 Markdown 章节发布到番茄小说网作者后台。**

> 本工具**并非**官方番茄小说 SDK 或公开 API 封装。后台改版可能导致自动化中断；正式发布前请务必使用安全模式验证。

**🌐 简体中文 · [English](./README.en.md)**

---

## 功能特性

- 解析 Markdown 章节，自动拆分章节编号、标题和正文
- 支持单章或批量发布本地目录中的章节
- 对中文、Emoji 及 Unicode 字符提供可靠的输入支持（基于重新设计的番茄编辑器及往返读取验证）
- 会话过期时引导二维码登录，支持浏览器会话复用
- 即时发布及平台原生定时发布
- 拦截并处理错词警告、内容风险检测及最终发布设置弹窗
- 发布后返回章节管理页面，确认状态为「审核中」或「已发布」
- 安全的 `--fill-only` 模式——仅填写编辑器字段，不提交任何内容
- 清晰的阶段区分：预览（preview-only）→ 仅填写（fill-only）→ 到达最终弹窗（at-final-modal）→ 已提交未验证（submitted-but-unverified）→ 已验证发布（verified publication）

## 平台支持

| 平台 | 状态 | 入口文件 | 说明 |
|------|------|----------|------|
| [OpenClaw](https://github.com/openclaw/openclaw) | ✅ **已验证** | [`SKILL.md`](./SKILL.md) | 原生技能格式，含 YAML 前置元数据、命令和规则。注入的提示文件：`AGENTS.md`、`SOUL.md`、`TOOLS.md`。 |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | ✅ **已验证** | [`SKILL.md`](./SKILL.md)（复用） | 复用同一份 `SKILL.md`。通过 `hermes claw migrate`（官方迁移路径）导入。详见 [Hermes Agent 教程](#hermes-agent)。 |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview) | ✅ **已验证** | [`CLAUDE.md`](./CLAUDE.md) | 薄适配层——引用共享的 `SKILL.md` 和 `references/` 获取业务逻辑。 |
| [OpenAI Codex CLI](https://github.com/openai/codex) | ✅ **已验证** | [`AGENTS.md`](./AGENTS.md) | 薄适配层。所有业务逻辑来源于 `SKILL.md`、`references/` 和 `scripts/`。 |
| [Cline](https://github.com/cline/cline) | ✅ **已验证** | [`.clinerules`](./.clinerules) | 薄适配层。所有业务逻辑来源于 `SKILL.md`、`references/` 和 `scripts/`。 |

> 除 OpenClaw/Hermes 外，每个薄适配层**仅作为轻量入口**。业务逻辑、选择器和安全规则均位于 `SKILL.md`、`references/` 和 `scripts/` 中。任何适配层均不重复实现发布逻辑。

## 环境要求

- **Node.js** 及 npm
- **Python 3**
- **Chromium/Chrome** 浏览器（可通过 Playwright CDP 控制）
- 一个具备后台访问权限的**番茄小说作者账号**
- 首次使用前在仓库根目录执行 `npm install`

> 请勿声称可以自动安装依赖或假定这些环境已自动就绪。每个依赖均需手动安装或配置。

## 快速开始

```bash
git clone https://github.com/amm10090/fanqie-publisher-skill.git
cd fanqie-publisher-skill
npm install
```

**基本工作流程：**

1. 将章节准备为 `.md` 文件（一个文件 = 一个章节）
2. 预览解析结果：`python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview`
3. 通过 CDP 连接已登录的浏览器：`node scripts/login_fanqie.js --cdp http://127.0.0.1:9222`
4. 安全填充测试：`node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only`
5. 验证内容和页面状态无误后，先获得用户当轮明确确认，再**移除 `--fill-only`**并添加 `--confirm-publish` 进行真实发布

## 章节格式

每个 `.md` 文件代表一个章节：

```text
第001章_标题.md

# 第001章 标题

正文第一段。

第二段。
```

解析器会将第一个 Markdown 标题从正文中剥离，将 `第001章 标题` 拆分为序号 `1` 和显示标题 `标题`，并填入番茄编辑器对应字段。序号中的前导零在实际数值输入时会被移除。

## 平台教程

### OpenClaw

将克隆后的仓库目录放入 OpenClaw 工作区的 skills 文件夹中，或将 OpenClaw 指向此目录。[`SKILL.md`](./SKILL.md) 文件作为完整的技能定义，包含：

- YAML 前置元数据（`name`、`description`），用于自动技能发现
- 完整的 `commands` 部分，涵盖所有入口点
- `rules` 部分，包含安全上限、登录处理和平台限制
- 经过验证的逐步发布工作流

OpenClaw 还会在工作区级别注入 `AGENTS.md`、`SOUL.md` 和 `TOOLS.md` 作为全局提示文件。

```bash
# 技能加载后，可用的命令：
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

关于批量发布、定时发布、分卷选择和重试，请阅读 [`SKILL.md`](./SKILL.md)。

---

### Hermes Agent

Hermes Agent 使用与 OpenClaw **相同的 `SKILL.md`** 文件。通过官方迁移命令导入。

#### 前提条件

- 已安装 Hermes Agent（官方仓库：[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)）
- 已在本地检出此仓库

#### 迁移路径（官方方式）

Hermes 提供 `hermes claw migrate` 命令，用于将 OpenClaw 技能导入到 `~/.hermes/skills/openclaw-imports/`。其 `--source` 选项需要一个 **OpenClaw 根目录**，而非直接指向此仓库。

**步骤 1 — 检查命令和 dry-run 标志：**

```bash
hermes claw migrate --help
```

应显示 `--source` 指向一个 OpenClaw 目录路径，以及 `--dry-run` 的描述为「仅预览——展示将要迁移的内容后停止」。

**步骤 2 — 将此仓库组装为 OpenClaw 兼容的源目录布局：**

在仓库根目录下执行以下命令：

```bash
OPENCLAW_SOURCE="$(mktemp -d "${TMPDIR:-/tmp}/fanqie-openclaw-source-XXXXXX")"
SKILL_SOURCE="$OPENCLAW_SOURCE/workspace/skills/fanqie-publisher"
mkdir -p "$SKILL_SOURCE"
cp SKILL.md package.json "$SKILL_SOURCE/"
cp -R references scripts "$SKILL_SOURCE/"
```

此操作仅将技能定义和共享运行时文件复制到临时源目录中。不会复制 `.git`、`state/`、登录令牌、截图或章节文件。

**步骤 3 — 使用 `--dry-run` 预览迁移：**

```bash
hermes claw migrate --source "$OPENCLAW_SOURCE" --dry-run
```

dry-run 输出将列出将被迁移和将被跳过的内容。**在进行任何更改之前务必仔细检查。** 源路径必须解析为临时的 OpenClaw 根目录，而计划的技能目标应为 `~/.hermes/skills/openclaw-imports/fanqie-publisher/`。

**步骤 4 — 确认预览结果后执行实际迁移：**

```bash
hermes claw migrate --source "$OPENCLAW_SOURCE"
```

迁移成功后，验证已导入的文件，如果你不再需要临时目录，可以删除 `OPENCLAW_SOURCE` 中存储的临时目录。切勿在递归清理命令中使用未经核实的路径。

**⚠️ 重要安全提示：**
- **务必先执行 `--dry-run`**，检查输出后再进行任何实际迁移
- 迁移仅导入 `SKILL.md`、`package.json`、`references/` 和 `scripts/`——**不会**复制 `.git`、`state/`、登录令牌或用户章节文件
- 实际的 `publish_fanqie.js` 脚本在迁移过程中**不会执行**——仅进行文件复制
- **保护你的真实配置**：如在隔离环境中测试，务必确认你的真实 `~/.hermes` 和 `~/.openclaw` 目录绝不会被用作迁移目标。保护用户真实数据是最优先事项。
- 迁移后，`~/.hermes/skills/openclaw-imports/fanqie-publisher/` 中的技能包含指向 `references/` 和 `scripts/` 的有效相对引用

**在 Hermes 中加载后，使用相同的命令：**

```bash
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

---

### Claude Code

Claude Code 从项目根目录读取 [`CLAUDE.md`](./CLAUDE.md)。该薄适配层指导 Claude：

1. 读取 `SKILL.md`、`references/workflow.md`、`references/selectors.md` 和 `scripts/publish_fanqie.js`（仅标志说明）
2. 使用来自 `SKILL.md` 入口点的共享命令
3. 遵循相同的安全规则（每天 50,000 字符上限、定时编辑 30 分钟窗口、显式设置 `是否使用AI → 否`）

```bash
# 预览章节解析
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview

# 登录或重连
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222

# 安全填充测试
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

真实发布时，使用相同的已审查参数，**移除 `--fill-only`**，添加 `--confirm-publish`。

---

### Codex CLI

Codex CLI 从项目根目录读取 [`AGENTS.md`](./AGENTS.md)。该薄适配层：

- 引用 `SKILL.md` 获取所有业务逻辑和安全规则
- 引用 `references/` 获取选择器和工作流详情
- 引用 `scripts/publish_fanqie.js` 作为唯一的发布入口
- **不会**声称自动安装、自动登录或绕过人工确认

**命令与其他平台相同：**

```bash
# 语法检查及编辑器测试
npm run test:all

# 预览章节
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview

# 登录
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222

# 安全填充
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

---

### Cline

Cline 从项目根目录读取 [`.clinerules`](./.clinerules)。该薄适配层遵循相同设计：引用共享文件，使用共享命令，强制执行共享安全规则。

**命令：**

```bash
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview
node scripts/login_fanqie.js --cdp http://127.0.0.1:9222
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```

**真实发布示例（注意：移除了 `--fill-only`，不得与 `--confirm-publish` 同时使用）：**

```bash
node scripts/publish_fanqie.js \
  --cdp http://127.0.0.1:9222 \
  --file "/path/to/chapter.md" \
  --mode immediate \
  --confirm-publish
```

## 安全发布工作流

请始终按以下阶段推进，切勿跳过步骤。

### 阶段 1：仅预览（Preview Only）
```bash
python3 scripts/prepare_chapters.py --dir "/path/to/chapters" --preview
```
验证章节编号、标题和正文是否解析正确。

### 阶段 2：仅填写（Fill Only，安全模式）
```bash
node scripts/publish_fanqie.js --cdp http://127.0.0.1:9222 --file "/path/to/chapter.md" --mode immediate --fill-only
```
编辑器中的字段被填写。**不提交任何内容。** 验证章节编号、标题、正文、分卷选择和页面状态。

### 阶段 3：到达最终弹窗（At Final Modal）
使用 `--fill-only` 时，脚本会填写字段并依次通过错词/风险检测弹窗，最终到达发布确认对话框前停止，**不会点击「确认发布」**。这确认了所有中间关卡均可通行。

### 阶段 4：已提交未验证（Submitted But Unverified）
使用 `--confirm-publish` 进行真实发布后，提交按钮已点击，但**尚未检查管理页面**。这不代表验证成功。

### 阶段 5：已验证发布（Verified Publication）✅
脚本返回章节管理页面，确认目标行存在且状态为「审核中」或「已发布」。仅此阶段确认发布成功。

> **正确真实发布示例：** 使用与填充测试相同的参数，**移除 `--fill-only`**，并添加 `--confirm-publish`。请**勿**同时使用 `--fill-only` 和 `--confirm-publish`。

## 安全边界

- 在任何真实发布之前，先测试单章或使用 `--fill-only`
- 提交前验证目标作品、分卷、章节编号、标题和正文
- **每天 50,000 字符**是实用的安全上限（并非官方配额）
- 定时章节在发布前约 **30 分钟**变为**不可编辑**——请勿在此时尝试最后的修改
- 切勿提交登录令牌、浏览器会话、截图、二维码或临时状态文件
- 番茄小说后台更新时选择器会变动——在使用前检查，不要假设选择器一直稳定
- 在最终发布弹窗中，**始终将「是否使用AI」设置为「否」**

## 故障排查

### 中文 / Emoji / Unicode 输入问题

重新设计的番茄编辑器对非 ASCII 字符需要特殊处理：

- 脚本采用**逐字符输入**加**往返读取验证**的方式处理中文、Emoji 和特殊 Unicode 字符
- 如果输入验证失败，脚本会报告 `input-validation-failed`——请修正原文后重试，不要将其报告为发布成功
- 空的编辑器装饰节点会被自动处理；如果正文字段无响应，请先确认编辑器已完全加载后再填写

### 登录问题

- 如果会话过期，脚本会引导你进行**二维码登录**（需手动扫码）
- 使用 `node scripts/login_fanqie.js --cdp http://127.0.0.1:9222` 重新连接
- 对于需要获取二维码路径的程序，请改用 `scripts/login_fanqie_notify.js`
- **不执行自动登录**——始终需要人工与二维码交互

### 选择器 / 页面状态问题

如果某一步意外失败：

1. 手动检查当前页面状态
2. 查看 [`references/selectors.md`](./references/selectors.md) 获取最新的语义选择器
3. 查看 [`references/workflow.md`](./references/workflow.md) 获取已验证的发布流程
4. 查看 [`references/editor-recon.md`](./references/editor-recon.md) 获取编辑器探查笔记
5. 如果后台发生变更，更新 `scripts/publish_fanqie.js` 中的选择器

### 弹窗 / 对话框处理

发布流程中可能遇到以下几种中间对话框：

| 对话框 | 触发条件 | 操作 |
|--------|----------|------|
| 错词/拼写检查警告 | 点击「下一步」后 | 点击「提交」继续 |
| 内容风险检测 | 错词检查通过后 | 点击「确定」继续 |
| 引导/新手教程 | 首次进入编辑器 | 尝试「知道了」/「我知道了」/「下一步」/「跳过」 |
| 最终发布设置 | 提交之前 | 将「是否使用AI」设为「否」，选择即时或定时发布，点击「确认发布」 |

## 常见问题

**问：支持定时发布吗？**
答：支持——使用 `--mode schedule` 配合 `--scheduled-time`。此功能通过番茄后台原生定时发布界面实现，而非外部 cron 任务。

**问：可以一次发布多个章节吗？**
答：可以——使用 `--dir` 替代 `--file`，还可选配 `--volume` 进行分卷选择。

**问：超过每日限制会怎样？**
答：脚本以每天 50,000 字符作为实用的安全上限。在高产量日，可传入 `--already-published-chars` 让脚本在接近疑似上限时停止。

**问：番茄后台改版后还能用吗？**
答：自动化依赖 CSS 选择器和 DOM 结构。后台改版可能破坏特定选择器——请更新 `references/selectors.md` 并使用 `--fill-only` 先行测试。

**问：可以不打开浏览器使用吗？**
答：不行——需要通过 CDP 控制的 Chromium/Chrome 浏览器会话是必需的。

## 参考文件

| 文件 | 用途 |
|------|------|
| [`SKILL.md`](./SKILL.md) | 完整的技能定义、命令、安全规则和发布流程 |
| [`references/workflow.md`](./references/workflow.md) | 经过验证的逐步发布工作流 |
| [`references/selectors.md`](./references/selectors.md) | 番茄后台页面的语义 CSS 选择器 |
| [`references/editor-recon.md`](./references/editor-recon.md) | 编辑器探查及弹窗处理笔记 |
| [`references/data-format.md`](./references/data-format.md) | 章节源文件格式规范 |
| [`scripts/publish_fanqie.js`](./scripts/publish_fanqie.js) | 主发布入口（单一事实来源） |
| [`scripts/prepare_chapters.py`](./scripts/prepare_chapters.py) | Markdown 章节解析器及预览 |
| [`scripts/login_fanqie.js`](./scripts/login_fanqie.js) | 登录与会话管理 |
| [`scripts/editor_input.js`](./scripts/editor_input.js) | Unicode 输入及往返读取验证 |
| [`CHANGELOG.md`](./CHANGELOG.md) | 发布历史 |

## 开发与测试

```bash
npm run test:all
```

执行 JavaScript 语法检查及编辑器输入测试。核心源文件：

- `scripts/publish_fanqie.js` —— 发布主流程
- `scripts/editor_input.js` —— Unicode 输入及读取验证
- `scripts/login_fanqie.js` —— 登录与会话管理
- `scripts/prepare_chapters.py` —— Markdown 章节解析

## 贡献指南

欢迎贡献。请遵循以下准则：

1. 先提交 issue 讨论变更
2. 保持薄适配层的轻量化——业务逻辑应放在 `SKILL.md`、`references/` 和 `scripts/` 中
3. 番茄后台变更时更新 `references/selectors.md`
4. 所有变更在提交前使用 `--fill-only` 测试
5. 不要提交登录令牌、浏览器会话、截图或用户数据
6. 保持 UTF-8 编码；编辑器变更后测试中文和 Emoji 输入

## 许可证

[MIT](./LICENSE)
