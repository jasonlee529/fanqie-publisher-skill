# Selector checklist (语义优先版)

## Chapter management
- Chapter management selector: `a[href*="/main/writer/chapter-manage/"]`
- Volume dropdown trigger on chapter management:
  - **语义优先**: `[role="combobox"]` 且含"分卷"文本; XPath `//*[contains(.,"分卷")]/following::*[@role="combobox" or self::button][1]`
  - **CSS降级**: `.chapter-select .serial-select.flat-serial-select.byte-select.byte-select-size-default`
  - **CSS降级**: `.chapter-select .serial-select`
  - **CSS降级**: `.chapter-select .byte-select-view-value`
  - **诊断**: 0匹配 → 检查页面加载状态; 搜索含"分卷"/"卷"文本的元素
- Volume option on chapter management:
  - **语义优先**: `[role="option"]` 且文本含目标卷名
  - **CSS降级**: `.byte-select-popup .byte-select-option.chapter-select-option`
  - **CSS降级**: `.byte-select-option.chapter-select-option`
  - **CSS降级**: `.byte-select-option`
  - **诊断**: 0匹配 → 确认弹出层已展开; 用 collectVolumeDebugInfo() 扫描
- New chapter entry on chapter management:
  - **语义优先**: `a[href*="/publish/"][href*="enter_from=newchapter"]`; `a:has-text("新建章节")`; `button:has-text("新建章节")`
  - **CSS降级**: `a[href*="/publish/?enter_from=newchapter"]`
  - **诊断**: 0匹配 → 截图; 可能需先创建首章或检查权限

## Editor
- Serial/chapter-number input:
  - **语义优先**: `input[inputmode="numeric"]`; `input[placeholder="章节号"]`; `input[aria-label="章节号"]`
  - **CSS降级**: `input.serial-input.byte-input.byte-input-size-default`; `input.serial-input`
  - **诊断**: `diagnoseSelector({name:'章节号输入框', semanticHint:'章节'})` → 0匹配截图; 2+匹配选可见最大
- Title input:
  - **语义优先**: `input[placeholder="请输入标题"]`; `input[aria-label="标题"]`
  - **CSS降级**: 同上（placeholder已是语义）
  - **诊断**: `diagnoseSelector({name:'标题输入框', semanticHint:'标题'})` → 0匹配查placeholder变更
- Body editor (locateMainEditor):
  - **语义优先**: `[contenteditable="true"]` 可见且≥300×100, 优先含 ProseMirror 类者
  - **无CSS降级**（属性选择器最低语义基线）
  - **诊断**: `locateMainEditor()` 返回全部候选列表, 按 isProseMirror + 面积排序
- Save draft button:
  - **语义优先**: `button:has-text("存草稿")`; `[role="button"]` 含"存草稿"文本
  - **CSS降级**: `.auto-editor-save-btn`
  - **诊断**: 0匹配 → 检查 auto-save 是否自动触发
- Next button:
  - **语义优先**: `button:has-text("下一步")`; `[role="button"]` 含"下一步"文本
  - **CSS降级**: `.publish-button.auto-editor-next`
  - **诊断**: `diagnoseSelector({name:'下一步按钮', semanticHint:'下一步'})` → disabled检查; 确认无拦路弹窗
- Guide / onboarding dialogs:
  - **语义优先**: `[role="dialog"]`; `[role="alertdialog"]`
  - **CSS降级**: `.reactour__helper`; `.publish-guide`; `.arco-modal`; `.byte-modal`
  - **诊断**: 文本分析 → 错别字/风险/引导/未知

## Pre-publish intercept modals (拦路弹窗)
- **语义优先**: `[role="dialog"]` 内容文本分析 → 错别字/风险检测/引导
- 错别字弹窗: 文本"检测到你还有错别字未修改" → 继续按钮 **`提交`**
- 风险检测弹窗: 文本"是否进行内容风险检测？" → 继续按钮 **`确定`**
- 引导弹窗按钮: 按序尝试 `知道了` / `我知道了` / `下一步` / `完成` / `跳过` / `关闭`
- 弹窗关闭按钮: **语义** `button[aria-label="Close"]` / `[aria-label="关闭"]`; **CSS降级** `.reactour__close-button` / `.arco-modal-close-icon` / `.byte-modal-close-icon`
- **诊断**: `diagnoseSelector({semanticHint:'知道了|下一步|跳过|替换全部'})` → 0匹配→截图; 扫描全部可见按钮文本

## Final publish modal（最终发布弹窗）
- **语义优先**: `[role="dialog"]` 且文本含"确认发布"; `[role="alertdialog"]`
- **CSS降级**: `.arco-modal.publish-confirm-container-new`
- **诊断**: `diagnoseSelector({name:'发布弹窗', semanticHint:'确认发布'})` → 0匹配截图确认
- 弹窗内校验: 必须含目标分卷名（如"第二卷：城市猎场"）和章节标题（如"第90章 猎犬与新王"）
- AI选择"否": `[role="radio"]` 含"否"; `label:has-text("否")`; **CSS降级** 弹窗上下文内 label 过滤"否"
- 定时发布开关: `button[role="switch"]`
- 确认发布按钮: `button:has-text("确认发布")`; `button[aria-label="确认发布"]`
- 取消按钮: `button:has-text("取消")`
- 日期输入: `input[placeholder="请选择日期"]`
- 时间输入: `input[placeholder="请选择时间"]`

## Post-submit verification
- 导航回 chapter-management URL
- 目标行应含标准化标题 `第N章 标题`
- 状态列: `审核中` 或 `已发布`

## Known pitfalls（已知陷阱）
1. `是否使用AI` 是 `确认发布` 的前置条件；未显式选则"否"可能导致按钮不触发
2. 直接打开 draft URL 可能分卷错误 → 优先从 chapter-manage 选卷
3. 编辑器可能含多个 `.ProseMirror`（AI助手/大纲区）→ `locateMainEditor` 按面积+可见性自动筛选
4. 按钮 disabled 状态需用 `aria-disabled` 或 `class` 判断，避免盲点
5. **选择器匹配 0 个或 2+ 个时先调用诊断函数，不默认定向 `.first()`**
6. 弹窗文本可能含 Unicode 空格/零宽字符，使用前 normalize
