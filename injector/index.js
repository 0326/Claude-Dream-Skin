#!/usr/bin/env node
// Claude Dream Skin — Injector 主程序(长驻进程)
//
// 流程:连接 CDP → Target.setAutoAttach 跟踪所有窗口/iframe →
//       对每个 target: bypass CSP → 注入 skin-runtime → 下发主题 CSS。
// 另外:监听 config.json / skins/ 变化实现免重启切换;CDP 断连后自动重连(看门狗)。
//
// 用法:
//   node injector/index.js [--port 9222] [--theme nord]
//   node injector/index.js --set-theme nord     # 写入 config.json 后退出(运行中的 injector 会热加载)
//   node injector/index.js --list               # 列出可用主题
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDPClient } from './cdp.js';
import { loadTheme, compileCss, listThemes } from './themes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const SKINS_DIR = path.join(ROOT, 'skins');
const RUNTIME_SRC = fs.readFileSync(path.join(__dirname, 'skin-runtime.js'), 'utf8');

// 只注入这几类 target;service worker / worker 等不碰
const INJECTABLE_TYPES = new Set(['page', 'iframe', 'webview']);

const log = (...args) => console.log('[dream-skin]', ...args);

// ---------- 配置 ----------

function loadConfig() {
  const defaults = { port: 9222, theme: 'default' };
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
  } catch {
    return defaults;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--port': args.port = Number(argv[++i]); break;
      case '--theme': args.theme = argv[++i]; break;
      case '--set-theme': args.setTheme = argv[++i]; break;
      case '--list': args.list = true; break;
      default: throw new Error(`未知参数: ${argv[i]}`);
    }
  }
  return args;
}

// ---------- 注入 ----------

/** 运行时 + 立即应用当前主题,拼成一段可直接 evaluate 的脚本 */
function buildSource(css, mode) {
  return `${RUNTIME_SRC}\n;window.__applyDreamSkinTheme(${JSON.stringify(css)}, ${JSON.stringify(mode)});`;
}

async function injectIntoSession(client, sessionId, targetInfo, state) {
  // setAutoAttach 和显式 attachToTarget 可能对同一 target 各触发一次事件,按 targetId 去重
  if (state.attachedTargets.has(targetInfo.targetId)) return;
  state.attachedTargets.add(targetInfo.targetId);

  // Page.enable 是前提:没有它,addScriptToEvaluateOnNewDocument 不会在后续导航中触发
  await client.send('Page.enable', {}, sessionId);
  await client.send('Page.setBypassCSP', { enabled: true }, sessionId);

  // runImmediately 覆盖当前文档 + 之后每次导航;老版本 Electron 不支持该字段时由下面的 evaluate 兜底
  const { identifier } = await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: state.source,
    runImmediately: true,
  }, sessionId);

  await client.send('Runtime.evaluate', {
    expression: state.source,
    returnByValue: true,
  }, sessionId).catch(() => { /* 页面还没有执行上下文时忽略,addScript 会兜住 */ });

  // 级联自动附加:让该页面下的 OOPIF(如 a.claude.ai/isolated-segment.html)也走同一条会话
  await client.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  }, sessionId).catch(() => { /* 部分 target 类型不支持,忽略 */ });

  state.sessions.set(sessionId, { targetInfo, identifier });
  log(`已注入 [${targetInfo.type}] ${targetInfo.url || '(无 URL)'}`);
}

/** 热切换:更新所有已附加会话的常驻脚本,并立即应用新 CSS */
async function pushTheme(client, state) {
  for (const [sessionId, session] of state.sessions) {
    try {
      await client.send('Page.removeScriptToEvaluateOnNewDocument', {
        identifier: session.identifier,
      }, sessionId);
      const { identifier } = await client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: state.source,
        runImmediately: false,
      }, sessionId);
      session.identifier = identifier;

      await client.send('Runtime.evaluate', {
        expression: `window.__applyDreamSkinTheme && window.__applyDreamSkinTheme(${JSON.stringify(state.css)}, ${JSON.stringify(state.mode)});`,
        returnByValue: true,
      }, sessionId);
    } catch (err) {
      log(`会话 ${sessionId.slice(0, 8)}… 更新失败(可能已关闭): ${err.message}`);
    }
  }
}

/** 一次完整的连接生命周期:连上 → 注入所有 target → 等待断连 */
async function runSession(port, state) {
  const client = await CDPClient.connect(port);
  state.client = client;
  state.sessions = new Map();
  state.attachedTargets = new Set();

  client.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
    if (!INJECTABLE_TYPES.has(targetInfo.type)) return;
    injectIntoSession(client, sessionId, targetInfo, state)
      .catch((err) => log(`注入失败 (${targetInfo.url}): ${err.message}`));
  });
  client.on('Target.detachedFromTarget', ({ sessionId }) => {
    const session = state.sessions.get(sessionId);
    if (session) state.attachedTargets.delete(session.targetInfo.targetId);
    state.sessions.delete(sessionId);
  });

  await client.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });

  // setAutoAttach 只管之后新建的 target,已存在的窗口要手动附加一遍
  const { targetInfos } = await client.send('Target.getTargets');
  for (const info of targetInfos) {
    if (!INJECTABLE_TYPES.has(info.type)) continue;
    await client.send('Target.attachToTarget', { targetId: info.targetId, flatten: true })
      .catch((err) => log(`附加 ${info.url} 失败: ${err.message}`));
  }

  log(`已连接 CDP(端口 ${port}),当前跟踪 ${state.sessions.size} 个 target,主题: ${state.themeName}`);
  await client.closed;
  state.client = null;
  state.sessions = new Map();
  state.attachedTargets = new Set();
}

// ---------- 免重启切换:监听配置与主题文件 ----------

function applyThemeToState(state, themeId) {
  const theme = loadTheme(themeId, SKINS_DIR);
  state.themeId = themeId;
  state.themeName = theme.name;
  state.mode = theme.mode;
  state.css = compileCss(theme);
  state.source = buildSource(state.css, state.mode);
}

function watchForChanges(state) {
  let timer = null;
  const reload = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const themeId = loadConfig().theme;
      try {
        applyThemeToState(state, themeId);
        log(`主题已切换 → ${state.themeName}`);
        if (state.client) await pushTheme(state.client, state);
      } catch (err) {
        log(`主题重载失败: ${err.message}`);
      }
    }, 200); // 编辑器保存往往触发多次 fs 事件,去抖
  };

  try { fs.watch(CONFIG_PATH, reload); } catch { /* config.json 可能尚不存在 */ }
  try { fs.watch(SKINS_DIR, reload); } catch { /* skins 目录缺失时忽略 */ }
}

// ---------- 看门狗 ----------

function notifyRestartNeeded() {
  const message = 'Claude 已重启且未带调试端口,请重新运行 launcher 以恢复主题';
  log(message);
  if (process.platform === 'darwin') {
    execFile('osascript', ['-e',
      `display notification "${message}" with title "Claude Dream Skin"`,
    ], () => { /* 通知失败不影响主流程 */ });
  }
}

async function portReady(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- 入口 ----------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.list) {
    for (const id of listThemes(SKINS_DIR)) console.log(id);
    return;
  }

  if (args.setTheme) {
    loadTheme(args.setTheme, SKINS_DIR); // 先校验主题存在且可解析
    const config = { ...loadConfig(), theme: args.setTheme };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
    log(`config.json 已更新,theme = ${args.setTheme}(运行中的 injector 会自动热加载)`);
    return;
  }

  const config = loadConfig();
  const port = args.port ?? config.port;
  const state = { client: null, sessions: new Map() };
  applyThemeToState(state, args.theme ?? config.theme);
  watchForChanges(state);

  let notified = false;
  for (;;) {
    if (await portReady(port)) {
      notified = false;
      try {
        await runSession(port, state);
        log('CDP 连接断开(Claude 退出或重启),等待端口恢复…');
      } catch (err) {
        log(`CDP 会话异常: ${err.message}`);
      }
      // 断连后给应用一点重启时间,若新进程没带调试端口则提醒一次
      await sleep(3000);
      if (!(await portReady(port)) && !notified) {
        notifyRestartNeeded();
        notified = true;
      }
    } else {
      await sleep(3000);
    }
  }
}

main().catch((err) => {
  console.error('[dream-skin] 致命错误:', err.message);
  process.exit(1);
});
