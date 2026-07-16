#!/usr/bin/env node
// 变量提取工具(PRD §4 / P0):在正在运行的 Claude Desktop 里跑一遍,
// 导出当前版本用到的全量 CSS 自定义属性及其计算值。
// 每次 Claude 大版本更新后重跑并 diff,即可发现变量增减。
//
// 用法:先用 launcher(或手动 --remote-debugging-port=9222)启动 Claude,然后:
//   node injector/extract-vars.js [--port 9222] > vars.json
import { CDPClient } from './cdp.js';

const port = (() => {
  const i = process.argv.indexOf('--port');
  return i === -1 ? 9222 : Number(process.argv[i + 1]);
})();

// 在页面里执行:styleSheets 里声明过的 + 计算样式里可枚举的自定义属性,取并集
const EXTRACT_EXPR = `(() => {
  const names = new Set();

  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.style) {
        for (const prop of rule.style) if (prop.startsWith('--')) names.add(prop);
      }
      if (rule.cssRules) walk(rule.cssRules);
    }
  };
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules); } catch { /* 跨源样式表读不了,跳过 */ }
  }

  const computed = getComputedStyle(document.documentElement);
  for (const prop of computed) if (prop.startsWith('--')) names.add(prop);

  const out = {};
  for (const name of [...names].sort()) {
    out[name] = computed.getPropertyValue(name).trim();
  }
  return JSON.stringify(out, null, 2);
})()`;

const client = await CDPClient.connect(port).catch((err) => {
  console.error(`连不上 CDP(端口 ${port}): ${err.message}`);
  console.error('请先用 launcher 启动 Claude,或手动带 --remote-debugging-port 启动。');
  process.exit(1);
});

const { targetInfos } = await client.send('Target.getTargets');
const pages = targetInfos.filter((t) => t.type === 'page' && !t.url.startsWith('devtools://'));
if (pages.length === 0) {
  console.error('没有找到可用的 page target。');
  process.exit(1);
}
// 优先挑 claude 域名的主窗口
const target = pages.find((t) => t.url.includes('claude')) ?? pages[0];
console.error(`提取自: ${target.url}`);

const { sessionId } = await client.send('Target.attachToTarget', {
  targetId: target.targetId,
  flatten: true,
});
const { result } = await client.send('Runtime.evaluate', {
  expression: EXTRACT_EXPR,
  returnByValue: true,
}, sessionId);

console.log(result.value);
client.close();
