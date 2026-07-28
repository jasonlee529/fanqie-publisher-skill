#!/usr/bin/env node
/**
 * publish_qimao.js — 七猫中文网章节发布脚本
 *
 * 参照 publish_fanqie.js 架构，适配七猫作者后台（zuozhe.qimao.com/front/）。
 * 复用 editor_input.js 的 Unicode 安全输入与语义选择器能力。
 *
 * 安全流程：fill-only → to-final-modal → confirm-publish
 * 禁止在未显式 --confirm-publish 时执行真实发布。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync, execFile } = require('child_process');
const { promisify } = require('util');
const { ensureLoggedIn, cookieOnlyEnsureLoggedIn, isLoggedIn: isQimaoLoggedIn, LOGIN_URL } = require('./qimao_login_flow');
const { resolvePage } = require('./browser_page_picker_qimao');
const {
  locateMainEditor,
  setProseMirrorContent,
  readEditorContent,
  assertUnicodeFidelity,
  resolveDryRunConfig,
  checkSafeStop,
  resolveElement,
  diagnoseSelector,
} = require('./editor_input');

const execFileAsync = promisify(execFile);

// ============================================================
// 七猫后台 URL 常量
// ============================================================

const QIMAO_BASE = 'https://zuozhe.qimao.com';
const INDEX_URL = `${QIMAO_BASE}/front/index`;
const BOOK_LIST_URL = `${QIMAO_BASE}/front/book/list`;
const LOGIN_PAGE_URL = `${QIMAO_BASE}/front/register-login/login`;
const DEFAULT_DAILY_LIMIT_CHARS = 50000; // 安全上限，非官方文档值
const DEFAULT_PROFILE = 'default';

/** 七猫专用状态文件路径解析（与 login_qimao.js 保持一致） */
function resolveStatePaths(profile = DEFAULT_PROFILE) {
  const skillRoot = path.resolve(__dirname, '..');
  const stateDir = path.join(skillRoot, 'state');
  const base = profile === DEFAULT_PROFILE
    ? path.join(stateDir, 'qimao-storage-state.json')
    : path.join(stateDir, `qimao-storage-state-${profile}.json`);
  const dir = path.dirname(base);
  const ext = path.extname(base);
  const stem = path.basename(base, ext);
  return {
    storageState: base,
    qrPng: path.join(dir, `${stem.replace('-storage-state', '')}-qr.png`),
    cookieJson: path.join(dir, `${stem.replace('-storage-state', '')}-cookies.json`),
  };
}

/** 七猫专用页面登录态快速验证（复用七猫的 isLoggedIn） */
async function quickValidateOnPage(page, options = {}) {
  const { logger = console } = options;
  const startTime = Date.now();
  const currentUrl = page.url();
  if (!currentUrl || currentUrl === 'about:blank') {
    return { valid: false, reason: 'page 尚未导航', elapsedMs: 0 };
  }
  const loggedIn = await isQimaoLoggedIn(page);
  const elapsedMs = Date.now() - startTime;
  logger.log(`[session:onpage-check] loggedIn=${loggedIn}, elapsed=${elapsedMs}ms`);
  if (loggedIn) {
    return { valid: true, reason: '检测到有效登录态', elapsedMs };
  }
  return { valid: false, reason: '当前页面未检测到登录标识；可能需要重新登录。', elapsedMs };
}

/** 构造章节管理 URL：/front/book/{bookId}/chapter */
function chapterManageUrl(bookId) {
  return `${QIMAO_BASE}/front/book/${bookId}/chapter`;
}

/** 构造章节编辑 URL：/front/book/{bookId}/chapter/edit */
function chapterEditUrl(bookId) {
  return `${QIMAO_BASE}/front/book/${bookId}/chapter/edit`;
}

// ============================================================
// 命令行参数解析
// ============================================================

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const next = argv[i + 1];
    if (!key.startsWith('--')) continue;
    if (!next || next.startsWith('--')) args[key.slice(2)] = true;
    else {
      args[key.slice(2)] = next;
      i += 1;
    }
  }
  return args;
}

// ============================================================
// 章节加载与过滤（平台无关，复用 prepare_chapters.py）
// ============================================================

function loadChapters(args) {
  const prep = path.resolve(__dirname, 'prepare_chapters.py');
  if (args.file) {
    const dir = path.dirname(args.file);
    const res = spawnSync('python3', [prep, '--dir', dir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (res.status !== 0) throw new Error(res.stderr || 'prepare_chapters failed');
    return JSON.parse(res.stdout).filter((c) => c.file === args.file);
  }
  if (args.dir) {
    const res = spawnSync('python3', [prep, '--dir', args.dir], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (res.status !== 0) throw new Error(res.stderr || 'prepare_chapters failed');
    return JSON.parse(res.stdout);
  }
  throw new Error('Provide --file or --dir');
}

function filterChapters(chapters, args) {
  let items = [...chapters];
  if (args['start-from']) {
    const keyword = String(args['start-from']).trim();
    const idx = items.findIndex(
      (c) => c.name.includes(keyword) || c.title.includes(keyword) || c.display_title?.includes(keyword)
    );
    if (idx >= 0) items = items.slice(idx);
  }
  const limit = Number(args.limit || items.length || 1);
  return items.slice(0, limit);
}

function applyDailyLimitGuard(chapters, args) {
  const mode = args.mode || 'immediate';
  if (mode !== 'immediate') return chapters;
  const dailyLimit = Number(args['daily-limit-chars'] || DEFAULT_DAILY_LIMIT_CHARS);
  const alreadyPublished = Number(args['already-published-chars'] || 0);
  let running = alreadyPublished;
  const accepted = [];
  for (const chapter of chapters) {
    const next = running + Number(chapter.word_count || 0);
    if (next > dailyLimit) break;
    accepted.push(chapter);
    running = next;
  }
  return accepted;
}

function resolveScheduleAt(base, index, stepMinutes = 30) {
  const dt = new Date(base.replace(' ', 'T'));
  if (Number.isNaN(dt.getTime())) throw new Error(`Invalid --schedule-at value: ${base}`);
  dt.setMinutes(dt.getMinutes() + index * stepMinutes);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}`, full: `${yyyy}-${mm}-${dd} ${hh}:${mi}` };
}

// ============================================================
// 发布状态持久化（平台无关）
// ============================================================

function loadPublishState(stateFile) {
  if (!fs.existsSync(stateFile)) return { published: [] };
  return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
}

function savePublishState(stateFile, state) {
  ensureDir(path.dirname(stateFile));
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

function isPublishedInState(state, file) {
  return (state.published || []).some((item) => item.file === file);
}

function markPublished(stateFile, chapter, verify, mode) {
  const state = loadPublishState(stateFile);
  if (isPublishedInState(state, chapter.file)) return;
  state.published ||= [];
  state.published.push({
    file: chapter.file,
    title: chapter.title,
    status: verify.status || null,
    publishedAt: verify.publishTime || null,
    rowText: verify.rowText || null,
    mode,
    recordedAt: new Date().toISOString(),
  });
  savePublishState(stateFile, state);
}

function isRetryableFailure(result) {
  const reason = String(result?.reason || '');
  if (!reason) return false;
  if (/等待扫码登录超时|单日字数上限/.test(reason)) return false;
  return /未检测到最终发布弹窗|章节管理页未找到目标章节|弹窗仍未关闭|Target closed|Execution context was destroyed|Navigation failed|Timeout|ERR_|blocked:/.test(
    reason
  );
}

// ============================================================
// 浏览器连接
// ============================================================

async function ensureRemoteBrowserReady(cdpUrl) {
  if (!cdpUrl || (!cdpUrl.startsWith('http://') && !cdpUrl.startsWith('https://'))) return;
  const jsonUrl = cdpUrl.replace(/\/$/, '') + '/json/version';

  const canReach = async () => {
    try {
      const res = await fetch(jsonUrl);
      return !!res.ok;
    } catch {
      return false;
    }
  };

  if (await canReach()) return;

  for (let i = 0; i < 8; i++) {
    if (await canReach()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function connectBrowser(args, statePath, playwright) {
  let cdpUrl = args.cdp || null;
  const { chromium } = playwright;
  let browser;
  let context;
  const launchedBrowser = !cdpUrl;

  if (cdpUrl) {
    await ensureRemoteBrowserReady(cdpUrl);
    if (cdpUrl.startsWith('http://') || cdpUrl.startsWith('https://')) {
      const jsonUrl = cdpUrl.replace(/\/$/, '') + '/json/version';
      const res = await fetch(jsonUrl);
      if (!res.ok) throw new Error(`Failed to query DevTools endpoint: ${jsonUrl} => ${res.status}`);
      const meta = await res.json();
      cdpUrl = meta.webSocketDebuggerUrl || cdpUrl;
    }
    browser = await chromium.connectOverCDP(cdpUrl);
    context = browser.contexts()[0] || (await browser.newContext({ storageState: statePath }));
  } else {
    // 无 CDP 时使用 headless 模式（纯 cookie 认证，无法扫码）
    const headless = args['cookie-only'] || !args['non-headless'];
    console.log(`[connect] launch browser headless=${headless}`);
    browser = await chromium.launch({
      headless,
      slowMo: headless ? 0 : 80,
      args: [
        '--disable-crash-reporter',
        '--disable-breakpad',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
    context = await browser.newContext({ storageState: statePath });
  }

  return { browser, context, launchedBrowser };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ============================================================
// 章节号提取
// ============================================================

function chapterNumber(chapter) {
  if (!chapter.serial) return null;
  return String(parseInt(String(chapter.serial).replace(/^第/, '').replace(/章$/, ''), 10));
}

// ============================================================
// 分卷选择（语义优先，七猫 DOM 未确认）
// ============================================================

function expandVolumeNameCandidates(volumeName) {
  const base = String(volumeName || '').trim();
  if (!base) return [];
  const set = new Set([base]);
  if (base === '第一卷') set.add('默认');
  if (base === '默认') set.add('第一卷');
  if (base === '正文卷') set.add('正文');
  if (base === '正文') set.add('正文卷');
  return Array.from(set);
}

/**
 * 在章节管理页或编辑页切换目标分卷
 * 由于七猫后台 DOM 未确认，使用语义优先 + XPath 兜底策略
 */
async function selectVolume(page, volumeName, shotsDir, prefix, args = {}) {
  if (!volumeName) return { ok: true, skipped: true };

  const aliases = expandVolumeNameCandidates(volumeName);
  await page.waitForTimeout(1200);

  // 语义优先：查找分卷相关控件
  const triggerResult = await resolveElement(page, {
    name: '分卷选择控件',
    semantic: [
      { type: 'aria-label', value: '分卷' },
      { type: 'placeholder', value: '分卷' },
      { type: 'text', value: '分卷' },
    ],
    fallback: ['[role="combobox"]', '.arco-select', '.semi-select', 'input[placeholder*="分卷"]', 'button:has-text("正文卷")'],
    debug: !!args['debug-volume'],
  });
  let trigger = triggerResult.locator;

  // XPath 兜底：查找包含"分卷"文本附近的可交互元素
  if (!trigger) {
    const xpathCandidates = [
      '//*[contains(normalize-space(.),"分卷")]/following::*[@role="combobox" or self::button or self::input][1]',
      '//*[contains(normalize-space(.),"第一卷") or contains(normalize-space(.),"正文卷")][self::div or self::span or self::button][1]',
    ];
    for (const xp of xpathCandidates) {
      const loc = page.locator(`xpath=${xp}`).first();
      if (await loc.count()) {
        trigger = loc;
        break;
      }
    }
  }

  if (!trigger) {
    return { ok: false, reason: '未找到"分卷选择"控件。' };
  }

  const beforeText = ((await trigger.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  if (aliases.some((name) => beforeText.includes(name))) {
    return { ok: true, alreadyMatched: true, selected: volumeName, matchedAs: beforeText };
  }

  await trigger.click({ timeout: 5000 }).catch(async () => trigger.click({ timeout: 5000, force: true }));
  await page.waitForTimeout(800);
  if (shotsDir && prefix) {
    await page.screenshot({ path: path.join(shotsDir, `${prefix}-01a-volume-open.png`), fullPage: true }).catch(() => {});
  }

  // 在下拉选项中匹配目标分卷
  const optionSelectors = [
    '[role="option"]',
    '.arco-select-option',
    '.semi-select-option',
    '.arco-dropdown-menu-item',
    'li',
    'button',
    'div',
    'span',
  ];

  let option = null;
  for (const alias of aliases) {
    for (const selector of optionSelectors) {
      const exact = page.locator(selector).filter({ hasText: alias }).first();
      if (await exact.count()) {
        option = exact;
        break;
      }
    }
    if (option) break;
  }

  if (!option) {
    await page.keyboard.press('Escape').catch(() => {});
    return { ok: false, reason: `已打开分卷控件，但未找到目标分卷：${volumeName}` };
  }

  await option.click({ timeout: 5000 });
  await page.waitForTimeout(800);
  if (shotsDir && prefix) {
    await page.screenshot({ path: path.join(shotsDir, `${prefix}-01b-volume-selected.png`), fullPage: true }).catch(() => {});
  }

  return { ok: true, selected: volumeName };
}

// ============================================================
// 编辑器输入：支持 contenteditable 与 textarea 两种类型
// ============================================================

/**
 * 定位正文编辑器：优先 contenteditable（ProseMirror），降级 textarea
 * @returns {Promise<{type: 'contenteditable'|'textarea'|null, locator: Locator|null, found: number, candidates: Array}>}
 */
async function locateBodyEditor(page, options = {}) {
  // 1. 先尝试 contenteditable 编辑器（复用 editor_input.js 的智能定位）
  const ceResult = await locateMainEditor(page, { debug: !!options.debug });
  if (ceResult.locator) {
    return { type: 'contenteditable', locator: ceResult.locator, found: ceResult.found, candidates: ceResult.candidates };
  }

  // 2. 降级到 textarea：按尺寸/可见性评分
  const textareaResult = await resolveElement(page, {
    name: '正文 textarea',
    semantic: [
      { type: 'placeholder', value: '请输入正文' },
      { type: 'aria-label', value: '正文' },
      { type: 'placeholder', value: '输入章节内容' },
    ],
    fallback: ['textarea.editor-content', 'textarea[name="content"]', 'textarea.chapter-content', 'textarea'],
    debug: !!options.debug,
  });
  if (textareaResult.locator) {
    return { type: 'textarea', locator: textareaResult.locator, found: 1, candidates: [] };
  }

  return { type: null, locator: null, found: 0, candidates: [] };
}

/**
 * 向编辑器写入正文，根据编辑器类型选择输入策略
 * - contenteditable：使用 setProseMirrorContent（触发 beforeinput/input）
 * - textarea：使用 fill + 补发 input/change 事件
 */
async function writeBodyContent(editorInfo, content) {
  const { type, locator } = editorInfo;
  if (type === 'contenteditable') {
    await locator.click();
    await setProseMirrorContent(locator, content);
    return await readEditorContent(locator);
  }
  if (type === 'textarea') {
    // textarea 用 fill 设值后补发事件，确保框架（如 React/Vue）能感知
    await locator.fill(content);
    await locator.evaluate((el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return await locator.inputValue();
  }
  throw new Error(`不支持的编辑器类型: ${type}`);
}

// ============================================================
// 引导弹窗处理
// ============================================================

async function dismissEditorGuides(page, shotsDir, prefix) {
  const maxRounds = 8;
  for (let round = 1; round <= maxRounds; round++) {
    const guide = page
      .locator('.reactour__helper, .publish-guide, [role="dialog"], .arco-modal, .semi-modal, .byte-modal')
      .last();
    if (!(await guide.count())) break;

    const labels = ['知道了', '我知道了', '下一步', '完成', '跳过', '关闭'];
    let handled = false;
    for (const label of labels) {
      const btn = guide.locator('button, div, span').filter({ hasText: label }).first();
      if (await btn.count()) {
        await btn.click({ timeout: 3000 }).catch(async () => btn.click({ timeout: 3000, force: true }));
        handled = true;
        await page.waitForTimeout(800);
        break;
      }
    }
    if (!handled) {
      const closeBtn = guide
        .locator('[aria-label="Close"], .reactour__close-button, .arco-modal-close-icon, .semi-modal-close, .byte-modal-close-icon')
        .first();
      if (await closeBtn.count()) {
        await closeBtn.click({ timeout: 3000 }).catch(async () => closeBtn.click({ timeout: 3000, force: true }));
        handled = true;
        await page.waitForTimeout(800);
      }
    }
    if (!handled) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
    }
  }
  if (shotsDir && prefix) {
    await page.screenshot({ path: path.join(shotsDir, `${prefix}-01-guide-dismissed.png`), fullPage: true }).catch(() => {});
  }
}

// ============================================================
// 填写草稿：章节号、标题、正文、作者说
// ============================================================

async function fillDraft(page, chapter, shotsDir, prefix, args = {}) {
  const bookId = args['book-id'];
  if (!bookId) throw new Error('缺少 --book-id 参数，无法定位七猫章节编辑页。');

  // 1. 导航到章节编辑页
  const editUrl = chapterEditUrl(bookId);
  await page.goto(editUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: path.join(shotsDir, `${prefix}-01-edit-page.png`), fullPage: true }).catch(() => {});
  await dismissEditorGuides(page, shotsDir, prefix);

  // 2. 分卷切换（如有）
  let volumeResult = { ok: true, skipped: true };
  if (args.volume) {
    volumeResult = await selectVolume(page, args.volume, shotsDir, prefix, args);
    if (!volumeResult.ok) {
      throw new Error(volumeResult.reason || '分卷选择失败');
    }
  }

  // 3. 章节号输入：语义优先 → CSS 降级 → 诊断
  const serialResult = await resolveElement(page, {
    name: '章节号输入框',
    semantic: [
      { type: 'css', value: 'input[inputmode="numeric"]' },
      { type: 'placeholder', value: '章节号' },
      { type: 'aria-label', value: '章节号' },
    ],
    fallback: ['input.serial-input', 'input[name="serial"]', 'input[name="chapterNo"]'],
    debug: !!args['debug-editor'],
  });
  let serialInput = serialResult.locator;
  if (!serialInput && args['debug-editor']) {
    const diag = await diagnoseSelector(page, { name: '章节号输入框', semanticHint: '章节' });
    console.warn(`[诊断] 章节号输入框语义匹配失败。候选项:`, JSON.stringify(diag.candidates.slice(0, 5), null, 2));
  }
  const num = chapterNumber(chapter);
  if (num && serialInput) await serialInput.fill(num);

  // 4. 标题输入：语义优先 → CSS 降级 → 诊断
  const titleResult = await resolveElement(page, {
    name: '标题输入框',
    semantic: [
      { type: 'placeholder', value: '请输入标题' },
      { type: 'placeholder', value: '章节标题' },
      { type: 'aria-label', value: '标题' },
    ],
    fallback: ['input[placeholder*="标题"]', 'input[name="title"]', 'input[name="chapterName"]'],
    debug: !!args['debug-editor'],
  });
  let titleInput = titleResult.locator;
  if (!titleInput) {
    titleInput = page.locator('input[placeholder*="标题"]').first();
  }
  if (!titleInput && args['debug-editor']) {
    const diag = await diagnoseSelector(page, { name: '标题输入框', semanticHint: '标题' });
    console.warn(`[诊断] 标题输入框语义匹配失败。候选项:`, JSON.stringify(diag.candidates.slice(0, 3), null, 2));
  }
  if (titleInput) await titleInput.fill(chapter.display_title || chapter.title);

  // 5. 正文输入（支持 contenteditable 与 textarea）
  const dryRunConfig = resolveDryRunConfig(args);
  const editorInfo = await locateBodyEditor(page, { debug: !!args['debug-editor'] });
  if (!editorInfo.locator) {
    throw new Error(
      `未找到正文编辑器（contenteditable / textarea 均未命中）。候选: ${JSON.stringify(editorInfo.candidates)}`
    );
  }
  console.log(`[fillDraft] 编辑器类型: ${editorInfo.type}`);

  // safe-stop: before-fill
  const stop1 = checkSafeStop('before-fill', dryRunConfig);
  if (stop1.shouldBreak) {
    console.log(stop1.message);
    return { mode: `dry-run:${dryRunConfig.safeStop}`, volumeResult, contentVerified: false };
  }

  const readBack = await writeBodyContent(editorInfo, chapter.content);
  const assertion = assertUnicodeFidelity(chapter.content, readBack);
  if (!assertion.pass) {
    console.warn('[fillDraft] ⚠ 输入回读不一致:', JSON.stringify(assertion.differences.slice(0, 5), null, 2));
    throw new Error(`Unicode 一致性校验失败: ${assertion.differences.length} 处差异`);
  }
  console.log(`[fillDraft] ✅ 输入回读一致 (${readBack.length} chars)`);

  // 6. 作者说（七猫特有，番茄没有）：可选字段，存在才填
  await fillAuthorNote(page, chapter, args);

  // safe-stop: after-fill
  const stop2 = checkSafeStop('after-fill', dryRunConfig);
  if (stop2.shouldBreak) {
    console.log(stop2.message);
    return { mode: `dry-run:${dryRunConfig.safeStop}`, volumeResult, contentVerified: assertion.pass, assertion };
  }

  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(shotsDir, `${prefix}-02-filled-draft.png`), fullPage: true }).catch(() => {});
  return { mode: 'filled', volumeResult, contentVerified: assertion.pass, assertion, editorType: editorInfo.type };
}

/**
 * 填写"作者说"字段（七猫特有）
 * 仅当页面存在该字段时才填写，不存在则跳过
 */
async function fillAuthorNote(page, chapter, args) {
  const authorNote = chapter.author_note || args['author-note'];
  if (!authorNote) return;

  const noteResult = await resolveElement(page, {
    name: '作者说输入框',
    semantic: [
      { type: 'placeholder', value: '作者说' },
      { type: 'aria-label', value: '作者说' },
      { type: 'placeholder', value: '写给读者的话' },
    ],
    fallback: ['textarea[name="authorNote"]', 'textarea.author-note', 'input[placeholder*="作者说"]'],
    debug: !!args['debug-editor'],
  });
  if (noteResult.locator) {
    await noteResult.locator.fill(authorNote);
    console.log('[fillAuthorNote] 已填写作者说');
  }
}

// ============================================================
// 拦路弹窗处理
// ============================================================

async function handleInterceptors(page) {
  const maxRounds = 10;
  for (let round = 1; round <= maxRounds; round++) {
    // 检测最终发布弹窗：包含"确认发布"或"提交"按钮的对话框
    const publishModal = await detectPublishModal(page);
    if (publishModal) return 'publish-modal';

    const dialog = page
      .locator('.arco-modal[role="dialog"], .semi-modal, .byte-modal[role="dialog"], .reactour__helper, .arco-modal, .byte-modal')
      .last();
    if (await dialog.count()) {
      const text = ((await dialog.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();

      const isSpellcheck = /错别字|智能纠错|是否确定提交|发布提示/.test(text);
      const isRiskDetection = /是否进行内容风险检测|风险检测/.test(text);
      const isGuide = /知道了|我知道了|下一步|跳过|完成|欢迎|引导/.test(text);

      let candidates = [];
      if (isSpellcheck) candidates = ['替换全部', '全部替换', '确认替换', '提交', '继续发布'];
      else if (isRiskDetection) candidates = ['确定', '继续'];
      else if (isGuide) candidates = ['我知道了', '知道了', '下一步', '完成', '跳过', '关闭'];

      let handled = false;
      for (const label of candidates) {
        const btn = dialog.locator('button').filter({ hasText: label }).first();
        if (await btn.count()) {
          console.log(`已处理拦路弹窗 ${round}: [${label}] ${text.slice(0, 160)}`);
          await btn.click().catch(async () => btn.click({ force: true }));
          await page.waitForTimeout(1800);
          handled = true;
          break;
        }
      }

      if (await detectPublishModal(page)) return 'publish-modal';

      if (!handled && isGuide) {
        const closeBtn = dialog
          .locator('[aria-label="Close"], .reactour__close-button, .arco-modal-close-icon, .semi-modal-close, .byte-modal-close-icon')
          .first();
        if (await closeBtn.count()) {
          await closeBtn.click().catch(async () => closeBtn.click({ force: true }));
          await page.waitForTimeout(1500);
          continue;
        }
      }

      if (!handled && (isSpellcheck || isRiskDetection)) {
        return `blocked:${isSpellcheck ? 'spellcheck' : 'risk-detection'}`;
      }
      if (!handled && !isGuide) {
        return 'blocked:unknown-dialog';
      }
    }
    await page.waitForTimeout(1200);
  }
  return 'unknown';
}

/**
 * 检测最终发布弹窗：查找包含"确认发布"/"发布"/"提交"按钮的对话框
 */
async function detectPublishModal(page) {
  const modalSelectors = [
    '.arco-modal',
    '.semi-modal',
    '.byte-modal',
    '[role="dialog"]',
  ];
  for (const sel of modalSelectors) {
    const modal = page.locator(sel).last();
    if (!(await modal.count())) continue;
    // 检查弹窗内是否包含发布/提交类按钮
    for (const btnText of ['确认发布', '发布', '提交', '确定发布']) {
      const btn = modal.getByRole('button', { name: btnText, exact: btnText.length === 2 ? false : true });
      if (await btn.count()) return modal;
    }
  }
  return null;
}

// ============================================================
// 进入最终发布弹窗
// ============================================================

async function goToFinalPublishModal(page, chapter, shotsDir, prefix, args = {}) {
  // 下一步/发布按钮：语义优先 → CSS 降级 → 诊断
  // 七猫按钮文本可能是"发布"、"下一步"、"提交"等
  const nextBtnTexts = ['发布', '下一步', '提交', '保存并发布'];
  let nextBtn = null;
  for (const text of nextBtnTexts) {
    const result = await resolveElement(page, {
      name: `${text}按钮`,
      semantic: [
        { type: 'role', value: 'button' },
        { type: 'text', value: text },
      ],
      debug: !!args['debug-editor'],
    });
    if (result.locator) {
      nextBtn = result.locator;
      break;
    }
  }

  if (!nextBtn) {
    // CSS 兜底
    const fallbacks = ['.publish-button', '.submit-btn', 'button.publish', 'button[type="submit"]'];
    for (const css of fallbacks) {
      const loc = page.locator(css).first();
      if (await loc.count()) {
        nextBtn = loc;
        break;
      }
    }
  }

  if (!nextBtn) {
    const diag = await diagnoseSelector(page, { name: '发布按钮', semanticHint: '发布', tagFilter: ['button'] });
    return { ok: false, reason: `未找到发布/下一步按钮。候选：${JSON.stringify(diag.candidates.slice(0, 5))}` };
  }

  await nextBtn.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shotsDir, `${prefix}-03-after-next.png`), fullPage: true }).catch(() => {});

  const gateResult = await handleInterceptors(page);
  await page.screenshot({ path: path.join(shotsDir, `${prefix}-04-after-interceptors.png`), fullPage: true }).catch(() => {});
  await page.waitForTimeout(1000);

  const publishModal = await detectPublishModal(page);
  if (!publishModal) {
    return { ok: false, reason: `未检测到最终发布弹窗。gateResult=${gateResult}` };
  }

  // 校验弹窗内容：标题/分卷
  const modalText = ((await publishModal.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
  const expectedNum = chapterNumber(chapter);
  const expectedTitle = chapter.display_title || chapter.title;
  const expectedFullTitle = expectedNum ? `第${expectedNum}章 ${expectedTitle}` : expectedTitle;
  if (args.volume && !modalText.includes(args.volume)) {
    return { ok: false, reason: `最终发布弹窗分卷不匹配：期望包含「${args.volume}」；实际为：${modalText.slice(0, 200)}` };
  }
  if (!modalText.includes(expectedTitle) && !modalText.includes(expectedFullTitle)) {
    return { ok: false, reason: `最终发布弹窗章节标题不匹配：期望「${expectedFullTitle}」；实际为：${modalText.slice(0, 200)}` };
  }

  await page.screenshot({ path: path.join(shotsDir, `${prefix}-05-final-publish-modal.png`), fullPage: true }).catch(() => {});
  return { ok: true, publishModal, modalText };
}

// ============================================================
// 发布后验证
// ============================================================

async function collectVisibleMessages(page) {
  return await page.evaluate(() => {
    const normalize = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const isVisible = (el) => {
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const selectors = [
      '.arco-message', '.semi-message', '.byte-message',
      '.arco-message-notice', '.semi-message-notice', '.byte-message-notice',
      '.arco-notification', '.semi-notification', '.toast', '[class*="toast"]',
      '[class*="message"]', '[class*="notification"]',
    ];
    const out = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const el of Array.from(document.querySelectorAll(selector))) {
        if (!isVisible(el)) continue;
        const text = normalize(el.innerText || el.textContent || '');
        if (!text || seen.has(text)) continue;
        seen.add(text);
        out.push({ text, className: normalize(el.className || '').slice(0, 200) });
      }
    }
    return out;
  });
}

function detectPublishLimit(messages = []) {
  const joined = messages.map((m) => m.text).join(' | ');
  if (/(单日|当天|今日).*(字数|上限|限制)/.test(joined) || /(字数|章节).*(达到|超过).*(上限|限制)/.test(joined)) {
    return joined;
  }
  return null;
}

/**
 * 返回章节管理页并验证目标章节是否已发布
 * 在管理表中查找章节行，状态应为"审核中"或"已发布"
 */
async function verifyPublished(page, chapter, shotsDir, prefix, args = {}) {
  const bookId = args['book-id'];
  const manageUrl = bookId ? chapterManageUrl(bookId) : BOOK_LIST_URL;
  await page.goto(manageUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(shotsDir, `${prefix}-07-chapter-manage-after-publish.png`), fullPage: true }).catch(() => {});

  const expectedNum = chapterNumber(chapter);
  const displayTitle = chapter.display_title || chapter.title;
  return await page.evaluate(({ title, num }) => {
    const normalizedTitle = num ? `第${num}章 ${title}` : title;
    // 七猫表格行选择器：兼容多种 UI 框架
    const rowSelectors = ['.arco-table-tr', '.semi-table-row', '.byte-table-tr', 'tr', '[role="row"]'];
    let rows = [];
    for (const sel of rowSelectors) {
      rows = Array.from(document.querySelectorAll(sel));
      if (rows.length > 1) break;
    }
    for (const row of rows) {
      const text = (row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || !text.includes(normalizedTitle)) continue;
      const cellSelectors = ['.arco-table-td', '.semi-table-td', '.byte-table-td', 'td', '[role="cell"]'];
      let cells = [];
      for (const sel of cellSelectors) {
        cells = Array.from(row.querySelectorAll(sel));
        if (cells.length > 1) break;
      }
      const cellTexts = cells.map((el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
      return {
        found: true,
        title: normalizedTitle,
        rowText: text,
        cells: cellTexts,
        status: cellTexts[3] || cellTexts[2] || null,
        publishTime: cellTexts[4] || cellTexts[3] || null,
      };
    }
    return { found: false, title: normalizedTitle };
  }, { title: displayTitle, num: expectedNum });
}

// ============================================================
// 单章发布：一次尝试
// ============================================================

async function publishOneOnce(page, context, chapter, args, shotsDir, stateFile, statePath, qrPath, index, attempt = 1) {
  const prefix = `${String(index + 1).padStart(2, '0')}-try${attempt}`;
  const mode = args.mode || 'immediate';
  const scheduleInfo =
    mode === 'scheduled' && args['schedule-at']
      ? resolveScheduleAt(args['schedule-at'], index, Number(args['schedule-step-minutes'] || 30))
      : null;
  console.log(`开始处理: ${chapter.title} (${path.basename(chapter.file)}) attempt=${attempt}`);

  const bookId = args['book-id'];
  if (!bookId) {
    return { chapter, ok: false, reason: '缺少 --book-id 参数。' };
  }
  const manageUrl = chapterManageUrl(bookId);

  // 确保当前页在七猫后台
  const currentUrl = page.url() || '';
  if (!/zuozhe\.qimao\.com\/front\//i.test(currentUrl)) {
    await page.goto(manageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
  }

  // 登录态校验：cookie-only 模式 vs 完整登录流程
  const useCookieOnly = !!(args['cookie-only'] || !args.cdp);
  let loginCheck;
  if (useCookieOnly) {
    loginCheck = await cookieOnlyEnsureLoggedIn(page, context, {
      loginUrl: manageUrl,
      statePath,
      logger: console,
    });
  } else {
    loginCheck = await ensureLoggedIn(page, {
      qrPath,
      logger: console,
      saveStorageState: async () => {
        await context.storageState({ path: statePath });
        console.log(`已刷新登录态: ${statePath}`);
      },
    });
  }

  if (!loginCheck.loggedIn) {
    const reason =
      loginCheck.reason ||
      (loginCheck.qrCapture?.path ? `等待扫码登录超时。二维码截图: ${loginCheck.qrCapture.path}` : null) ||
      '登录态验证失败。';
    return { chapter, ok: false, reason };
  }

  // 填写草稿
  let fillResult;
  try {
    fillResult = await fillDraft(page, chapter, shotsDir, prefix, args);
  } catch (err) {
    return { chapter, ok: false, reason: err.message || String(err) };
  }

  // dry-run 提前返回
  if (fillResult?.mode?.startsWith('dry-run:')) {
    return {
      chapter,
      mode: fillResult.mode,
      ok: true,
      volumeResult: fillResult?.volumeResult,
      contentVerified: fillResult?.contentVerified,
    };
  }

  const dryRunConfig = resolveDryRunConfig(args);
  const beforeSaveStop = checkSafeStop('before-save', dryRunConfig);
  if (beforeSaveStop.shouldBreak) {
    console.log(beforeSaveStop.message);
    return {
      chapter,
      mode: `dry-run:${dryRunConfig.safeStop}`,
      ok: true,
      volumeResult: fillResult?.volumeResult,
      contentVerified: fillResult?.contentVerified,
    };
  }

  // fill-only：仅填充不提交
  if (args['dry-run'] || args['fill-only']) {
    return { chapter, mode: 'fill-only', ok: true, volumeResult: fillResult?.volumeResult };
  }

  // 进入最终发布弹窗
  const modalResult = await goToFinalPublishModal(page, chapter, shotsDir, prefix, args);
  if (!modalResult.ok) return { chapter, ok: false, reason: modalResult.reason };

  // to-final-modal：到弹窗停止
  if (args['to-final-modal'] || !args['confirm-publish']) {
    return { chapter, mode: 'to-final-modal', ok: true, volumeResult: fillResult?.volumeResult };
  }

  // safe-stop: before-publish
  const beforePublishStop = checkSafeStop('before-publish', dryRunConfig);
  if (beforePublishStop.shouldBreak) {
    console.log(beforePublishStop.message);
    return {
      chapter,
      mode: `dry-run:${dryRunConfig.safeStop}`,
      ok: true,
      volumeResult: fillResult?.volumeResult,
      contentVerified: fillResult?.contentVerified,
    };
  }

  // 定时发布设置
  if (mode === 'scheduled') {
    if (!scheduleInfo) {
      return { chapter, ok: false, reason: 'scheduled 模式需要 --schedule-at，例如 2026-03-13 21:00' };
    }
    const scheduledResult = await configureScheduledPublish(page, modalResult.publishModal, scheduleInfo, shotsDir, prefix);
    if (!scheduledResult.ok) return { chapter, ok: false, reason: scheduledResult.reason };
  } else if (mode !== 'immediate') {
    return { chapter, ok: false, reason: '当前版本只开放 immediate / scheduled。' };
  }

  // 点击最终确认发布按钮
  const confirmResult = await clickConfirmPublish(page, modalResult.publishModal, shotsDir, prefix);
  if (!confirmResult.ok) return { chapter, ok: false, reason: confirmResult.reason };

  // 弹窗仍未关闭 → 提交未真正生效
  if (confirmResult.stillOnModal) {
    return {
      chapter,
      ok: false,
      verify: { found: false },
      scheduleInfo,
      volumeResult: fillResult?.volumeResult,
      reason: '点击"确认发布"后发布弹窗仍未关闭；通常表示必填项未完成或页面未真正提交。',
      postConfirmMessages: confirmResult.postConfirmMessages,
    };
  }

  // 检测字数上限提示
  const publishLimitReason = detectPublishLimit(confirmResult.postConfirmMessages);
  if (publishLimitReason) {
    return {
      chapter,
      ok: false,
      verify: { found: false },
      scheduleInfo,
      volumeResult: fillResult?.volumeResult,
      reason: `触发单日字数上限：${publishLimitReason}`,
    };
  }

  // 发布后验证
  const verify = await verifyPublished(page, chapter, shotsDir, prefix, args);
  if (verify.found) {
    markPublished(stateFile, chapter, verify, mode);
  }
  return {
    chapter,
    ok: !!verify.found,
    verify,
    scheduleInfo,
    volumeResult: fillResult?.volumeResult,
    reason: verify.found ? null : '章节管理页未找到目标章节',
    postConfirmMessages: confirmResult.postConfirmMessages,
  };
}

/**
 * 配置定时发布：设置日期和时间
 */
async function configureScheduledPublish(page, publishModal, scheduleInfo, shotsDir, prefix) {
  const switchBtn = publishModal.locator('button[role="switch"]').first();
  if (await switchBtn.count()) {
    const checked = ((await switchBtn.getAttribute('class')) || '').includes('checked');
    if (!checked) {
      await switchBtn.click();
      await page.waitForTimeout(800);
    }
  }
  const dateInput = publishModal.locator('input[placeholder*="日期"], input[placeholder="请选择日期"]').first();
  const timeInput = publishModal.locator('input[placeholder*="时间"], input[placeholder="请选择时间"]').first();
  if (!(await dateInput.count()) || !(await timeInput.count())) {
    return { ok: false, reason: '未找到定时发布的日期/时间控件。' };
  }
  await dateInput.fill(scheduleInfo.date);
  await dateInput.press('Enter').catch(() => {});
  await page.waitForTimeout(300);
  await timeInput.fill(scheduleInfo.time);
  await timeInput.press('Enter').catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(shotsDir, `${prefix}-06-scheduled-filled.png`), fullPage: true }).catch(() => {});
  return { ok: true };
}

/**
 * 点击"确认发布"按钮并采集点击后的页面状态
 */
async function clickConfirmPublish(page, publishModal, shotsDir, prefix) {
  // 七猫按钮文本可能是"确认发布"、"发布"、"提交"
  const confirmTexts = ['确认发布', '发布', '提交', '确定发布'];
  let confirmBtn = null;
  for (const text of confirmTexts) {
    const btn = publishModal.getByRole('button', { name: text, exact: text.length === 2 ? false : true });
    if (await btn.count()) {
      confirmBtn = btn.first();
      break;
    }
  }
  if (!confirmBtn) {
    const diag = await diagnoseSelector(page, { name: '确认发布按钮', semanticHint: '确认发布', tagFilter: ['button'] });
    return {
      ok: false,
      reason: `未找到"确认发布"按钮。候选：${JSON.stringify(diag.candidates.slice(0, 5))}`,
    };
  }

  await page.screenshot({ path: path.join(shotsDir, `${prefix}-06-before-confirm-publish.png`), fullPage: true }).catch(() => {});
  await confirmBtn.click().catch(async () => confirmBtn.click({ force: true }));
  await page.waitForTimeout(2500);

  // 检查弹窗是否仍存在
  const stillOnModal = !!(await detectPublishModal(page));
  const postConfirmMessages = await collectVisibleMessages(page).catch(() => []);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(shotsDir, `${prefix}-06-after-confirm-publish.png`), fullPage: true }).catch(() => {});

  return { ok: true, stillOnModal, postConfirmMessages };
}

// ============================================================
// 单章发布（含一次重试）
// ============================================================

async function publishOne(page, context, chapter, args, shotsDir, stateFile, statePath, qrPath, index) {
  const first = await publishOneOnce(page, context, chapter, args, shotsDir, stateFile, statePath, qrPath, index, 1);
  if (first.ok || !isRetryableFailure(first)) return first;

  console.log(`检测到可恢复失败，准备重试一次: ${chapter.title} :: ${first.reason || 'unknown'}`);
  const bookId = args['book-id'];
  try {
    if (bookId) {
      await page.goto(chapterManageUrl(bookId), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
    }
  } catch {}

  const second = await publishOneOnce(page, context, chapter, args, shotsDir, stateFile, statePath, qrPath, index, 2);
  second.retried = true;
  second.firstFailureReason = first.reason || null;
  return second;
}

// ============================================================
// 主入口
// ============================================================

async function main() {
  const args = parseArgs(process.argv);
  const mode = args.mode || 'immediate';
  const skillRoot = path.resolve(__dirname, '..');
  const profile = args.profile || DEFAULT_PROFILE;

  const { storageState: statePath, qrPng: qrPath } = resolveStatePaths(profile);
  const stateFile = path.join(skillRoot, 'state', `publish-state-qimao${profile === DEFAULT_PROFILE ? '' : `-${profile}`}.json`);
  const shotsDir = path.join(skillRoot, 'state', 'screenshots-qimao');
  ensureDir(shotsDir);

  if (profile !== DEFAULT_PROFILE) {
    console.log(`使用 profile: ${profile}`);
  }

  // 加载 playwright 依赖
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    console.error('Missing dependency: playwright');
    console.error('Install with: npm i -D playwright');
    process.exit(1);
  }
  if (!fs.existsSync(statePath)) {
    console.error('缺少登录态。请先运行七猫登录脚本建立会话。');
    process.exit(1);
  }

  // 加载并过滤章节
  const loaded = loadChapters(args);
  let chapters = filterChapters(loaded, args);
  if (!chapters.length) {
    console.error('No chapters found to publish');
    process.exit(1);
  }

  chapters = applyDailyLimitGuard(chapters, { ...args, mode });
  if (!chapters.length) {
    console.log(`按照每日字数保护阈值停止：当前 mode=${mode}，没有可安全继续发布的章节。`);
    return;
  }

  if (args['skip-published']) {
    const state = loadPublishState(stateFile);
    chapters = chapters.filter((c) => !isPublishedInState(state, c.file));
  }
  if (!chapters.length) {
    console.log('待处理章节为空。');
    return;
  }

  // 连接浏览器
  const { browser, context, launchedBrowser } = await connectBrowser(args, statePath, playwright);

  /** 安全关闭浏览器：launch 模式下直接退出进程，避免 sandbox 的 Crashpad 限制报错 */
  async function safeShutdown(exitCode) {
    try {
      if (launchedBrowser) {
        // launch 模式下直接退出进程，由 OS 回收进程，规避 Crashpad/SavedState 受 sandbox 限制
        process.exit(exitCode);
      }
      await browser.close().catch(() => {});
    } finally {
      process.exit(exitCode);
    }
  }

  // 选择七猫后台页面
  const bookId = args['book-id'];
  const preferredPatterns = [
    BOOK_LIST_URL,
    bookId ? chapterManageUrl(bookId) : null,
    bookId ? chapterEditUrl(bookId) : null,
    /https?:\/\/(?:www\.)?zuozhe\.qimao\.com\/front\/book\//i,
    /https?:\/\/(?:www\.)?zuozhe\.qimao\.com\/front\//i,
    /https?:\/\/(?:www\.)?qimao\.com\//i,
  ].filter(Boolean);
  const { page, reusedExistingPage } = await resolvePage(context, {
    preferredUrlPatterns: preferredPatterns,
    collapseQimaoWriterTabs: true,
  });
  console.log(`发布页选择完成: reused=${reusedExistingPage} url=${page.url() || 'about:blank'}`);

  // ----- 会话有效性检测 -----
  const useCookieOnly = !!(args['cookie-only'] || !args.cdp);
  if (useCookieOnly) {
    console.log('[会话检测] 使用纯 Cookie 认证模式（无扫码交互）');
    const cookieAuth = await cookieOnlyEnsureLoggedIn(page, context, {
      loginUrl: bookId ? chapterManageUrl(bookId) : BOOK_LIST_URL,
      statePath,
      logger: console,
    });

    if (!cookieAuth.loggedIn) {
      console.error(`[会话检测] Cookie 认证失败: ${cookieAuth.reason}`);
      console.error('');
      console.error('请按以下步骤重新获取有效 cookie:');
      console.error('  1. 在 GUI 浏览器中登录七猫作者后台');
      console.error('  2. 运行 cookie 提取脚本导出 cookies.json');
      console.error('  3. 将生成的 cookies.json 传输到当前环境');
      console.error('  4. 导入 cookie 后重新运行发布命令');
      await safeShutdown(1);
    }
    console.log('[会话检测] Cookie 认证通过，登录态有效');
  } else {
    // CDP 模式：在已加载页面上快速校验
    const currentUrl = page.url() || '';
    if (currentUrl && currentUrl !== 'about:blank' && /zuozhe\.qimao\.com\/front\//i.test(currentUrl)) {
      const preCheck = await quickValidateOnPage(page, { logger: console });
      if (!preCheck.valid) {
        console.log(`[预检] 当前页面登录态可能已过期: ${preCheck.reason}`);
        console.log('[预检] 将重新导航到七猫后台并完整验证登录态...');

        const targetUrl = bookId ? chapterManageUrl(bookId) : BOOK_LIST_URL;
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(2000);

        const loginCheck = await ensureLoggedIn(page, {
          qrPath,
          logger: console,
          saveStorageState: async () => {
            await context.storageState({ path: statePath });
            console.log(`[预检] 已刷新登录态: ${statePath}`);
          },
        });

        if (!loginCheck.loggedIn) {
          console.error('[预检] 会话验证失败，无法开始发布流程。');
          await safeShutdown(1);
        }
        console.log('[预检] 登录态已恢复，继续发布流程。');
      } else {
        console.log(`[预检] 登录态有效 (${preCheck.elapsedMs}ms)`);
      }
    }
  }

  // ----- 逐章发布 -----
  const results = [];
  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    const result = await publishOne(page, context, chapter, { ...args, mode }, shotsDir, stateFile, statePath, qrPath, i);
    results.push(result);
    console.log(JSON.stringify(result, null, 2));

    if (!result.ok) {
      console.log(`停止批量流程，卡在: ${chapter.title}`);
      break;
    }
    if (i < chapters.length - 1) {
      await page.waitForTimeout(2000);
    }
  }

  // ----- 汇总 -----
  const successCount = results.filter((r) => r.ok && r.verify?.found).length;
  const final = {
    requested: chapters.length,
    processed: results.length,
    publishedVerified: successCount,
    mode,
    platform: 'qimao',
    bookId: args['book-id'] || null,
    volume: args.volume || null,
    dailyLimitChars: Number(args['daily-limit-chars'] || DEFAULT_DAILY_LIMIT_CHARS),
    alreadyPublishedChars: Number(args['already-published-chars'] || 0),
    results: results.map((r) => ({
      title: r.chapter.title,
      ok: r.ok,
      reason: r.reason || null,
      status: r.verify?.status || null,
      publishTime: r.verify?.publishTime || null,
      selectedVolume: r.volumeResult?.selected || null,
      alreadyMatchedVolume: !!r.volumeResult?.alreadyMatched,
    })),
  };
  console.log('BATCH_SUMMARY');
  console.log(JSON.stringify(final, null, 2));

  // launch 模式下汇总输出后直接退出，避免 browser.close() 触发 sandbox 的 Crashpad 限制
  if (launchedBrowser) {
    process.exit(0);
  }
  await browser.close().catch(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
