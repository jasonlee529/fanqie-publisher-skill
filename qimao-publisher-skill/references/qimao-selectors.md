# 七猫选择器参考（Qimao Selector Checklist — 语义优先版）

> 适用平台：七猫中文网作者后台 `zuozhe.qimao.com`
> 文档状态：**多数待侦察**（未登录无法获取实际 DOM，以下为基于语义的合理推测）
> 最后更新：2026-07-29
>
> 策略：与番茄 `selectors.md` 保持一致的"语义优先 → CSS降级 → 诊断"三段式。
> 凡标注 **待侦察** 的条目，需登录后通过 DevTools 确认并回填。

## 一、登录页

登录页 URL：`https://zuozhe.qimao.com/front/register-login/login?redirect=%2Ffront%2Findex`

### 登录方式 Tab 切换（待侦察）
- **语义优先**: `tab:has-text("验证码登录")` / `tab:has-text("密码登录")`; `[role="tab"]:has-text("手机")`
- **CSS降级**: `.login-tab`; `.tab-item`; `[class*="login-type"]`
- **诊断**: 0匹配 → 截图; 搜索含"登录"/"验证码"/"密码"文本的可点击元素

### 手机号输入框
- **语义优先**: `input[type="tel"]`; `input[placeholder*="手机"]`; `input[placeholder*="电话"]`
- **CSS降级**: `.phone-input`; `input[name="phone"]`; `input[name="mobile"]`
- **诊断**: 0匹配 → 查所有可见 `input`，按 placeholder/name 属性筛选

### 验证码输入框
- **语义优先**: `input[placeholder*="验证码"]`; `input[name="code"]`; `input[name="captcha"]`
- **CSS降级**: `.code-input`; `.captcha-input`
- **诊断**: 0匹配 → 排除手机号/密码框后剩余 input 候选

### 获取验证码按钮
- **语义优先**: `button:has-text("获取验证码")`; `[role="button"]:has-text("获取")`
- **CSS降级**: `.send-code-btn`; `.get-code-btn`; `[class*="send-code"]`
- **诊断**: 0匹配 → 搜索含"验证码"/"获取"/"发送"文本的按钮

### 密码输入框（密码登录模式）
- **语义优先**: `input[type="password"]`; `input[placeholder*="密码"]`
- **CSS降级**: `.password-input`; `input[name="password"]`
- **诊断**: 0匹配 → 按 `type="password"` 属性兜底

### 协议复选框（**必须勾选**）
- **语义优先**: `input[type="checkbox"]` 且邻近文本含"协议"/"同意"; `[role="checkbox"]`
- **CSS降级**: `.agree-checkbox`; `.protocol-checkbox`; `[class*="agree"]`
- **诊断**: 0匹配 → 扫描含"协议"/"同意"文本的可点击元素; 注意可能是 `label` 包裹 `input`

### 登录按钮
- **语义优先**: `button:has-text("登录")`; `button:has-text("登 录")`; `[role="button"]:has-text("登录")`
- **CSS降级**: `.login-btn`; `.submit-btn`; `button[type="submit"]`
- **诊断**: 0匹配 → 检查协议是否已勾选（未勾选可能导致按钮 disabled）

## 二、作品列表页

作品列表 URL：`https://zuozhe.qimao.com/front/book/list`

### 作品卡片/列表项（待侦察）
- **语义优先**: `a[href*="/front/book/"]`; `[class*="book-item"]`; `[class*="work-item"]`
- **CSS降级**: `.book-card`; `.book-list-item`; `.work-card`
- **诊断**: 0匹配 → 截图; 列出所有带 `/front/book/` 前缀的链接

### 进入某本书的章节管理（待侦察）
- **语义优先**: `a:has-text("章节管理")`; `a:has-text("管理")`; `button:has-text("章节")`
- **CSS降级**: `.chapter-manage-link`; `.book-manage-btn`
- **诊断**: 0匹配 → 在作品卡片内查找含"管理"/"章节"文本的可点击元素

### 新建作品入口（如需）
- **语义优先**: `button:has-text("新建作品")`; `a:has-text("创建作品")`
- **CSS降级**: `.create-book-btn`
- **诊断**: 0匹配 → 顶部/右上角搜索含"新建"/"创建"文本按钮

## 三、章节管理页

URL 模式（**待侦察确认**）：推测为 `/front/book/<bookId>/chapter` 或 `/front/book/chapter?bookId=...`

### 分卷选择器（待侦察 — 七猫是否有分卷未知）
- **语义优先**: `[role="combobox"]` 且含"分卷"/"卷"文本; XPath `//*[contains(.,"分卷")]/following::*[@role="combobox" or self::button][1]`
- **CSS降级**: `.volume-select`; `.serial-select`; `[class*="volume"]`
- **诊断**: 0匹配 → 搜索含"卷"文本的下拉控件; 若无则七猫可能不支持分卷概念

### 章节列表行（待侦察）
- **语义优先**: `tr` 含章节标题; `[role="row"]`
- **CSS降级**: `.chapter-row`; `.chapter-item`; `tr[class*="chapter"]`
- **诊断**: 0匹配 → 查表格结构; 列出所有 `tr` / `[role="row"]`

### 章节状态列（待侦察）
- **语义优先**: `[role="cell"]` / `td` 含"审核中"/"已发布"/"草稿"文本
- **CSS降级**: `.chapter-status`; `.status-tag`; `[class*="status"]`
- **诊断**: 0匹配 → 扫描章节行内所有文本节点

### 新建章节按钮
- **语义优先**: `a:has-text("新建章节")`; `button:has-text("新建章节")`; `a:has-text("新建")`
- **CSS降级**: `.new-chapter-btn`; `.create-chapter-link`; `[class*="new-chapter"]`
- **诊断**: 0匹配 → 截图; 检查是否需先创建首章或检查权限

## 四、编辑器页

URL 模式（**待侦察**）：推测为 `/front/book/<bookId>/chapter/edit` 或 `/front/chapter/edit/<chapterId>`

### 章节号输入框（待侦察 — 可能不存在）
- **语义优先**: `input[inputmode="numeric"]`; `input[placeholder*="章节号"]`; `input[placeholder*="序号"]`; `input[aria-label*="章节"]`
- **CSS降级**: `.serial-input`; `.chapter-num-input`; `input[name="serialNo"]`
- **诊断**: `diagnoseSelector({name:'章节号输入框', semanticHint:'章节'})` → 0匹配时考虑七猫可能将章节号与标题合并

### 标题输入框
- **语义优先**: `input[placeholder*="标题"]`; `input[placeholder*="请输入"]`; `input[aria-label*="标题"]`
- **CSS降级**: `.title-input`; `.chapter-title-input`; `input[name="title"]`
- **诊断**: `diagnoseSelector({name:'标题输入框', semanticHint:'标题'})` → 0匹配查 placeholder 变更

### 正文编辑器（locateMainEditor — 双类型覆盖）

> **关键差异**：七猫编辑器类型未确认，必须同时支持 `contenteditable` 与 `textarea` 两种。

#### 类型 A：富文本编辑器（contenteditable，与番茄一致）
- **语义优先**: `[contenteditable="true"]` 可见且面积 ≥300×100
- **CSS降级**: `.ProseMirror`; `.ql-editor`; `.public-DraftEditor-content`; `[class*="editor-content"]`
- **诊断**: 列出全部 `[contenteditable="true"]` 候选，按可见性+面积排序

#### 类型 B：纯文本编辑器（textarea）
- **语义优先**: `textarea[placeholder*="正文"]`; `textarea[placeholder*="内容"]`; `textarea[aria-label*="正文"]`
- **CSS降级**: `textarea.chapter-content`; `textarea[name="content"]`; `textarea.body-editor`
- **诊断**: 0匹配 → 列出页面上所有 `textarea`，按面积/placeholder 筛选

#### 统一入口策略（推荐实现）
```
locateMainEditor():
  1. 先查 [contenteditable="true"]，按可见性+面积排序取最大
  2. 若 0 匹配，降级查 textarea（按 placeholder/面积排序）
  3. 仍 0 匹配 → 抛出诊断信息，不静默选 .first()
```

### 存草稿按钮
- **语义优先**: `button:has-text("存草稿")`; `[role="button"]:has-text("存草稿")`; `button:has-text("保存草稿")`
- **CSS降级**: `.save-draft-btn`; `.draft-btn`; `[class*="save-draft"]`
- **诊断**: 0匹配 → 检查是否存在自动保存机制; 扫描含"草稿"/"保存"文本按钮

### 发布/下一步按钮
- **语义优先**: `button:has-text("发布")`; `button:has-text("下一步")`; `button:has-text("提交")`; `[role="button"]:has-text("发布")`
- **CSS降级**: `.publish-btn`; `.submit-btn`; `.next-btn`; `button[type="submit"]`
- **诊断**: `diagnoseSelector({name:'发布按钮', semanticHint:'发布|下一步|提交'})` → disabled 检查; 确认无拦路弹窗

### 引导/新手教程弹窗（待侦察）
- **语义优先**: `[role="dialog"]`; `[role="alertdialog"]`
- **CSS降级**: `.guide-modal`; `.onboarding`; `.arco-modal`; `.el-dialog`; `.ant-modal`
- **诊断**: 文本分析 → 引导/提示/未知; 按序尝试 `知道了` / `我知道了` / `下一步` / `完成` / `跳过` / `关闭`

## 五、发布前拦路弹窗（待侦察）

> 七猫是否存在与番茄类似的"错别字检测"/"风险检测"弹窗**待侦察确认**。以下为预防性覆盖。

### 错别字检测弹窗（推测）
- **语义优先**: `[role="dialog"]` 含"错别字"/"拼写"文本
- **继续按钮**: `button:has-text("提交")` / `button:has-text("继续")` / `button:has-text("确定")`
- **诊断**: 0匹配 → 七猫可能无此弹窗

### 风险检测弹窗（推测）
- **语义优先**: `[role="dialog"]` 含"风险"/"敏感"文本
- **继续按钮**: `button:has-text("确定")` / `button:has-text("继续发布")`
- **诊断**: 0匹配 → 七猫可能无此弹窗

### 引导弹窗关闭
- **语义**: `button[aria-label="Close"]` / `[aria-label="关闭"]`
- **CSS降级**: `.modal-close`; `.dialog-close`; `[class*="close-icon"]`
- **诊断**: `diagnoseSelector({semanticHint:'知道了|下一步|跳过|关闭'})` → 0匹配截图

## 六、最终发布弹窗（待侦察）

### 弹窗容器
- **语义优先**: `[role="dialog"]` 含"确认发布"/"发布"; `[role="alertdialog"]`
- **CSS降级**: `.publish-confirm`; `.publish-modal`; `[class*="publish-confirm"]`
- **诊断**: `diagnoseSelector({name:'发布弹窗', semanticHint:'确认发布'})` → 0匹配截图确认

### AI 声明选项（待侦察 — 七猫是否有此字段未知）
- **语义优先**: `[role="radio"]` 含"否"; `label:has-text("否")`
- **CSS降级**: `.ai-select`; `[class*="ai-option"]`
- **诊断**: 0匹配 → 七猫可能无 AI 声明字段; 若有则参照番茄必须选"否"

### 定时发布开关（待侦察）
- **语义优先**: `button[role="switch"]` 含"定时"/"定时发布"邻近文本
- **CSS降级**: `.schedule-switch`; `[class*="timer-switch"]`
- **诊断**: 0匹配 → 七猫可能不支持定时发布或入口不同

### 确认发布按钮
- **语义优先**: `button:has-text("确认发布")`; `button:has-text("发布")`; `button[aria-label="确认发布"]`
- **CSS降级**: `.confirm-publish-btn`; `.submit-publish-btn`
- **诊断**: 0匹配 → 检查弹窗内主按钮文本

### 取消按钮
- **语义优先**: `button:has-text("取消")`; `button[aria-label="取消"]`
- **CSS降级**: `.cancel-btn`
- **诊断**: 0匹配 → 弹窗右上角关闭按钮兜底

### 日期/时间输入（定时发布模式，待侦察）
- **语义优先**: `input[placeholder*="日期"]`; `input[placeholder*="时间"]`
- **CSS降级**: `.date-input`; `.time-input`; `input[type="date"]`; `input[type="time"]`
- **诊断**: 0匹配 → 七猫定时发布控件形式待确认

## 七、发布后验证

### 返回章节管理
- 导航回章节管理 URL（**待侦察确认具体 URL 模式**）
- 目标行应含标准化标题 `第N章 标题`

### 状态列文本（待侦察）
- 预期状态（参照番茄）: `审核中` / `已发布`
- **待侦察**: 七猫实际状态文本是否一致

## 八、诊断策略（与番茄对齐）

### 通用诊断函数
当语义优先选择器匹配 0 个或 2+ 个元素时：
1. 输出 `diagnoseSelector()` 结果（候选数量 / tag / text / role / className / disabled / 尺寸）
2. 输出操作建议（截图检查 / 搜索相近文本 / 确认页面加载状态）
3. **不静默选 `.first()`** — 抛出候选诊断，等待人工或降级

### 编辑器类型探测流程
由于七猫编辑器类型未确认，推荐实现：
1. 先尝试 `[contenteditable="true"]`（富文本，与番茄一致）
2. 0 匹配则降级到 `textarea`（纯文本）
3. 两种都 0 匹配 → 截图 + 输出全部可见可编辑元素诊断

### 弹窗文本归一化
- 弹窗文本可能含 Unicode 空格 / 零宽字符，比较前必须 normalize
- 按钮文本匹配使用 `:has-text()` 容错，避免精确匹配失败

## 九、已知陷阱（推测，待侦察验证）

1. **协议复选框未勾选** → 登录按钮可能 disabled，自动化需显式勾选
2. **编辑器类型不确认** → 必须双类型覆盖，单一策略可能失效
3. **章节号可能不存在** → 七猫可能将章节号与标题合并为一个输入框，解析逻辑需适配
4. **URL 路径差异** → 不可直接套用番茄的 `/main/writer/...` 路径
5. **选择器匹配 0 个或 2+ 个时先调用诊断函数，不默认定向 `.first()`**
6. **弹窗文本可能含 Unicode 空格/零宽字符**，使用前 normalize
7. **AI 声明字段可能不存在** → 若七猫无此字段，不应报错，跳过即可
8. **分卷概念可能不存在** → 若七猫无分卷，相关选择器应静默跳过而非报错

## 十、待侦察清单（需登录后回填）

以下选择器需登录七猫作者后台后通过 DevTools 确认：

- [ ] 登录页 Tab 切换控件
- [ ] 协议复选框具体结构与 selector
- [ ] 登录按钮文本与 disabled 条件
- [ ] 作品卡片 DOM 结构与链接格式
- [ ] 章节管理页 URL 模式
- [ ] 是否存在分卷概念及控件
- [ ] 章节列表表格结构与状态列
- [ ] 新建章节按钮文本与链接
- [ ] 编辑器页 URL 模式
- [ ] 编辑器类型（textarea / contenteditable）
- [ ] 章节号输入框是否存在
- [ ] 标题输入框 placeholder
- [ ] 存草稿按钮文本
- [ ] 发布按钮文本
- [ ] 中间弹窗种类与文本
- [ ] 最终发布弹窗字段
- [ ] AI 声明字段是否存在
- [ ] 定时发布控件形式
- [ ] 章节状态文本
- [ ] UI 框架识别（Arco / Element / Ant Design / 自研）以便精准降级
