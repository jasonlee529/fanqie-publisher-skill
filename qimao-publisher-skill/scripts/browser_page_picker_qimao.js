#!/usr/bin/env node

// 七猫作者后台 URL 模式
const QIMAO_WRITER_URL_RE = /^https?:\/\/(?:www\.)?zuozhe\.qimao\.com\/front\//i;
const QIMAO_URL_RE = /^https?:\/\/(?:www\.)?(?:zuozhe\.)?qimao\.com\//i;
const BROWSER_INTERNAL_URL_RE = /^(about:blank|chrome:|devtools:|edge:)/i;

function toMatcher(pattern) {
  if (pattern instanceof RegExp) return (url) => pattern.test(url);
  if (typeof pattern === 'string' && pattern) return (url) => url.includes(pattern);
  return () => false;
}

// 章节管理页：/front/book/{bookId}/chapter
const CHAPTER_MANAGE_RE = /\/front\/book\/\d+\/chapter(?:\b|\/|$)/i;
// 章节编辑页：/front/book/{bookId}/chapter/edit
const CHAPTER_EDIT_RE = /\/front\/book\/\d+\/chapter\/edit/i;
// 作品列表页：/front/book/list
const BOOK_LIST_RE = /\/front\/book\/list/i;

/**
 * 给单个页面打分，按分数排序后选出最合适的标签页
 * 评分优先级：章节编辑 > 章节管理 > 作品列表 > 七猫作者后台 > 七猫域名
 */
function scorePage(page, matchers, index) {
  const url = page.url() || '';
  if (!url || BROWSER_INTERNAL_URL_RE.test(url)) {
    return { page, url, index, score: -1000 + index };
  }

  let score = index;
  // 用户指定的优先 URL 模式加分
  if (matchers.some((matches) => matches(url))) score += 500;

  // 七猫后台内部页面加分（按业务优先级）
  if (CHAPTER_EDIT_RE.test(url)) score += 350;
  else if (CHAPTER_MANAGE_RE.test(url)) score += 320;
  else if (BOOK_LIST_RE.test(url)) score += 160;
  // 注册/登录页降权，避免选中无效会话页
  else if (/\/front\/register-login\//i.test(url)) score -= 250;

  // 域名加分
  if (QIMAO_WRITER_URL_RE.test(url)) score += 200;
  else if (QIMAO_URL_RE.test(url)) score += 100;
  else if (/^https?:\/\//i.test(url)) score += 10;

  return { page, url, index, score };
}

/**
 * 从浏览器上下文中选择最合适的页面标签
 *
 * @param {import('playwright').BrowserContext} context
 * @param {Object} [options]
 * @param {Array<string|RegExp>} [options.preferredUrlPatterns=[]] - 额外优先匹配的 URL 模式
 * @param {boolean} [options.createIfMissing=true]             - 无可用页面时是否新建
 * @param {boolean} [options.collapseQimaoWriterTabs=false]    - 是否关闭多余的七猫后台标签
 * @returns {Promise<{page: import('playwright').Page|null, reusedExistingPage: boolean, pageUrl: string}>}
 */
async function resolvePage(context, options = {}) {
  const {
    preferredUrlPatterns = [],
    createIfMissing = true,
    collapseQimaoWriterTabs = false,
  } = options;

  const matchers = preferredUrlPatterns.map(toMatcher);
  const pages = context.pages();
  const ranked = pages
    .map((page, index) => scorePage(page, matchers, index))
    .sort((a, b) => b.score - a.score || b.index - a.index);

  const best = ranked[0];
  if (best && best.score > -100) {
    if (collapseQimaoWriterTabs) {
      for (const item of ranked) {
        if (item.page === best.page) continue;
        if (!isQimaoWriterPage(item.url)) continue;
        await item.page.close({ runBeforeUnload: true }).catch(() => {});
      }
    }
    await best.page.bringToFront().catch(() => {});
    return {
      page: best.page,
      reusedExistingPage: true,
      pageUrl: best.url,
    };
  }

  if (!createIfMissing) return { page: null, reusedExistingPage: false, pageUrl: '' };

  const page = await context.newPage();
  if (collapseQimaoWriterTabs) {
    for (const other of context.pages()) {
      if (other === page) continue;
      const url = other.url() || '';
      if (!isQimaoWriterPage(url)) continue;
      await other.close({ runBeforeUnload: true }).catch(() => {});
    }
  }
  await page.bringToFront().catch(() => {});
  return {
    page,
    reusedExistingPage: false,
    pageUrl: page.url() || '',
  };
}

/**
 * 判断 URL 是否为七猫作者后台页面
 * @param {string} url
 * @returns {boolean}
 */
function isQimaoWriterPage(url) {
  return QIMAO_WRITER_URL_RE.test(url || '');
}

module.exports = {
  resolvePage,
  isQimaoWriterPage,
  QIMAO_WRITER_URL_RE,
  QIMAO_URL_RE,
};
