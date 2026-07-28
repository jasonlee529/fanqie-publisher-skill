/**
 * test_editor_input.js — editor_input.js 单元测试（无浏览器）
 *
 * 测试范围：
 * - assertUnicodeFidelity：逐字符对比、中文/Emoji/全角/扩展字/差异检测
 * - resolveDryRunConfig：命令行参数解析
 * - checkSafeStop：安全停止点判断逻辑
 *
 * 运行：node test/test_editor_input.js
 */

const {
  assertUnicodeFidelity,
  resolveDryRunConfig,
  checkSafeStop,
  readEditorContent,
} = require('../scripts/editor_input');

let failures = 0;
let passed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error('❌ FAIL:', message);
    failures++;
  } else {
    console.log('  ✅ PASS:', message);
    passed++;
  }
}

function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error('❌ FAIL:', message);
    console.error('  expected:', expected);
    console.error('  actual:', actual);
    failures++;
  } else {
    console.log('  ✅ PASS:', message);
    passed++;
  }
}

// ============================================================
// 1. assertUnicodeFidelity
// ============================================================

console.log('\n=== assertUnicodeFidelity ===\n');

// 1.1 相同 ASCII
{
  const result = assertUnicodeFidelity('Hello World', 'Hello World');
  assert(result.pass === true, 'identical ASCII');
  assert(result.differences.length === 0, 'no diffs');
}

// 1.2 中文
{
  const input = '番茄发布测试，中文不应乱码。';
  const result = assertUnicodeFidelity(input, input);
  assert(result.pass === true, 'Chinese text match');
}

// 1.3 Emoji + 扩展字
{
  const input = '😀🍅🚀𠮷繁體字測試';
  const result = assertUnicodeFidelity(input, input);
  assert(result.pass === true, 'Emoji + extended Unicode');
}

// 1.4 全角标点
{
  const input = '！？，。；：“”‘’（）【】《》';
  const result = assertUnicodeFidelity(input, input);
  assert(result.pass === true, 'full-width punctuation');
}

// 1.5 检测差异
{
  const result = assertUnicodeFidelity('abc', 'abx');
  assert(result.pass === false, 'detects difference');
  assert(result.differences.length === 1, '1 diff');
  assert(result.differences[0].index === 2, 'idx=2');
  assert(result.differences[0].expected === 'c', 'exp=c');
  assert(result.differences[0].actual === 'x', 'act=x');
}

// 1.6 长度不匹配
{
  const result = assertUnicodeFidelity('abcd', 'abc');
  assert(result.pass === false, 'length mismatch detected');
  assert(result.inputLength === 4, 'inLen=4');
  assert(result.readBackLength === 3, 'rbLen=3');
}

// 1.7 多行
{
  const input = '第一行：中文\n第二行：全角标点！\n第三行：Emoji 😀';
  const result = assertUnicodeFidelity(input, input);
  assert(result.pass === true, 'multiline match');
}

// 1.8 扩展字 𠮷 (U+20BB7)
{
  const input = '𠮷';
  const result = assertUnicodeFidelity(input, input);
  assert(result.pass === true, 'extended char 𠮷');
  assert(input.length === 2, '𠮷 is 2 UTF-16 code units');
}

// 1.9 完整回归样本（103 chars）
{
  const input = '第一行：番茄发布测试，中文不应乱码。\n第二行：全角标点！？，。；：“”‘’（）【】《》\n第三行：Emoji 😀🍅🚀，扩展字𠮷，繁體字測試。\n\n末行包含 ASCII: OpenAI-2026 / 12345.';
  const result = assertUnicodeFidelity(input, input);
  assert(result.pass === true, 'full fixture 103 chars');
}

// 1.10 空串
{
  const result = assertUnicodeFidelity('', '');
  assert(result.pass === true, 'empty strings');
}

// 1.11 数字
{
  const result = assertUnicodeFidelity('12345 67890 001', '12345 67890 001');
  assert(result.pass === true, 'numbers');
}

// 1.12 多字符差异报告不超过20
{
  const result = assertUnicodeFidelity('abcdefghijklmnopqrstuvwxyz', 'xxxxxxxxxxxxxxxxxxxxxxxxxx');
  assert(result.pass === false, 'many diffs');
  assert(result.differences.length <= 20, 'max 20 diffs reported');
}

// ============================================================
// 2. resolveDryRunConfig
// ============================================================

console.log('\n=== resolveDryRunConfig ===\n');

// 2.1 默认
{
  const r = resolveDryRunConfig({});
  assert(r.isDryRun === false, 'default not dry-run');
  assert(r.shouldStop === false, 'default no stop');
  assert(r.safeStop === null, 'default safeStop=null');
}

// 2.2 dry-run flag
{
  const r = resolveDryRunConfig({ 'dry-run': true });
  assert(r.isDryRun === true, 'dry-run true');
  assert(r.safeStop === 'before-save', 'dry-run → before-save');
  assert(r.shouldStop === true, 'dry-run shouldStop');
}

// 2.3 显式 safe-stop
{
  const r = resolveDryRunConfig({ 'safe-stop': 'after-fill' });
  assert(r.isDryRun === false, 'safe-stop not dry-run');
  assert(r.safeStop === 'after-fill', 'safe-stop=after-fill');
  assert(r.shouldStop === true, 'shouldStop');
}

// 2.4 无效 safe-stop
{
  const r = resolveDryRunConfig({ 'safe-stop': 'invalid-value' });
  assert(r.shouldStop === false, 'invalid safe-stop rejected');
  assert(r.safeStop === null, 'invalid → null');
}

// 2.5 全部有效 stop 值
{
  for (const stop of ['before-fill', 'after-fill', 'before-save', 'before-publish']) {
    const r = resolveDryRunConfig({ 'safe-stop': stop });
    assert(r.shouldStop === true, `valid stop: ${stop}`);
    assert(r.safeStop === stop, `preserves: ${stop}`);
  }
}

// 2.6 dry-run + 显式 safe-stop 覆盖
{
  const r = resolveDryRunConfig({ 'dry-run': true, 'safe-stop': 'after-fill' });
  assert(r.isDryRun === true, 'combined: isDryRun');
  assert(r.safeStop === 'after-fill', 'combined: explicit stop wins');
}

// 2.7 字符串 'true'
{
  const r = resolveDryRunConfig({ 'dry-run': 'true' });
  assert(r.isDryRun === true, 'string "true"');
}

// 2.8 字符串 '1'
{
  const r = resolveDryRunConfig({ 'dry-run': '1' });
  assert(r.isDryRun === true, 'string "1"');
}

// ============================================================
// 3. checkSafeStop
// ============================================================

console.log('\n=== checkSafeStop ===\n');

// 3.1 无停止配置 → 不中断
{
  const config = resolveDryRunConfig({});
  const result = checkSafeStop('after-fill', config);
  assert(result.shouldBreak === false, 'no config → no break');
}

// 3.2 before-fill 停止点
{
  const config = resolveDryRunConfig({ 'safe-stop': 'before-fill' });
  const r1 = checkSafeStop('before-fill', config);
  assert(r1.shouldBreak === true, 'before-fill → break at before-fill');
  assert(r1.message.includes('[dry-run]'), 'message has [dry-run]');

  const r2 = checkSafeStop('after-fill', config);
  assert(r2.shouldBreak === true, 'before-fill → break at after-fill');
}

// 3.3 after-fill 停止点
{
  const config = resolveDryRunConfig({ 'safe-stop': 'after-fill' });
  const r1 = checkSafeStop('before-fill', config);
  assert(r1.shouldBreak === false, 'after-fill → no break at before-fill');

  const r2 = checkSafeStop('after-fill', config);
  assert(r2.shouldBreak === true, 'after-fill → break at after-fill');

  const r3 = checkSafeStop('before-save', config);
  assert(r3.shouldBreak === true, 'after-fill → break at before-save');
}

// 3.4 before-save 停止点（dry-run 默认）
{
  const config = resolveDryRunConfig({ 'dry-run': true });
  const r1 = checkSafeStop('after-fill', config);
  assert(r1.shouldBreak === false, 'before-save → no break at after-fill');

  const r2 = checkSafeStop('before-save', config);
  assert(r2.shouldBreak === true, 'before-save → break at before-save');
}

// 3.5 未知点 → 不中断
{
  const config = resolveDryRunConfig({ 'safe-stop': 'after-fill' });
  const result = checkSafeStop('unknown-point', config);
  assert(result.shouldBreak === false, 'unknown point → no break');
}

// ============================================================
// 4. readEditorContent（番茄新版占位 widget 过滤）
// ============================================================

async function testReadEditorContent() {
  console.log('\n=== readEditorContent ===\n');

  let decorationsRemoved = false;
  const decoration = { remove() { decorationsRemoved = true; } };
  const paragraphs = [
    { get textContent() { return `${decorationsRemoved ? '' : '请输入正文'}番茄中文输入测试：你好，世界！`; } },
    { textContent: '第二行：繁體字、Emoji 😀🍅、扩展字𠮷。' },
  ];
  const clone = {
    querySelectorAll(selector) {
      if (selector === '.ProseMirror-widget, .syl-placeholder, [contenteditable="false"]') return [decoration];
      if (selector === 'p') return paragraphs;
      return [];
    },
    textContent: 'fallback should not be used',
  };
  const locator = {
    async evaluate(callback) {
      return callback({ cloneNode: () => clone });
    },
  };

  const actual = await readEditorContent(locator);
  const expected = '番茄中文输入测试：你好，世界！\n第二行：繁體字、Emoji 😀🍅、扩展字𠮷。';
  assert(decorationsRemoved, 'removes ProseMirror placeholder/widget nodes from clone');
  assert(actual === expected, 'reads Chinese/Emoji/extension characters without placeholder prefix');
}

// ============================================================
// Summary
// ============================================================
(async () => {
  try {
    await testReadEditorContent();
  } catch (err) {
    console.error('❌ FAIL: readEditorContent threw:', err);
    failures++;
  }
  console.log(`\n=== Summary: ${passed} passed, ${failures} failed ===\n`);
  process.exit(failures > 0 ? 1 : 0);
})();
