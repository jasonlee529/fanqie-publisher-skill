#!/usr/bin/env node
/**
 * extract_cookies.js — 从 GUI 浏览器直接提取 cookie，保存为标准 JSON 文件。
 *
 * 场景：在能扫码登录的图形界面浏览器中登录后，运行此脚本提取 cookie，
 *       将 cookie JSON 传输至无头服务器，通过 import 注入 storageState，
 *       即可在 headless 模式下跳过扫码登录。
 *
 * 用法：
 *   node scripts/extract_cookies.js --cdp http://127.0.0.1:9222
 *   node scripts/extract_cookies.js --cdp http://127.0.0.1:9222 --domain fanqienovel.com --output ./my-cookies.json
 */

const fs = require('fs');
const path = require('path');

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

async function connectCDP(cdpUrl) {
  // 如果传入的是 HTTP endpoint，先解析出 WebSocket URL
  let wsUrl = cdpUrl;
  if (cdpUrl.startsWith('http://') || cdpUrl.startsWith('https://')) {
    const jsonUrl = cdpUrl.replace(/\/$/, '') + '/json/version';
    console.log(`[extract] 查询 DevTools endpoint: ${jsonUrl}`);
    const res = await fetch(jsonUrl);
    if (!res.ok) {
      throw new Error(`无法连接 CDP endpoint: ${jsonUrl} => ${res.status}。请确认 Chrome 已启动，监听端口正确。`);
    }
    const meta = await res.json();
    wsUrl = meta.webSocketDebuggerUrl;
    if (!wsUrl) {
      throw new Error('CDP endpoint 未返回 webSocketDebuggerUrl。请确认 Chrome 已启用远程调试。');
    }
  }

  console.log(`[extract] 连接 CDP WebSocket: ${wsUrl.replace(/\/[^/]+$/, '/****')}`);
  const { chromium } = require('playwright');
  const browser = await chromium.connectOverCDP(wsUrl);
  return browser;
}

/**
 * 从 CDP 会话中提取指定域的所有 cookie
 */
async function extractCookiesViaCDP(browser, domains) {
  const contexts = browser.contexts();
  if (!contexts.length) {
    throw new Error('浏览器中没有任何 context。请确认 Chrome 已打开并已登录番茄小说。');
  }

  const context = contexts[0];
  const pages = context.pages();
  const page = pages.length ? pages[0] : await context.newPage();

  let cookies = [];

  // 方法1：通过 CDP Network.getCookies 获取（最精确）
  try {
    const cdpSession = await page.context().newCDPSession(page);
    for (const domain of domains) {
      const urls = [
        `https://${domain}`,
        `https://www.${domain}`,
        `http://${domain}`,
        `http://www.${domain}`,
      ];

      for (const url of urls) {
        try {
          const result = await cdpSession.send('Network.getCookies', { urls: [url] });
          if (result?.cookies?.length) {
            console.log(`[extract] 从 ${url} 获取到 ${result.cookies.length} 个 cookie`);
            cookies.push(...result.cookies);
          }
        } catch {
          // 某些 URL 可能无法访问
        }
      }
    }
    await cdpSession.detach().catch(() => {});
  } catch (err) {
    console.warn(`[extract] CDP 方式提取失败: ${err.message}，尝试 Playwright API 方式...`);
  }

  // 去重（按 name + domain）
  const seen = new Set();
  const deduped = [];
  for (const c of cookies) {
    const key = `${c.name}@${c.domain}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  // 方法2：兜底使用 Playwright context.cookies() 
  if (!deduped.length) {
    console.log('[extract] CDP 方式未获取到 cookie，尝试 Playwright context API...');
    try {
      const allCookies = await context.cookies();
      // 过滤目标域
      const filtered = allCookies.filter((c) =>
        domains.some((d) => c.domain?.includes(d) || c.domain?.endsWith('.' + d))
      );
      if (filtered.length) {
        console.log(`[extract] Playwright API 获取到 ${filtered.length} 个 cookie`);
        deduped.push(...filtered);
      }
    } catch (err) {
      console.warn(`[extract] Playwright API 方式也失败: ${err.message}`);
    }
  }

  if (page && pages.length === 0) {
    await page.close().catch(() => {});
  }

  return deduped;
}

/**
 * 标准化 cookie 格式，确保与 Playwright storageState 兼容
 */
function normalizeCookies(rawCookies) {
  return rawCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain || 'fanqienovel.com',
    path: c.path || '/',
    expires: c.expires || -1,
    httpOnly: c.httpOnly ?? c.http_only ?? false,
    secure: c.secure ?? false,
    sameSite: c.sameSite || 'Lax',
  }));
}

function summarize(cookies) {
  const now = Date.now() / 1000;
  const expiring = cookies.filter((c) => c.expires > 0 && c.expires - now < 86400 * 7);
  const expired = cookies.filter((c) => c.expires > 0 && c.expires - now < 0);
  const persistent = cookies.filter((c) => c.expires <= 0);
  const valid = cookies.filter((c) => c.expires <= 0 || c.expires > now);

  return {
    total: cookies.length,
    persistent,  // session cookie，不过期
    withExpiry: cookies.length - persistent.length,
    expiringIn7Days: expiring.length,
    alreadyExpired: expired.length,
    validSession: valid.length,
    names: cookies.map((c) => c.name),
    domains: [...new Set(cookies.map((c) => c.domain))],
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const cdpUrl = args.cdp || args.url || 'http://127.0.0.1:9222';
  const domains = (args.domain || 'fanqienovel.com').split(',').map((s) => s.trim()).filter(Boolean);
  const skillRoot = path.resolve(__dirname, '..');
  const defaultOutput = path.join(skillRoot, 'state', 'fanqie-cookies.json');
  const outputPath = args.output || args.out || defaultOutput;

  if (!cdpUrl) {
    console.error('请提供 --cdp 参数指定 Chrome DevTools Protocol 地址');
    console.error('例如: node scripts/extract_cookies.js --cdp http://127.0.0.1:9222');
    process.exit(1);
  }

  console.log(`[extract] 目标域: ${domains.join(', ')}`);
  console.log(`[extract] 输出路径: ${outputPath}`);

  const browser = await connectCDP(cdpUrl);
  console.log('[extract] 已连接到浏览器');

  const rawCookies = await extractCookiesViaCDP(browser, domains);
  const cookies = normalizeCookies(rawCookies);

  await browser.close().catch(() => {});

  if (!cookies.length) {
    console.error('[extract] 未提取到任何 cookie。请确认：');
    console.error('  1. 浏览器中已打开并登录 fanqienovel.com');
    console.error('  2. CDP 端口正确（Chrome 启动参数需包含 --remote-debugging-port=9222）');
    process.exit(1);
  }

  const summary = summarize(cookies);

  // 保存原始 cookie 数组
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(cookies, null, 2), 'utf8');
  console.log(`[extract] 已保存 ${cookies.length} 个 cookie 到: ${outputPath}`);

  // 同时自动导入到 storageState（方便直接使用）
  const { importCookiesFromJson } = require('./session_manager');
  const importResult = importCookiesFromJson(outputPath);
  if (importResult.ok) {
    console.log(`[extract] 已同步注入到 storageState: ${importResult.path} (${importResult.count} cookies)`);
  }

  // 输出摘要
  console.log('\n📊 Cookie 摘要:');
  console.log(`  总数: ${summary.total}`);
  console.log(`  永久(session): ${summary.persistent} 个`);
  console.log(`  有过期时间: ${summary.withExpiry} 个`);
  console.log(`  7天内过期: ${summary.expiringIn7Days} 个`);
  console.log(`  已过期: ${summary.alreadyExpired} 个`);
  console.log(`  当前有效: ${summary.validSession} 个`);
  console.log(`  域名: ${summary.domains.join(', ')}`);
  console.log(`  Cookie 名: ${summary.names.join(', ')}`);

  if (summary.expiringIn7Days > 0) {
    const names = cookies.filter((c) => {
      const now = Date.now() / 1000;
      return c.expires > 0 && c.expires - now < 86400 * 7 && c.expires - now > 0;
    }).map((c) => c.name);
    console.log(`\n⚠ 以下 cookie 将在 7 天内过期，需及时刷新: ${names.join(', ')}`);
  }

  if (summary.alreadyExpired > 0) {
    const names = cookies.filter((c) => c.expires > 0 && c.expires - now < 0).map((c) => c.name);
    console.log(`\n⚠ 以下 cookie 已过期: ${names.join(', ')}`);
  }

  console.log('\n✅ 提取完成。');
  console.log('');
  console.log('使用方式:');
  console.log('  1. 将 cookies.json 传输到无头服务器');
  console.log('  2. 导入: npm run session:import-cookies -- --file cookies.json');
  console.log('  3. 发布(自动跳过扫码): node scripts/publish_fanqie.js --cookie-only --file xxx.md --mode immediate --confirm-publish');
}

main().catch((err) => {
  console.error('[extract] 错误:', err.message);
  process.exit(1);
});
