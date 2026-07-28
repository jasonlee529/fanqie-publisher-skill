/**
 * editor_input.js — 封装的主编辑器定位与 Unicode 安全输入模块
 *
 * 目标：
 * 1. 智能定位主编辑器（避免固定 .first()，基于可见性/尺寸/ProseMirror 类过滤）
 * 2. Unicode 安全输入（触发合理 beforeinput/input 事件，兼容 ProseMirror state）
 * 3. 输入回读与严格断言（逐字符对比）
 * 4. dry-run / safe-stop 边界
 *
 * 设计原则：
 * - 不假设编辑器是第一个 .ProseMirror，按尺寸+可见性+类名综合评分
 * - 使用 document.execCommand('insertText') 触发原生 beforeinput/input 事件链
 * - 输入后提供 readEditorContent() 读取并 assertUnicodeFidelity() 验证
 * - safeStop 提供 before-fill / after-fill / before-save / before-publish 四级控制
 */

// ============================================================
// 1. 编辑器定位
// ============================================================

/**
 * 智能定位主编辑器
 *
 * @param {import('playwright').Page} page
 * @param {Object} [options]
 * @param {number} [options.minWidth=300]  最小宽度（px）
 * @param {number} [options.minHeight=100] 最小高度（px）
 * @param {boolean} [options.debug=false]  打印候选信息
 * @returns {Promise<{locator: import('playwright').Locator|null, found: number, candidates: Array, selectedIndex: number|null}>}
 */
async function locateMainEditor(page, options = {}) {
  const { minWidth = 300, minHeight = 100, debug = false } = options;

  const candidates = await page.evaluate(
    ({ minW, minH }) => {
      const all = Array.from(document.querySelectorAll('[contenteditable="true"]'));
      const results = [];
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const visible =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0;
        if (!visible || rect.width < minW || rect.height < minH) continue;

        const isProseMirror = el.classList.contains('ProseMirror');
        results.push({
          index: i,
          tag: el.tagName,
          id: el.id || null,
          classes: Array.from(el.classList).join('.'),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          area: Math.round(rect.width * rect.height),
          isProseMirror,
          parentTag: el.parentElement ? el.parentElement.tagName : '',
          parentClasses: el.parentElement
            ? Array.from(el.parentElement.classList).join('.')
            : '',
        });
      }
      return results;
    },
    { minW: minWidth, minH: minHeight }
  );

  if (candidates.length === 0) {
    return { locator: null, found: 0, candidates: [], selectedIndex: null };
  }

  // 排序：优先 ProseMirror，其次按面积降序
  candidates.sort((a, b) => {
    if (a.isProseMirror !== b.isProseMirror) return a.isProseMirror ? -1 : 1;
    return b.area - a.area;
  });

  const best = candidates[0];
  const locator = page.locator('[contenteditable="true"]').nth(best.index);

  if (debug) {
    console.log('[locateMainEditor] candidates:', JSON.stringify(candidates, null, 2));
    console.log('[locateMainEditor] selected index:', best.index, 'size:', best.width, 'x', best.height);
  }

  return { locator, found: candidates.length, candidates, selectedIndex: best.index };
}

// ============================================================
// 2. Unicode 安全输入（触发 beforeinput/input 事件）
// ============================================================

/**
 * 向 ProseMirror 编辑器设置内容，触发合理的 beforeinput/input 事件
 *
 * 策略：
 * - 先 select all + execCommand('delete') 清空
 * - 逐段插入：insertParagraph（段间） + insertText（段内容）
 * - 最后补发 input/change 事件
 *
 * @param {import('playwright').Locator} editorLocator
 * @param {string} text  Unicode 安全的文本内容，行以 \n 分隔
 * @returns {Promise<void>}
 */
async function setProseMirrorContent(editorLocator, text) {
  await editorLocator.evaluate((el, content) => {
    el.focus();

    // ---- Step 1: 清空 ----
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);

    // 用 delete 触发 beforeinput/input
    document.execCommand('delete', false, null);

    // ---- Step 2: 逐段插入 ----
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        document.execCommand('insertParagraph', false, null);
      }
      document.execCommand('insertText', false, lines[i]);
    }

    // ---- Step 3: 补发事件 ----
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, text);
}

// ============================================================
// 3. 回读编辑器内容
// ============================================================

/**
 * 读取编辑器当前文本内容（纯文本，去 HTML 标签）
 *
 * @param {import('playwright').Locator} editorLocator
 * @returns {Promise<string>}
 */
async function readEditorContent(editorLocator) {
  return await editorLocator.evaluate((el) => {
    // 番茄新版会把“请输入正文”等占位文案作为 contenteditable=false 的
    // ProseMirror widget 插进正文段落；直接读取 p.textContent 会误判成正文乱码。
    // 在克隆节点上剔除编辑器装饰节点，避免修改真实编辑器 DOM。
    const clone = el.cloneNode(true);
    clone
      .querySelectorAll('.ProseMirror-widget, .syl-placeholder, [contenteditable="false"]')
      .forEach((node) => node.remove());

    // ProseMirror 典型结构：多行 <p>text</p>
    const paragraphs = clone.querySelectorAll('p');
    if (paragraphs.length > 0) {
      return Array.from(paragraphs)
        .map((p) => p.textContent || '')
        .join('\n');
    }
    return clone.textContent || '';
  });
}

// ============================================================
// 4. Unicode 一致性断言
// ============================================================

/**
 * 严格逐字符对比输入与回读文本
 *
 * @param {string} input    原始输入
 * @param {string} readBack 回读文本
 * @returns {{pass: boolean, differences: Array, inputLength: number, readBackLength: number}}
 */
function assertUnicodeFidelity(input, readBack) {
  const differences = [];
  const maxLen = Math.max(input.length, readBack.length);

  for (let i = 0; i < maxLen; i++) {
    const exp = input[i] || '';
    const act = readBack[i] || '';
    if (exp !== act) {
      differences.push({
        index: i,
        expected: exp,
        actual: act,
        expectedCode: exp ? exp.charCodeAt(0) : null,
        actualCode: act ? act.charCodeAt(0) : null,
        expectedHex: exp
          ? 'U+' + exp.charCodeAt(0).toString(16).toUpperCase()
          : null,
        actualHex: act
          ? 'U+' + act.charCodeAt(0).toString(16).toUpperCase()
          : null,
        context:
          '...' +
          input.slice(Math.max(0, i - 8), i + 8) +
          '...',
      });
      if (differences.length >= 20) break;
    }
  }

  return {
    pass: differences.length === 0,
    differences,
    inputLength: input.length,
    readBackLength: readBack.length,
  };
}

// ============================================================
// 5. Dry-run / Safe-stop 边界
// ============================================================

/**
 * 根据命令行参数解析 dry-run / safe-stop 配置
 *
 * safe-stop 可选值：
 *   - 'before-fill'   ：填充前停止
 *   - 'after-fill'     ：填充后、保存前停止
 *   - 'before-save'    ：保存前停止（默认 dry-run 行为）
 *   - 'before-publish'：发布前停止
 *
 * @param {Object} args  命令行参数对象
 * @param {boolean|string} [args['dry-run']]
 * @param {string} [args['safe-stop']]
 * @returns {{isDryRun: boolean, safeStop: string|null, shouldStop: boolean, stopPoint: string|null}}
 */
function resolveDryRunConfig(args = {}) {
  const isDryRun =
    args['dry-run'] === true ||
    args['dry-run'] === 'true' ||
    args['dry-run'] === '1';

  // 显式 safe-stop 优先级高于 dry-run 默认
  const explicitStop = args['safe-stop'];
  const validStops = ['before-fill', 'after-fill', 'before-save', 'before-publish'];

  let safeStop = null;
  if (explicitStop && validStops.includes(explicitStop)) {
    safeStop = explicitStop;
  } else if (isDryRun) {
    safeStop = 'before-save';
  }

  return {
    isDryRun,
    safeStop,
    shouldStop: safeStop !== null,
    stopPoint: safeStop,
  };
}

/**
 * 生成 safe-stop 检查消息
 *
 * @param {string} currentPoint  当前代码到达的点
 * @param {Object} dryRunConfig  由 resolveDryRunConfig 返回
 * @returns {{shouldBreak: boolean, message: string|null}}
 */
function checkSafeStop(currentPoint, dryRunConfig) {
  if (!dryRunConfig.shouldStop) {
    return { shouldBreak: false, message: null };
  }

  const stopOrder = ['before-fill', 'after-fill', 'before-save', 'before-publish'];
  const curIdx = stopOrder.indexOf(currentPoint);
  const stopIdx = stopOrder.indexOf(dryRunConfig.safeStop);

  if (curIdx === -1 || stopIdx === -1) return { shouldBreak: false, message: null };

  // 到达或超过了停止点
  if (curIdx >= stopIdx) {
    return {
      shouldBreak: true,
      message: `[dry-run] 安全停止于: ${currentPoint} (配置: ${dryRunConfig.safeStop})`,
    };
  }

  return { shouldBreak: false, message: null };
}

// ============================================================
// 6. 语义优先选择器解析 + CSS 降级 + 诊断
// ============================================================

/**
 * 语义优先解析单个元素，带 CSS 降级和诊断输出
 *
 * 策略（按优先级）：
 *   1. `role` — 由 resolveElement 内部用 page.evaluate 扫描 role
 *   2. `aria-label` — 精确匹配 aria-label 属性
 *   3. `placeholder` — 精确匹配 placeholder 属性
 *   4. `text` — 按钮/链接可见文本包含
 *   5. `css (fallback)` — 原始 CSS 类选择器兜底
 *
 * 当匹配数量 ≠ 1 时输出诊断信息，便于人工判断。
 *
 * @param {import('playwright').Page} page
 * @param {Object} config
 * @param {string} config.name        - 元素可读名称（用于诊断日志）
 * @param {Array<{type:string, value:string}>} config.semantic - 语义优先策略列表
 *   type 支持: 'role', 'aria-label', 'placeholder', 'text', 'css'
 *   例如: [{type:'role', value:'combobox'}, {type:'aria-label', value:'分卷'}]
 * @param {Array<string>} [config.fallback=[]] - CSS 选择器降级列表（依次尝试）
 * @param {boolean} [config.debug=false]        - 输出详细诊断
 * @param {boolean} [config.multiple=false]     - 允许返回多个匹配
 * @returns {Promise<{locator: import('playwright').Locator|null, found: number, method: string, diagnostics: Object}>}
 */
async function resolveElement(page, config) {
  const { name, semantic = [], fallback = [], debug = false, multiple = false } = config;
  const diagnostics = { name, tried: [], found: 0, candidates: [] };

  // --- 尝试语义策略 ---
  for (const s of semantic) {
    let locator = null;
    let count = 0;
    let candidates = [];

    switch (s.type) {
      case 'role': {
        locator = page.locator(`[role="${s.value}"]`);
        count = await locator.count();
        if (count > 0) {
          candidates = await page.evaluate((role) => {
            const els = Array.from(document.querySelectorAll(`[role="${role}"]`));
            return els.map((el, i) => ({
              index: i,
              tag: el.tagName,
              text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
              visible: el.offsetWidth > 0 && el.offsetHeight > 0 && window.getComputedStyle(el).display !== 'none',
              classes: el.className.slice(0, 120),
            }));
          }, s.value);
        }
        break;
      }
      case 'aria-label': {
        locator = page.locator(`[aria-label="${s.value}"]`);
        count = await locator.count();
        if (count > 0) {
          candidates = await page.evaluate((label) => {
            const els = Array.from(document.querySelectorAll(`[aria-label="${label}"]`));
            return els.map((el, i) => ({
              index: i,
              tag: el.tagName,
              text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
              visible: el.offsetWidth > 0 && el.offsetHeight > 0 && window.getComputedStyle(el).display !== 'none',
              classes: el.className.slice(0, 120),
            }));
          }, s.value);
        }
        break;
      }
      case 'placeholder': {
        locator = page.locator(`[placeholder="${s.value}"]`);
        count = await locator.count();
        if (count > 0) {
          candidates = await page.evaluate((ph) => {
            const els = Array.from(document.querySelectorAll(`[placeholder="${ph}"]`));
            return els.map((el, i) => ({
              index: i,
              tag: el.tagName,
              value: (el.value || '').slice(0, 60),
              visible: el.offsetWidth > 0 && el.offsetHeight > 0 && window.getComputedStyle(el).display !== 'none',
              classes: el.className.slice(0, 120),
            }));
          }, s.value);
        }
        break;
      }
      case 'text': {
        // 用 Playwright text= 伪选择器
        locator = page.locator(`text=${s.value}`);
        count = await locator.count();
        if (count > 0) {
          candidates = await page.evaluate((txt) => {
            const all = Array.from(document.querySelectorAll('button, a, label, span, div, [role="button"], [role="option"]'));
            const normalize = (t) => (t || '').replace(/\s+/g, ' ').trim();
            const hits = [];
            for (let i = 0; i < all.length; i++) {
              const el = all[i];
              if (!normalize(el.textContent).includes(txt)) continue;
              if (!(el.offsetWidth > 0 && el.offsetHeight > 0 && window.getComputedStyle(el).display !== 'none')) continue;
              hits.push({
                index: i,
                tag: el.tagName,
                text: normalize(el.textContent).slice(0, 80),
                classes: el.className.slice(0, 120),
              });
              if (hits.length >= 20) break;
            }
            return hits;
          }, s.value);
          // 回退：playwright text= 匹配结果可能多于 evaluate 采样，取交集
          count = candidates.length;
        }
        break;
      }
      case 'css': {
        locator = page.locator(s.value);
        count = await locator.count();
        if (count > 0) {
          candidates = await page.evaluate((sel) => {
            const els = Array.from(document.querySelectorAll(sel));
            return els.map((el, i) => ({
              index: i,
              tag: el.tagName,
              text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
              visible: el.offsetWidth > 0 && el.offsetHeight > 0 && window.getComputedStyle(el).display !== 'none',
              classes: el.className.slice(0, 120),
              id: el.id || null,
            }));
          }, s.value);
        }
        break;
      }
      default:
        continue;
    }

    diagnostics.tried.push({ type: s.type, value: s.value, count, candidates: candidates.slice(0, 10) });

    if (count === 0) {
      if (debug) console.log(`[resolveElement] ${name}: ${s.type}="${s.value}" → 0 matches`);
      continue;
    }

    if (count === 1 || multiple) {
      diagnostics.found = count;
      diagnostics.candidates = candidates.slice(0, 10);
      if (debug) console.log(`[resolveElement] ${name}: ${s.type}="${s.value}" → ${count} match(es)`);
      return { locator: multiple ? locator : locator.first(), found: count, method: `${s.type}:"${s.value}"`, diagnostics };
    }

    // count > 1 且 !multiple: 记录诊断，继续尝试下一策略
    if (debug) console.log(`[resolveElement] ${name}: ${s.type}="${s.value}" → ${count} matches (期望1)，继续降级`);
  }

  // --- 语义策略全失败 → CSS fallback ---
  for (const cssSel of fallback) {
    const locator = page.locator(cssSel);
    const count = await locator.count();
    let candidates = [];
    if (count > 0) {
      candidates = await page.evaluate((sel) => {
        const els = Array.from(document.querySelectorAll(sel));
        return els.map((el, i) => ({
          index: i,
          tag: el.tagName,
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          visible: el.offsetWidth > 0 && el.offsetHeight > 0 && window.getComputedStyle(el).display !== 'none',
          classes: el.className.slice(0, 120),
          id: el.id || null,
        }));
      }, cssSel);
    }
    diagnostics.tried.push({ type: 'css-fallback', value: cssSel, count, candidates: candidates.slice(0, 10) });
    if (count === 1 || multiple) {
      diagnostics.found = count;
      diagnostics.candidates = candidates.slice(0, 10);
      if (debug) console.log(`[resolveElement] ${name}: CSS fallback "${cssSel}" → ${count} match(es)`);
      return { locator: multiple ? locator : locator.first(), found: count, method: `css:"${cssSel}"`, diagnostics };
    }
    if (count > 1) {
      if (debug) console.log(`[resolveElement] ${name}: CSS fallback "${cssSel}" → ${count} matches (期望1)，拒绝盲选`);
      continue;
    }
    if (debug) console.log(`[resolveElement] ${name}: CSS fallback "${cssSel}" → 0 matches`);
  }

  diagnostics.found = 0;
  if (debug) console.log(`[resolveElement] ${name}: 全部策略失败`);
  return { locator: null, found: 0, method: 'none', diagnostics };
}

/**
 * 选择器失败时的深度诊断：扫描页面中与目标语义相近的候选元素
 *
 * 输出：候选标签/文本/可见性/类名/角色/置灰状态 → 可操作人工排查
 *
 * @param {import('playwright').Page} page
 * @param {Object} options
 * @param {string} options.name       - 目标元素名称
 * @param {string} [options.semanticHint] - 语义提示词（如 "章节","标题","存草稿"）
 * @param {Array<string>} [options.tagFilter=['input','button','textarea','div','span','label']]
 * @param {number} [options.maxCandidates=15]
 * @returns {Promise<{found: number, candidates: Array, suggestion: string}>}
 */
async function diagnoseSelector(page, options) {
  const { name, semanticHint = '', tagFilter = ['input', 'button', 'textarea', 'div', 'span', 'label'], maxCandidates = 15 } = options;

  const candidates = await page.evaluate(({ hint, tags, max }) => {
    const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => {
      if (!el || !el.offsetParent) return false;
      const s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && el.offsetWidth > 0 && el.offsetHeight > 0;
    };
    const selector = tags.map((t) => t + (hint ? ':not([aria-hidden="true"])' : '')).join(',');
    const all = Array.from(document.querySelectorAll(selector));
    const hits = [];

    for (const el of all) {
      if (!isVisible(el)) continue;
      const text = normalize(el.textContent || el.value || '');
      const ariaLabel = normalize(el.getAttribute('aria-label') || '');
      const placeholder = normalize(el.getAttribute('placeholder') || '');
      const role = normalize(el.getAttribute('role') || '');
      const cls = normalize(el.className);
      const joined = `${text} ${ariaLabel} ${placeholder} ${role} ${cls}`;

      // 无提示词时收集全部可见元素；有提示词时过滤包含提示词的
      if (hint && !joined.includes(hint)) continue;

      hits.push({
        tag: el.tagName.toLowerCase(),
        role,
        text: text.slice(0, 120),
        ariaLabel: ariaLabel.slice(0, 60),
        placeholder: placeholder.slice(0, 60),
        className: cls.slice(0, 120),
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        rect: {
          w: Math.round(el.offsetWidth),
          h: Math.round(el.offsetHeight),
        },
      });
      if (hits.length >= max) return hits;
    }
    return hits;
  }, { hint: semanticHint, tags: tagFilter, max: maxCandidates });

  let suggestion = '';
  if (candidates.length === 0) {
    if (semanticHint) {
      suggestion = `页面无可视元素包含 "${semanticHint}"。可能原因：①页面未加载完成 ②元素在 iframe 内 ③语义文本已变更 ④需登录。建议：截图确认页面状态，检查 URL 是否在编辑页。`;
    } else {
      suggestion = `页面无可视交互元素。可能原因：页面空白、登录态失效、或编辑器未加载。`;
    }
  } else {
    suggestion = `找到 ${candidates.length} 个候选元素，可尝试以下方案：
- 检查候选列表，人工确认目标元素特征（tag/role/text/class）
- 若目标接近但未匹配，将特征加入 semanticHint 重试
- 若全部不匹配，截图检查页面实际 DOM 结构`;
  }

  return {
    found: candidates.length,
    candidates: candidates.slice(0, maxCandidates),
    suggestion,
  };
}

module.exports = {
  locateMainEditor,
  setProseMirrorContent,
  readEditorContent,
  assertUnicodeFidelity,
  resolveDryRunConfig,
  checkSafeStop,
  resolveElement,
  diagnoseSelector,
};
