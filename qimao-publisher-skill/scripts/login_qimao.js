#!/usr/bin/env node
/**
 * login_qimao.js — 七猫作者后台登录入口脚本
 *
 * 使用方式：
 *   node scripts/login_qimao.js --cdp http://127.0.0.1:9222
 *   node scripts/login_qimao.js --cdp http://127.0.0.1:9222 --profile <name>
 *
 * 流程：
 * 1. 通过 CDP 连接已打开的浏览器
 * 2. 复用或新建七猫作者后台标签页
 * 3. 导航到七猫登录页
 * 4. 调用 ensureLoggedIn 等待用户手动完成登录（手机验证码 / 账号密码）
 * 5. 登录成功后保存 storageState（含 cookie），供后续 headless 发布使用
 *
 * 七猫不使用扫码登录，因此无需二维码相关逻辑。
 * 用户需在浏览器中手动完成登录操作（含勾选"同意协议"复选框）。
 */

const fs = require('fs');
const path = require('path');
const { LOGIN_URL, ensureLoggedIn } = require('./qimao_login_flow');
const { resolvePage, isQimaoWriterPage } = require('./browser_page_picker_qimao');

const DEFAULT_PROFILE = 'default';
const STATE_DIR = path.resolve(__dirname, '..', 'state');

/**
 * 解析命令行参数
 * 支持 --cdp <url> 与 --profile <name>，以及 --fresh-context 布尔标志
 */
function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key.startsWith('--')) {
      if (!next || next.startsWith('--')) args[key.slice(2)] = true;
      else {
        args[key.slice(2)] = next;
        i += 1;
      }
    }
  }
  return args;
}

/**
 * 根据 profile 名称解析 storageState 文件路径
 * - default → state/qimao-storage-state.json
 * - <name>  → state/qimao-storage-state-<name>.json
 */
function resolveStatePath(profile = DEFAULT_PROFILE) {
  return profile === DEFAULT_PROFILE
    ? path.join(STATE_DIR, 'qimao-storage-state.json')
    : path.join(STATE_DIR, `qimao-storage-state-${profile}.json`);
}

/**
 * 从已保存的 storageState 中提取 Cookie 统计信息并打印
 * 用于登录后确认 cookie 数量与即将过期的 cookie
 */
function logCookieSummary(statePath) {
  try {
    if (!fs.existsSync(statePath)) return;
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const cookies = state?.cookies || [];
    if (!cookies.length) return;
    console.log(`Cookie 统计: 共 ${cookies.length} 个 Cookie`);
    const now = Date.now() / 1000;
    const expiringSoon = cookies.filter((c) => c.expires > 0 && c.expires - now < 86400);
    if (expiringSoon.length) {
      console.log(`⚠ ${expiringSoon.length} 个 Cookie 将在 24 小时内过期`);
    }
  } catch {}
}

async function main() {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (err) {
    console.error('Missing dependency: playwright');
    console.error('Install with: npm i -D playwright  OR  npm i -g playwright');
    process.exit(1);
  }

  const args = parseArgs(process.argv);
  const profile = args.profile || DEFAULT_PROFILE;
  const cdpUrl = args.cdp;
  const loginUrl = LOGIN_URL;

  const statePath = resolveStatePath(profile);
  fs.mkdirSync(path.dirname(statePath), { recursive: true });

  if (profile !== DEFAULT_PROFILE) {
    console.log(`使用 profile: ${profile}`);
  }

  const { chromium } = playwright;
  let browser;
  let context;
  let launchedBrowser = false;

  // CDP 模式：连接已有浏览器
  if (cdpUrl) {
    try {
      // 将 HTTP 形式的 CDP endpoint 解析为 WebSocket URL
      let wsUrl = cdpUrl;
      if (cdpUrl.startsWith('http://') || cdpUrl.startsWith('https://')) {
        const jsonUrl = cdpUrl.replace(/\/$/, '') + '/json/version';
        const res = await fetch(jsonUrl);
        if (!res.ok) throw new Error(`无法查询 DevTools endpoint: ${jsonUrl} => ${res.status}`);
        const meta = await res.json();
        wsUrl = meta.webSocketDebuggerUrl || cdpUrl;
      }
      browser = await chromium.connectOverCDP(wsUrl);
      context = args['fresh-context']
        ? await browser.newContext()
        : (browser.contexts()[0] || await browser.newContext());
      console.log(`已通过 CDP 连接浏览器: ${cdpUrl}`);
    } catch (err) {
      console.log(`CDP 连接失败（${err.message}），回退到自动启动浏览器模式...`);
      browser = null;
    }
  }

  // Launch 模式：自动启动浏览器
  // 禁用 crashpad 和一些 sandbox 相关特性，避免关闭时报 restricted 错误
  if (!browser) {
    browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-crash-reporter',
        '--disable-breakpad',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
    context = await browser.newContext();
    launchedBrowser = true;
    console.log('已自动启动浏览器（launch 模式）');
  }
  console.log('DEBUG: before resolvePage');
  const { page, reusedExistingPage } = await resolvePage(context, {
    preferredUrlPatterns: [
      LOGIN_URL,
      /https?:\/\/(?:www\.|zuozhe\.)?qimao\.com\/front\//i,
      /https?:\/\/(?:www\.|zuozhe\.)?qimao\.com\//i,
    ],
  });
  console.log(`DEBUG: after resolvePage reused=${reusedExistingPage} url=${page.url() || 'about:blank'}`);

  // 如当前页面不在七猫域名下，导航到登录页
  if (!isQimaoWriterPage(page.url())) {
    console.log('DEBUG: before goto');
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    console.log('DEBUG: after goto');
  }
  console.log(`已连接浏览器: ${cdpUrl}`);

  // 调用登录流程模块，等待用户手动完成登录
  const loginResult = await ensureLoggedIn(page, {
    loginUrl,
    logger: console,
    saveStorageState: async () => {
      await context.storageState({ path: statePath });
      console.log(`已保存登录态: ${statePath}`);
      logCookieSummary(statePath);
    },
  });

  if (!loginResult.loggedIn) {
    console.error('等待七猫登录超时。');
    console.error('LOGIN_TIMEOUT');
    if (!reusedExistingPage) await page.close().catch(() => {});
    await browser.close().catch(() => {});
    process.exit(2);
  }

  if (loginResult.alreadyLoggedIn) {
    // 已登录场景：刷新保存一次 storageState
    await context.storageState({ path: statePath });
    logCookieSummary(statePath);
    console.log(`检测到当前会话已登录，已刷新保存登录态: ${statePath}`);
    console.log('LOGIN_ALREADY_OK');
  } else {
    logCookieSummary(statePath);
    console.log('LOGIN_OK');
  }

  // 业务成功后主动退出，避免 browser.close() 在 sandbox 中触发 Crashpad/SavedState 限制
  try {
    if (!reusedExistingPage) await page.close().catch(() => {});
    if (launchedBrowser) {
      // launch 模式下直接退出进程，由系统回收浏览器进程
      process.exit(0);
    }
    await browser.close().catch(() => {});
  } catch {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
