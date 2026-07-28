#!/usr/bin/env node
/**
 * qimao_login_flow.js — 七猫作者后台登录流程模块
 *
 * 与番茄（fanqie_login_flow.js）的核心差异：
 * 1. 七猫使用手机验证码 / 账号密码登录，不使用扫码，无二维码相关逻辑
 * 2. 登录页 URL：/front/register-login/login
 * 3. 作者后台 URL 前缀：/front/
 * 4. 登录前需用户手动勾选"同意协议"复选框（由用户在浏览器中完成）
 *
 * 导出接口与番茄模块保持一致，便于上层脚本复用相同模式。
 */

const fs = require('fs');

// 七猫作者后台关键 URL
const LOGIN_URL = 'https://zuozhe.qimao.com/front/register-login/login?redirect=%2Ffront%2Findex';
const WRITER_URL = 'https://zuozhe.qimao.com/front/index';

// 登录页 URL 模式（命中说明仍在登录页，未登录）
const LOGIN_URL_RE = /\/front\/register-login\/login/i;
// 作者后台业务页面 URL 模式（命中说明已进入后台）
const WRITER_PAGE_URL_RE = /\/front\/(index|book\/list|book\/\d+\/chapter|book\/\d+\/chapter\/edit)/i;
// 七猫域名匹配（含 zuozhe.qimao.com 与 qimao.com）
const QIMAO_DOMAIN_RE = /^https?:\/\/(?:www\.|zuozhe\.)?qimao\.com\//i;

// 登录页特征文案（出现说明在登录表单上，未登录）
const LOGIN_PAGE_TEXT_RE = /手机号登录|账号密码登录|验证码登录|获取验证码|同意并继续|我已阅读|用户协议|登录并继续/;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function safeText(locator) {
  try {
    return ((await locator.innerText()) || '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

/**
 * 检查七猫作者后台是否已登录
 *
 * 判定逻辑（满足任一即为已登录）：
 * 1. URL 在后台业务页面，且页面上能找到后台元素 / 文案
 * 2. URL 在七猫后台域名下且不在登录页，且 body 文本包含后台特征文案
 *
 * 判定为未登录：
 * - URL 仍在 /register-login/login 登录页
 * - 页面出现登录表单特征文案（且不在后台业务 URL）
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function isLoggedIn(page) {
  const url = page.url() || '';
  const bodyText = await safeText(page.locator('body').first());

  // 1. URL 仍在登录页 → 未登录
  if (LOGIN_URL_RE.test(url)) {
    return false;
  }

  // 2. 出现登录表单文案且未进入后台业务页 → 未登录
  //    （登录成功跳转后，后台页面一般不会再出现"获取验证码/同意协议"等文案）
  if (LOGIN_PAGE_TEXT_RE.test(bodyText) && !WRITER_PAGE_URL_RE.test(url)) {
    // 兜底：如果 URL 不在后台业务页，且文案是登录态，视为未登录
    if (!WRITER_PAGE_URL_RE.test(url)) return false;
  }

  // 3. URL 在后台业务页面 → 检查后台元素 / 文案
  if (WRITER_PAGE_URL_RE.test(url) || (/\/front\//i.test(url) && QIMAO_DOMAIN_RE.test(url) && !LOGIN_URL_RE.test(url))) {
    // 3.1 CSS 元素命中
    const cssHints = page.locator(
      'a[href*="/front/book"], a[href*="/front/chapter"], .book-item, .book-list, .book-card, .qm-book, .book-manage'
    );
    if (await cssHints.count().catch(() => 0)) return true;

    // 3.2 后台文案命中
    const textHints = [
      page.getByText('作品列表', { exact: false }).first(),
      page.getByText('我的作品', { exact: false }).first(),
      page.getByText('新建作品', { exact: false }).first(),
      page.getByText('创建作品', { exact: false }).first(),
      page.getByText('章节管理', { exact: false }).first(),
      page.getByText('作家中心', { exact: false }).first(),
    ];
    for (const hint of textHints) {
      if (await hint.count().catch(() => 0)) return true;
    }

    // 3.3 body 文案兜底
    if (/作品列表|我的作品|新建作品|章节管理|作家中心/.test(bodyText)) {
      return true;
    }
  }

  return false;
}

/**
 * 确保已登录 — 导航到七猫登录页，等待用户手动完成登录
 *
 * 七猫不使用扫码登录，用户需在浏览器中手动完成以下操作：
 *  1. 选择登录方式（手机验证码 / 账号密码）
 *  2. 输入账号信息
 *  3. 勾选"同意协议"复选框
 *  4. 点击登录按钮
 *
 * 登录成功后，七猫会自动跳转到 /front/index。
 * 本函数轮询检测登录状态，登录完成后保存 storageState。
 *
 * @param {import('playwright').Page} page
 * @param {object} [options]
 * @param {string} [options.loginUrl=LOGIN_URL]
 * @param {number} [options.waitAfterOpenMs=2500]   - 打开页面后等待渲染的毫秒数
 * @param {number} [options.pollIntervalMs=3000]     - 登录状态轮询间隔
 * @param {number} [options.timeoutMs=300000]        - 等待登录超时（默认 5 分钟）
 * @param {Function} [options.saveStorageState]      - 登录成功后保存 storageState 回调
 * @param {Console} [options.logger=console]
 * @returns {Promise<{ loggedIn: boolean, alreadyLoggedIn?: boolean, timedOut?: boolean }>}
 */
async function ensureLoggedIn(page, options = {}) {
  const {
    loginUrl = LOGIN_URL,
    logger = console,
    waitAfterOpenMs = 2500,
    pollIntervalMs = 3000,
    timeoutMs = 5 * 60 * 1000,
    saveStorageState,
  } = options;

  // 页面为空时先导航到登录页
  if (!page.url() || page.url() === 'about:blank') {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(waitAfterOpenMs);
  }
  await page.bringToFront().catch(() => {});

  // 快速检测：当前是否已登录
  if (await isLoggedIn(page)) {
    if (typeof saveStorageState === 'function') {
      await saveStorageState();
    }
    return { loggedIn: true, alreadyLoggedIn: true };
  }

  // 未登录且不在登录页 → 导航到登录页，等待用户手动登录
  if (!LOGIN_URL_RE.test(page.url() || '')) {
    logger.log('当前未登录，导航到七猫登录页...');
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(waitAfterOpenMs);
  }

  logger.log('请在浏览器中完成七猫登录（手机验证码或账号密码登录）。');
  logger.log('注意：登录前需勾选"同意协议"复选框，否则登录按钮可能不可点击。');
  logger.log('登录成功后会自动跳转到作家后台首页，脚本将自动检测并保存登录态。');

  // 轮询等待用户完成登录
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(pollIntervalMs);
    if (await isLoggedIn(page)) {
      if (typeof saveStorageState === 'function') {
        await saveStorageState();
      }
      logger.log('检测到七猫登录完成。');
      return { loggedIn: true, alreadyLoggedIn: false };
    }
  }

  return { loggedIn: false, timedOut: true };
}

/**
 * cookieOnlyEnsureLoggedIn — 纯 Cookie 模式登录验证（用于 headless 环境）
 *
 * 与 ensureLoggedIn 的核心区别：
 * - 不走轮询等待逻辑（不等待用户手动登录）
 * - 若 cookie 无效则立即失败返回，不循环等待
 * - 可选：通过 CDP Network.setCookies 强制注入 cookie（解决某些跨域场景）
 *
 * 使用场景：在 GUI 浏览器登录并提取 cookie 后，将 storageState 传输到无头服务器，
 *           通过本函数验证 cookie 是否仍然有效。
 *
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 * @param {object} [options]
 * @param {string} [options.writerUrl=WRITER_URL]  - 验证目标 URL（导航到此页面检测 cookie）
 * @param {string} [options.statePath]             - storageState 文件路径（用于注入 cookie）
 * @param {boolean} [options.forceSetCookies=true] - 是否通过 CDP 强制注入 cookie
 * @param {number} [options.waitAfterOpenMs=2500]  - 导航后等待渲染毫秒数
 * @param {Console} [options.logger=console]
 * @returns {Promise<{ loggedIn: boolean, alreadyLoggedIn?: boolean, reason?: string }>}
 */
async function cookieOnlyEnsureLoggedIn(page, context, options = {}) {
  const {
    writerUrl = WRITER_URL,
    statePath,
    forceSetCookies = true,
    waitAfterOpenMs = 2500,
    logger = console,
  } = options;

  // 1. 如已在七猫后台页面，直接检查登录态
  const currentUrl = page.url() || '';
  if (currentUrl && currentUrl !== 'about:blank') {
    if (await isLoggedIn(page)) {
      logger.log('[cookie-only] 当前页面已检测到有效登录态');
      return { loggedIn: true, alreadyLoggedIn: true };
    }
  }

  // 2. 通过 CDP 强制注入 cookie（headless 常见场景）
  if (forceSetCookies && statePath && fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      const cookies = state?.cookies || [];
      if (cookies.length > 0) {
        // 构建 CDP 兼容的 cookie 格式，默认 domain 落在 .qimao.com
        const cdpCookies = cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.qimao.com',
          path: c.path || '/',
          expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires : undefined,
          httpOnly: c.httpOnly ?? false,
          secure: c.secure ?? false,
          sameSite: c.sameSite || 'Lax',
        }));

        try {
          const cdpSession = await context.newCDPSession(page);
          await cdpSession.send('Network.setCookies', { cookies: cdpCookies });
          await cdpSession.detach().catch(() => {});
          logger.log(`[cookie-only] 通过 CDP 注入了 ${cdpCookies.length} 个 cookie`);
        } catch (cdpErr) {
          // CDP 注入失败不是致命错误，context 在创建时已通过 storageState 加载了 cookie
          logger.log(`[cookie-only] CDP cookie 注入失败（context 已预加载 cookie）: ${cdpErr.message}`);
        }
        logger.log(`[cookie-only] 已从 storageState 加载 ${cookies.length} 个 cookie`);
      } else {
        logger.log('[cookie-only] storageState 中没有 cookie，跳过注入');
      }
    } catch (err) {
      logger.log(`[cookie-only] 读取 storageState 失败: ${err.message}`);
    }
  }

  // 3. 导航到作家后台首页（七猫会自动校验 cookie，无效则重定向到登录页）
  logger.log(`[cookie-only] 导航到: ${writerUrl}`);
  await page.goto(writerUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((err) => {
    logger.log(`[cookie-only] 导航警告: ${err.message}`);
  });
  await page.waitForTimeout(waitAfterOpenMs);

  // 4. 检查登录状态
  const loggedIn = await isLoggedIn(page);
  if (loggedIn) {
    logger.log('[cookie-only] Cookie 认证成功，检测到有效登录态');
    return { loggedIn: true, alreadyLoggedIn: false };
  }

  // 5. 分析失败原因（区分"跳转到登录页"与"其他异常"）
  const url = page.url() || '';
  const bodyText = await page.locator('body').first().innerText().catch(() => '');

  let reason;
  if (LOGIN_URL_RE.test(url)) {
    reason = 'Cookie 已过期或无效，页面跳转到了登录页。请在 GUI 浏览器中重新登录并提取 cookie。';
  } else if (LOGIN_PAGE_TEXT_RE.test(bodyText.slice(0, 500))) {
    reason = 'Cookie 已过期，页面显示了登录入口。请在 GUI 浏览器中重新登录并提取最新 cookie。';
  } else {
    reason = `Cookie 认证后未检测到有效登录态。当前 URL: ${url.slice(0, 120)}。`;
  }

  logger.log(`[cookie-only] 认证失败: ${reason}`);
  return { loggedIn: false, reason };
}

module.exports = {
  LOGIN_URL,
  WRITER_URL,
  ensureDir,
  isLoggedIn,
  ensureLoggedIn,
  cookieOnlyEnsureLoggedIn,
};
