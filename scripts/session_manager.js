#!/usr/bin/env node
/**
 * session_manager.js — 登录态/会话统一管理模块
 *
 * 核心能力：
 * 1. 快速有效性预检（不触发长时间轮询，快速判断已有登录态是否过期）
 * 2. Cookie 粒度导出/导入（从 storageState 中提取/注入纯 Cookie）
 * 3. 多状态文件支持（--profile 切换不同账号/会话）
 * 4. 会话健康状态报告
 */

const fs = require('fs');
const path = require('path');
const { isLoggedIn, LOGIN_URL, ensureDir } = require('./fanqie_login_flow');

// ----- 配置 -----

const DEFAULT_PROFILE = 'default';
const STATE_DIR = (() => {
  const skillRoot = path.resolve(__dirname, '..');
  return path.join(skillRoot, 'state');
})();

/**
 * 根据 profile 名称解析对应状态文件路径
 * @param {'default'|string} profile
 * @returns {{ storageState: string, qrPng: string, cookieJson: string }}
 */
function resolveStatePaths(profile = DEFAULT_PROFILE) {
  const base = profile === DEFAULT_PROFILE
    ? path.join(STATE_DIR, 'fanqie-storage-state.json')
    : path.join(STATE_DIR, `fanqie-storage-state-${profile}.json`);

  const dir = path.dirname(base);
  const ext = path.extname(base);
  const stem = path.basename(base, ext);
  return {
    storageState: base,
    qrPng: path.join(dir, `${stem.replace('-storage-state', '')}-qr.png`),
    cookieJson: path.join(dir, `${stem.replace('-storage-state', '')}-cookies.json`),
  };
}

/**
 * 判断 storageState 文件是否存在且非空
 */
function storageStateExists(profile = DEFAULT_PROFILE) {
  const { storageState } = resolveStatePaths(profile);
  if (!fs.existsSync(storageState)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(storageState, 'utf8'));
    const cookies = data?.cookies || [];
    return cookies.length > 0;
  } catch {
    return false;
  }
}

/**
 * 从 storageState JSON 中提取纯 Cookie 数组并保存
 * @returns {{ ok: boolean, path?: string, count: number, error?: string }}
 */
function exportCookiesToJson(profile = DEFAULT_PROFILE) {
  const { storageState, cookieJson } = resolveStatePaths(profile);
  if (!fs.existsSync(storageState)) {
    return { ok: false, error: `状态文件不存在: ${storageState}`, count: 0 };
  }
  try {
    const state = JSON.parse(fs.readFileSync(storageState, 'utf8'));
    const cookies = state?.cookies || [];
    if (!cookies.length) {
      return { ok: false, error: '状态文件中没有 Cookie', count: 0 };
    }
    ensureDir(path.dirname(cookieJson));
    fs.writeFileSync(cookieJson, JSON.stringify(cookies, null, 2), 'utf8');
    return { ok: true, path: cookieJson, count: cookies.length };
  } catch (err) {
    return { ok: false, error: err.message, count: 0 };
  }
}

/**
 * 从纯 Cookie JSON 文件注入到 storageState 中并保存
 * @returns {{ ok: boolean, path?: string, count: number, error?: string }}
 */
function importCookiesFromJson(cookieFile, profile = DEFAULT_PROFILE) {
  const { storageState } = resolveStatePaths(profile);
  if (!fs.existsSync(cookieFile)) {
    return { ok: false, error: `Cookie 文件不存在: ${cookieFile}`, count: 0 };
  }
  try {
    const cookies = JSON.parse(fs.readFileSync(cookieFile, 'utf8'));
    if (!Array.isArray(cookies) || !cookies.length) {
      return { ok: false, error: 'Cookie 文件格式无效，预期为 JSON 数组', count: 0 };
    }

    // 保留现有 state 结构，仅替换 cookies
    let state = {};
    if (fs.existsSync(storageState)) {
      try { state = JSON.parse(fs.readFileSync(storageState, 'utf8')); } catch {}
    }

    state.cookies = cookies;

    ensureDir(path.dirname(storageState));
    fs.writeFileSync(storageState, JSON.stringify(state, null, 2), 'utf8');
    return { ok: true, path: storageState, count: cookies.length };
  } catch (err) {
    return { ok: false, error: err.message, count: 0 };
  }
}

/**
 * 快速有效性预检 — 用已保存的 storageState 快速打开页面并判断是否仍登录
 *
 * 与 ensureLoggedIn 的区别：
 * - 不走轮询等待逻辑（不等待用户扫码）
 * - 不切换登录方式、不截图二维码
 * - 快速超时（默认 25s，足够加载页面 + 检测 DOM）
 * - 适用于批量发布前的一次性快速检查
 *
 * @param {import('playwright').Browser} browser
 * @param {{ profile?: string, timeoutMs?: number, logger?: Console }} options
 * @returns {Promise<{ valid: boolean, reason: string, elapsedMs: number, pageCookies?: Array, error?: string }>}
 */
async function quickValidateSession(browser, options = {}) {
  const {
    profile = DEFAULT_PROFILE,
    timeoutMs = 25000,
    logger = console,
  } = options;

  const { storageState } = resolveStatePaths(profile);
  const startTime = Date.now();

  // 1. 文件级预检
  if (!storageStateExists(profile)) {
    return {
      valid: false,
      reason: 'storageState 文件不存在或为空',
      elapsedMs: Date.now() - startTime,
    };
  }

  let context;
  let page;
  try {
    // 2. 用已有的 storageState 创建隔离上下文（不污染发布流程的 context）
    const chromium = browser.contexts?.() ? null : null;
    context = await browser.newContext({ storageState });

    // 允许在已有 browser 实例上创建新 context
    // 如果 browser 是已连接的 CDP browser，这里的 context 是隔离的

    page = await context.newPage();

    // 3. 快速导航到作家页面
    await page.goto(LOGIN_URL, {
      waitUntil: 'domcontentloaded',
      timeout: Math.min(timeoutMs, 15000),
    }).catch(async (err) => {
      // 导航超时不一定是失败，可能页面部分加载了
      logger.log(`[session:validate] 导航警告: ${err.message}`);
    });

    // 4. 等待页面稳定（让 JS 完成登录态检测/跳转）
    await page.waitForTimeout(3000);

    // 5. 判定登录状态
    const loggedIn = await isLoggedIn(page);
    const elapsedMs = Date.now() - startTime;
    const currentUrl = page.url();

    logger.log(`[session:validate] 检测结果: loggedIn=${loggedIn}, url=${currentUrl?.slice(0, 80)}, elapsed=${elapsedMs}ms`);

    if (loggedIn) {
      return { valid: true, reason: '检测到有效登录态', elapsedMs };
    } else {
      return {
        valid: false,
        reason: currentUrl && /login|passport|auth/i.test(currentUrl)
          ? '无法验证登录态；页面未显示登录入口（可能跳转到了登录页、被重定向、或登录态已过期）。请运行 npm run login 重新登录。'
          : `页面未检测到登录标识；当前 URL: ${currentUrl?.slice(0, 120) || 'unknown'}。请运行 npm run login 重新登录。`,
        elapsedMs,
      };
    }
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    logger.log(`[session:validate] 异常: ${err.message}`);
    return {
      valid: false,
      reason: `会话验证异常: ${err.message}`,
      elapsedMs,
      error: err.message,
    };
  } finally {
    // 清理隔离的 context/page，不干扰主发布流程
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
  }
}

/**
 * 直接在已有 page 上快速验证登录态（复用现有 context，不创建新 context）
 *
 * @param {import('playwright').Page} page
 * @param {{ timeoutMs?: number, logger?: Console }} options
 * @returns {Promise<{ valid: boolean, reason: string, elapsedMs: number }>}
 */
async function quickValidateOnPage(page, options = {}) {
  const { logger = console } = options;
  const startTime = Date.now();

  const currentUrl = page.url();
  if (!currentUrl || currentUrl === 'about:blank') {
    return { valid: false, reason: 'page 尚未导航', elapsedMs: 0 };
  }

  const loggedIn = await isLoggedIn(page);
  const elapsedMs = Date.now() - startTime;

  logger.log(`[session:onpage-check] loggedIn=${loggedIn}, elapsed=${elapsedMs}ms`);

  if (loggedIn) {
    return { valid: true, reason: '检测到有效登录态', elapsedMs };
  } else {
    return {
      valid: false,
      reason: '当前页面未检测到登录标识；可能需要重新登录。',
      elapsedMs,
    };
  }
}

/**
 * 列出可用的 profile
 * @returns {Array<{ profile: string, exists: boolean, cookieCount: number, mtime: string|null }>}
 */
function listProfiles() {
  const profiles = [];
  if (!fs.existsSync(STATE_DIR)) return profiles;

  const files = fs.readdirSync(STATE_DIR);
  for (const f of files) {
    const match = f.match(/^fanqie-storage-state(-(.+))?\.json$/);
    if (!match) continue;
    const profile = match[2] || 'default';
    const fullPath = path.join(STATE_DIR, f);
    let cookieCount = 0;
    let mtime = null;
    try {
      const state = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      cookieCount = (state?.cookies || []).length;
      mtime = fs.statSync(fullPath).mtime.toISOString();
    } catch {}
    profiles.push({ profile, exists: true, cookieCount, mtime });
  }
  return profiles;
}

/**
 * 复制 storageState 到另一个 profile
 */
function copyProfile(fromProfile, toProfile) {
  const from = resolveStatePaths(fromProfile);
  const to = resolveStatePaths(toProfile);
  ensureDir(STATE_DIR);
  if (!fs.existsSync(from.storageState)) {
    return { ok: false, error: `源 profile 不存在: ${fromProfile}` };
  }
  fs.copyFileSync(from.storageState, to.storageState);
  return { ok: true, from: fromProfile, to: toProfile };
}

/**
 * 删除指定 profile 的状态文件
 */
function deleteProfile(profile) {
  const { storageState, qrPng, cookieJson } = resolveStatePaths(profile);
  const deleted = [];
  for (const f of [storageState, qrPng, cookieJson]) {
    if (fs.existsSync(f)) {
      fs.unlinkSync(f);
      deleted.push(f);
    }
  }
  return { ok: true, deleted };
}

/**
 * 从 CDP 浏览器中提取指定域的 cookie（用于 headless 场景准备）
 * 
 * @param {string} cdpUrl - CDP endpoint，如 http://127.0.0.1:9222
 * @param {object} options
 * @param {string[]} [options.domains=['fanqienovel.com']] - 目标域名
 * @param {string} [options.profile='default'] - 存储 profile
 * @param {boolean} [options.autoImport=true] - 提取后自动导入到 storageState
 * @param {Console} [options.logger=console]
 * @returns {Promise<{ ok: boolean, count: number, outputPath?: string, importResult?: object, error?: string }>}
 */
async function extractCookiesFromCDP(cdpUrl, options = {}) {
  const {
    domains = ['fanqienovel.com'],
    profile = DEFAULT_PROFILE,
    autoImport = true,
    logger = console,
  } = options;

  const { cookieJson } = resolveStatePaths(profile);
  const skillRoot = path.resolve(__dirname, '..');
  const outputPath = options.output || cookieJson;

  let playwright;
  try { playwright = require('playwright'); } catch {
    return { ok: false, error: 'Missing dependency: playwright' };
  }

  const { chromium } = playwright;
  let wsUrl = cdpUrl;
  if (cdpUrl.startsWith('http://') || cdpUrl.startsWith('https://')) {
    const jsonUrl = cdpUrl.replace(/\/$/, '') + '/json/version';
    try {
      const res = await fetch(jsonUrl);
      if (!res.ok) return { ok: false, error: `CDP endpoint 不可达: ${jsonUrl} => ${res.status}` };
      const meta = await res.json();
      wsUrl = meta.webSocketDebuggerUrl;
      if (!wsUrl) return { ok: false, error: 'CDP endpoint 未返回 webSocketDebuggerUrl' };
    } catch (err) {
      return { ok: false, error: `连接 CDP 失败: ${err.message}` };
    }
  }

  let browser;
  try {
    browser = await chromium.connectOverCDP(wsUrl);
  } catch (err) {
    return { ok: false, error: `无法连接 CDP 浏览器: ${err.message}` };
  }

  try {
    const context = browser.contexts()[0];
    if (!context) return { ok: false, error: '浏览器中没有开启的 context' };

    const pages = context.pages();
    const page = pages.length ? pages[0] : await context.newPage();

    let allCookies = [];

    // 方法1: CDP Network.getCookies
    try {
      const cdpSession = await context.newCDPSession(page);
      for (const domain of domains) {
        for (const url of [`https://${domain}`, `https://www.${domain}`]) {
          try {
            const result = await cdpSession.send('Network.getCookies', { urls: [url] });
            if (result?.cookies?.length) {
              allCookies.push(...result.cookies);
            }
          } catch {}
        }
      }
      await cdpSession.detach().catch(() => {});
    } catch (cdpErr) {
      logger?.log?.(`[extract] CDP 方式部分失败: ${cdpErr.message}`);
    }

    // 去重
    const seen = new Set();
    const deduped = [];
    for (const c of allCookies) {
      const key = `${c.name}@${c.domain}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({
        name: c.name,
        value: c.value,
        domain: c.domain || '.fanqienovel.com',
        path: c.path || '/',
        expires: c.expires || -1,
        httpOnly: c.httpOnly || false,
        secure: c.secure || false,
        sameSite: c.sameSite || 'Lax',
      });
    }

    // 方法2: 兜底 Playwright API
    if (!deduped.length) {
      try {
        const pc = await context.cookies();
        for (const c of pc) {
          if (domains.some((d) => c.domain?.includes(d))) {
            deduped.push({
              name: c.name,
              value: c.value,
              domain: c.domain,
              path: c.path,
              expires: c.expires,
              httpOnly: c.httpOnly,
              secure: c.secure,
              sameSite: c.sameSite,
            });
          }
        }
      } catch {}
    }

    if (!deduped.length) {
      return { ok: false, error: '未提取到任何 cookie。请确认浏览器已登录 fanqienovel.com。', count: 0 };
    }

    // 保存 cookie JSON
    ensureDir(path.dirname(outputPath));
    fs.writeFileSync(outputPath, JSON.stringify(deduped, null, 2), 'utf8');
    logger?.log?.(`[extract] 已保存 ${deduped.length} 个 cookie 到: ${outputPath}`);

    let importResult = null;
    if (autoImport) {
      importResult = importCookiesFromJson(outputPath, profile);
    }

    if (pages.length === 0 && page) await page.close().catch(() => {});

    return { ok: true, count: deduped.length, outputPath, importResult };
  } finally {
    await browser.close().catch(() => {});
  }
}

// ----- CLI 入口 -----
if (require.main === module) {
  (async () => {
    const args = {};
    for (let i = 2; i < process.argv.length; i++) {
      const key = process.argv[i];
      const next = process.argv[i + 1];
      if (key.startsWith('--')) {
        if (!next || next.startsWith('--')) args[key.slice(2)] = true;
        else { args[key.slice(2)] = next; i++; }
      }
    }

    const command = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : (args.help ? 'help' : null);
    const profile = args.profile || DEFAULT_PROFILE;

    if (command === 'export-cookies') {
      const result = exportCookiesToJson(profile);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === 'extract-cookies') {
      const cdpUrl = args.cdp;
      if (!cdpUrl) {
        console.error('需要 --cdp 参数指定 CDP endpoint');
        process.exit(1);
      }
      const result = await extractCookiesFromCDP(cdpUrl, { profile, logger: console });
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exit(1);
      return;
    }

    if (command === 'import-cookies') {
      const cookieFile = args.file || args.cookie;
      if (!cookieFile) {
        console.error('需要 --file 或 --cookie 参数指定 Cookie JSON 文件');
        process.exit(1);
      }
      const result = importCookiesFromJson(cookieFile, profile);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === 'list') {
      const profiles = listProfiles();
      console.log(JSON.stringify(profiles, null, 2));
      return;
    }

    if (command === 'copy') {
      const from = args.from;
      const to = args.to || args.profile;
      if (!from || !to) {
        console.error('需要 --from 和 --to 参数');
        process.exit(1);
      }
      const result = copyProfile(from, to);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === 'delete') {
      if (profile === DEFAULT_PROFILE && !args.force) {
        console.error('删除 default profile 需要 --force 确认');
        process.exit(1);
      }
      const result = deleteProfile(profile);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (command === 'validate' || command === 'check') {
      if (!args.cdp) {
        // 离线模式：仅检查文件存在性和基本结构
        if (!storageStateExists(profile)) {
          console.log(JSON.stringify({ valid: false, reason: 'storageState 文件不存在或为空', profile }));
          process.exit(1);
        }
        console.log(JSON.stringify({ valid: null, reason: '离线检查通过（文件存在且包含 Cookie），运行时检测需要 --cdp 参数', profile }));
        return;
      }

      // 在线模式：通过 CDP 连接浏览器做运行时验证
      let playwright;
      try { playwright = require('playwright'); } catch {
        console.error('Missing dependency: playwright');
        process.exit(1);
      }

      let cdpUrl = args.cdp;
      if (cdpUrl.startsWith('http://') || cdpUrl.startsWith('https://')) {
        const jsonUrl = cdpUrl.replace(/\/$/, '') + '/json/version';
        const res = await fetch(jsonUrl);
        if (!res.ok) throw new Error(`无法连接 DevTools: ${res.status}`);
        const meta = await res.json();
        cdpUrl = meta.webSocketDebuggerUrl || cdpUrl;
      }

      const { chromium } = playwright;
      const browser = await chromium.connectOverCDP(cdpUrl);
      const result = await quickValidateSession(browser, { profile });
      console.log(JSON.stringify(result, null, 2));
      await browser.close().catch(() => {});
      if (!result.valid) process.exit(1);
      return;
    }

    // help
    console.log(`session-manager 用法:
  node scripts/session_manager.js export-cookies [--profile <name>]
  node scripts/session_manager.js import-cookies --file <cookie.json> [--profile <name>]
  node scripts/session_manager.js extract-cookies --cdp <url> [--profile <name>]  # 从 CDP 浏览器实时提取
  node scripts/session_manager.js list
  node scripts/session_manager.js copy --from <src> --to <dst>
  node scripts/session_manager.js delete [--profile <name>] [--force]
  node scripts/session_manager.js validate [--cdp <url>] [--profile <name>]
  node scripts/session_manager.js check   # 同 validate`);
  })();
}

module.exports = {
  DEFAULT_PROFILE,
  resolveStatePaths,
  storageStateExists,
  exportCookiesToJson,
  importCookiesFromJson,
  quickValidateSession,
  quickValidateOnPage,
  listProfiles,
  copyProfile,
  deleteProfile,
  extractCookiesFromCDP,
  STATE_DIR,
};
