# Editor and publish-flow reference (语义优先版)

## 核心变更 (Step 3)
- 核心编辑发布路径的选择器改为 `resolveElement()` 语义优先 + CSS 降级双轨制；正文由 `locateMainEditor()` 按可见性、尺寸和编辑器特征选择
- 新增 `diagnoseSelector()` 在匹配失败时输出候选项
- 详细策略见 `references/selectors.md` 及 `editor_input.js` 中的 `resolveElement` / `diagnoseSelector`

## Confirmed dashboard signals
- writer dashboard loads successfully after login
- chapter management link exists
- create chapter link exists
- concrete create-chapter path resolves to a draft URL under `/main/writer/<bookId>/publish/<chapterId>`

## 选择器参考（语义优先 → CSS降级）

以下列出编辑器页的核心元素定位策略。完整版见 `selectors.md`。

| 元素 | 语义优先策略 | CSS降级 |
|------|-------------|---------|
| 章节号输入 | `input[inputmode="numeric"]` / placeholder="章节号" / aria-label="章节号" | `.serial-input.byte-input...` |
| 标题输入 | `input[placeholder="请输入标题"]` / aria-label="标题" | 同上（已含语义属性） |
| 正文编辑器 | `locateMainEditor()` 按可见性/面积/ProseMirror类排序 | `[contenteditable="true"]` |
| 存草稿按钮 | `button:has-text("存草稿")` / `[role="button"]` 含"存草稿" | `.auto-editor-save-btn` |
| 下一步按钮 | `button:has-text("下一步")` / aria-label="下一步" | `.publish-button.auto-editor-next` |
| 发布弹窗 | `[role="dialog"]` 含"确认发布" | `.arco-modal.publish-confirm-container-new` |
| AI=否 | `[role="radio"]` 含"否" / label 含"否" | 弹窗内 label 过滤文本 |
| 确认发布 | `button:has-text("确认发布")` | 同上 |
| 取消 | `button:has-text("取消")` | 同上 |
| 弹窗关闭 | `button[aria-label="Close"]` / `[aria-label="关闭"]` | `.reactour__close-button` / `.arco-modal-close-icon` |

## Parsing rule adjustment
The Fanqie editor splits chapter number and chapter title into separate inputs.
Example:
- source heading: `第001章 拉闸`
- serial input should receive: `1`
- title input should receive: `拉闸`

Rule: strip leading zeroes from chapter numbers before filling the serial input.

## 诊断流程（失败时自动执行）
当语义优先选择器匹配 0 个或 2+ 个元素时：
1. 输出 `diagnoseSelector()` 结果（候选数量/tag/text/role/className/disabled/尺寸）
2. 输出操作建议（截图检查/搜索相近文本/确认页面加载状态）
3. **不静默选 `.first()`** — 抛出候选诊断，等待人工或降级

## Observed caveat
The page may contain multiple `.ProseMirror` editors because of AI helper / outline sections.
→ `locateMainEditor` 已处理：按 `isProseMirror` 过滤 + 面积降序

## Detection flow
After clicking `下一步`, there may be multiple confirmation gates before the final publish dialog:
1. content risk detection confirm modal → 文本"是否进行内容风险检测？" → 点 `确定`
2. typo / misspelling detection confirm modal → 文本"检测到你还有错别字" → 点 `提交`
   - if smart correction appears, prefer `替换全部`
   - if a follow-up submit warning appears, prefer `提交`
3. possible writer-guide / tour overlay → 按序尝试 `知道了` / `我知道了` / `下一步` / `完成` / `跳过` / `关闭`
4. final publish dialog

## Final publish dialog signals
- **语义优先**: `[role="dialog"]` 含"确认发布"
- **CSS降级**: `.arco-modal.publish-confirm-container-new`
- AI selection exists with `是 / 否`
- scheduled publish switch exists as `button[role="switch"]`
- final primary button text: `确认发布`
- cancel button text: `取消`

## Safe stop point
A safe mode should:
- fill chapter serial, title, and body
- click `下一步`
- confirm risk / typo detection gates
- reach the final publish dialog
- select `AI = 否`
- stop before clicking `确认发布`

## Scheduled publish limitation
Fanqie may show the warning:
`请在发布时间前30分钟提交修改内容，否则无法完成修改`

Practical consequence:
- once a chapter is within ~30 minutes of its scheduled publish time, modifying that scheduled chapter may fail or be blocked
- if a reschedule is needed, do it well in advance
- prefer creating the final desired schedule correctly the first time
