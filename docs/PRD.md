
> 参考 [Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的思路：本机 CDP 注入、不改官方安装包、一键可还原。本文档给出 Claude Desktop（macOS 优先，Windows 同构）的对应技术方案。

---

## 0. 定位与非目标

**是什么**：一个运行在用户本机的换肤/注入工具，通过 Chrome DevTools Protocol (CDP) 连接到 Claude Desktop 正在运行的实例，对其 WebContents 做运行时 CSS/JS 注入。

**不是什么**：
- 不修改 `Claude.app` / `app.asar` / 代码签名
- 不拦截、不记录、不转发任何网络请求或会话数据（严格限定在 `Page` / `CSS` / `DOM` 域，不碰 `Network` / `Fetch` 域）
- 不修改模型行为、系统提示词或输出内容——纯视觉层
- 非官方项目，出问题不代表 Anthropic 支持范围，安装前建议自己看一遍源码

这几条是整个方案的红线，也是跟"汉化补丁"划清界限的地方：汉化补丁需要替换文案（涉及更多 DOM 遍历和字符串替换），换肤只需要一层 CSS，风险面小得多。

---

## 1. 技术可行性依据

Electron 应用默认可以通过命令行参数开启远程调试：

```bash
/Applications/Claude.app/Contents/MacOS/Claude --remote-debugging-port=9222
```

开启后 `http://127.0.0.1:9222/json/list` 会列出所有可调试的 target（每个 BrowserWindow / WebContents / iframe 一个 target）。这一点已经在实践中验证过——不管是通用的 CDP 自动化博客，还是 `claude-desktop_win-zh_cn` 项目里那个 CDP 注入脚本，走的都是这条路。

已知的关键事实（来自 `claude-desktop-bin` 主题模块的逆向记录，可以直接复用，省掉自己抓变量的功夫）：

- 应用通过 `webContents.insertCSS()` 风格的机制加载样式，UI 依赖一套 CSS 自定义属性：`--bg-000`、`--bg-100`、`--text-000`、`--claude-background-color`、`--claude-foreground-color` 等
- 消息正文/标题字体走 `font-claude-response-body` / `font-claude-response-title` 这两个 class
- 深色/浅色切换靠给 `<body>` 加 `.darkTheme` class 触发，纯 CSS 变量覆盖不了所有面——有些地方是硬编码色值（如 `#faf9f5`），需要 `customCss` 兜底覆盖
- 聊天区域实际渲染在一个嵌套 iframe 里：`https://a.claude.ai/isolated-segment.html`——这个 iframe 大概率有独立的 CSP，需要单独 attach 并 bypass

---

## 2. 架构分层

```
┌─────────────────────────────────────────────┐
│  Launcher（shell / .command）                │
│  - 检测/关闭已运行的 Claude 进程                │
│  - 用 --remote-debugging-port 重新拉起          │
│  - 轮询 CDP 端口就绪                            │
└───────────────────┬─────────────────────────┘
                     │
┌───────────────────▼─────────────────────────┐
│  Injector（Node.js，长驻进程）                  │
│  - 连接 CDP，枚举 target                        │
│  - Target.setAutoAttach 自动跟踪新窗口/子 frame  │
│  - 对每个 target：bypass CSP → 注入运行时脚本     │
└───────────────────┬─────────────────────────┘
                     │
┌───────────────────▼─────────────────────────┐
│  Skin Runtime（注入到页面里的 JS）               │
│  - 创建/更新 <style> 节点                       │
│  - MutationObserver 防止被 SPA 重渲染冲掉        │
│  - 监听本地配置变化，支持免重启切换主题             │
└───────────────────┬─────────────────────────┘
                     │
┌───────────────────▼─────────────────────────┐
│  Theme 定义（JSON manifest + CSS）              │
│  - 变量层 + customCss 兜底层，继承 default        │
└─────────────────────────────────────────────┘
```

---

## 3. 关键技术难点与实现

### 3.1 多窗口 / 多 iframe 追踪

Claude Desktop 有 Chat / Cowork / Code 三个 tab，Cowork 还会起独立的虚拟机相关窗口，聊天区域又嵌了一层 `isolated-segment.html`。不能只抓首个 target 就完事，要用 CDP 的自动附加机制：

```js
import CDP from 'chrome-remote-interface';

async function attachAll(port) {
  const client = await CDP({ port });
  const { Target } = client;

  await Target.setAutoAttach({
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,      // 让子 frame/OOPIF 也走同一条会话
  });

  Target.attachedToTarget(async ({ sessionId, targetInfo }) => {
    if (targetInfo.type !== 'page' && targetInfo.type !== 'iframe') return;
    await injectSkin(client, sessionId, targetInfo.url);
  });
}
```

`flatten: true` 是关键——它让所有子 target 的协议消息都通过同一个 WebSocket 会话路由，不用为每个 iframe 单独开连接。

### 3.2 绕过 CSP

`a.claude.ai` 的 iframe 大概率带 CSP，直接用页面自己的 `document.createElement('style')` 有可能被拦。CDP 提供了协议层的绕过手段，不依赖页面本身放行：

```js
async function injectSkin(client, sessionId, url) {
  const { Page, Runtime } = client;

  await Page.setBypassCSP({ enable: true }, sessionId);

  // 立即应用到当前已加载的文档
  await Runtime.evaluate({
    expression: SKIN_RUNTIME_SRC,
    contextId: undefined,
  }, sessionId);

  // 注册到"每次导航后都自动跑一遍"，应对 SPA 内部刷新/重连
  await Page.addScriptToEvaluateOnNewDocument({
    source: SKIN_RUNTIME_SRC,
  }, sessionId);
}
```

`Page.setBypassCSP` 是专门为这种场景设计的 CDP 能力，效果等同于"以调试器身份注入，不受页面自身安全策略约束"。

### 3.3 注入内容本身要抗重渲染

Claude Desktop 前端是 SPA，路由切换、消息流式渲染都可能重建 DOM。`<style>` 标签本身不会被路由切换删除（它挂在 `<head>` 而不是路由容器里），但保险起见还是加个 MutationObserver 防御式重挂载：

```js
const SKIN_RUNTIME_SRC = `
(function() {
  const STYLE_ID = '__claude_dream_skin__';

  function applyTheme(cssText) {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = cssText;
  }

  // 首次应用（主题内容由 Injector 通过 Runtime.evaluate 二次下发）
  window.__applyDreamSkinTheme = applyTheme;

  // 防止 head 被整体替换导致样式丢失
  new MutationObserver(() => {
    if (!document.getElementById(STYLE_ID) && window.__currentSkinCss) {
      applyTheme(window.__currentSkinCss);
    }
  }).observe(document.head, { childList: true });
})();
`;
```

主题切换时，Injector 只需要再发一条 `Runtime.evaluate('window.__applyDreamSkinTheme(`...`)')`，不用重新走一遍完整注入流程。

### 3.4 应用自动更新后的重连

Claude Desktop 会自动更新并重启进程，Injector 需要能感知进程消失/重新出现：

```js
import { execSync } from 'child_process';

function watchProcess(port) {
  setInterval(async () => {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`);
    } catch {
      // CDP 端口连不上了，说明进程重启过，且新进程没带 --remote-debugging-port
      console.log('[dream-skin] Claude 重启了，需要用 Launcher 重新拉起');
      // 可选：这里触发系统通知，提醒用户重新运行 launcher
    }
  }, 5000);
}
```

比较省心的做法是不追求"无缝跟随更新"，而是让 Launcher 脚本本身兼具"看门狗"角色：用户始终通过这个脚本启动 Claude，脚本内部处理好"先关旧进程、带调试端口重开、等 CDP 就绪、拉起 Injector"的完整生命周期。

---

## 4. Theme Manifest 设计

沿用 `claude-desktop-bin` 已经验证过的变量体系，加一层 `customCss` 兜底（处理硬编码色值），结构做成可继承：

```jsonc
// skins/nord.json
{
  "name": "Nord",
  "extends": "default",        // 继承默认值，只需声明差异部分
  "variables": {
    "--bg-000": "220 17% 20%",
    "--bg-100": "220 17% 18%",
    "--text-000": "219 28% 88%",
    "--claude-background-color": "#2E3440",
    "--claude-foreground-color": "#D8DEE9"
  },
  "customCss": [
    ".font-claude-response-body { font-family: 'JetBrains Mono', monospace; }",
    "/* 硬编码色值兜底，覆盖顺序在 variables 之后 */",
    "[style*='#faf9f5'] { background-color: var(--claude-background-color) !important; }"
  ],
  "loadingSpinner": "assets/nord-spinner.svg"
}
```

配套一个"变量提取脚本"，在真机上跑一次即可拿到当前版本 Claude Desktop 用到的全量 CSS 自定义属性，避免手动漏项：

```js
// tools/extract-vars.js —— 通过 CDP 在目标页面里跑
const dump = getComputedStyle(document.documentElement);
const claudeVars = [...dump].filter(name => name.startsWith('--'));
console.log(JSON.stringify(claudeVars, null, 2));
```

每次 Claude Desktop 大版本更新后重跑一遍，diff 一下变量是否有增减，这是这类项目最容易腐烂的地方（Codex Dream Skin、claude-desktop-bin 都提到过这个维护成本）。

---

## 5. 目录结构建议

照抄 Codex Dream Skin 的分层方式，跨平台但共享 Injector 逻辑：

```
claude-dream-skin/
├── macos/
│   ├── Install Claude Dream Skin.command   # 双击安装
│   └── launcher.sh                          # 关旧进程→带端口拉起→启动 injector
├── windows/
│   ├── install-dream-skin.ps1
│   └── start-dream-skin.ps1
├── injector/                                 # 跨平台共享
│   ├── index.js                              # CDP 连接 + target 追踪
│   ├── skin-runtime.js                       # 注入进页面的运行时
│   └── extract-vars.js                       # 变量提取工具
├── skins/
│   ├── default.json
│   ├── nord.json
│   ├── catppuccin-mocha.json
│   └── ...
├── docs/
│   └── PROJECT.md
└── README.md
```

---

## 6. 安全边界（写进 README，参考 Codex Dream Skin 的表述）

- CDP 只绑定 `127.0.0.1`，运行期间不要在同一台机器上跑来路不明的本机程序（任何进程都能连上这个端口）
- 不修改官方安装目录、二进制、代码签名
- 不做网络层拦截/篡改，`Network`/`Fetch` CDP 域全程不用
- 主题切换与账号、API Key、模型供应商配置完全独立，工具不读取、不写入这些内容
- 关闭工具、走正常方式重新打开 Claude Desktop，即可完全回到官方原状

---

## 7. 分阶段实施路线图

| 阶段 | 目标 | 产出 |
|---|---|---|
| P0 | 验证可行性 | 手动 `--remote-debugging-port` 启动 + `extract-vars.js` 跑一遍，确认能拿到完整变量表 |
| P1 | MVP | Launcher + Injector，硬编码单一主题，验证 CSP bypass 和多 target 注入都生效 |
| P2 | 主题系统 | Theme manifest + 继承机制，做 3-5 套主题打样 |
| P3 | 免重启切换 | 本地小型 HTTP/WS 服务 + 一个轻量浮层 UI（同样通过注入实现），点击即切换并写回配置文件 |
| P4 | 稳定性 | 进程看门狗、CDP 断连自动提示、版本更新后的变量 diff 脚本 |
| P5 | Windows 支持 | 复用 injector/，只换 launcher 里的可执行文件路径和参数拼接方式 |

---

## 8. 可直接参考/复用的现有项目

- `patrickjaja/claude-desktop-bin` 的 `themes/` 目录——变量体系和 `customCss` 分层继承的设计直接可以抄
- `javaht/claude-desktop-zh-cn`、`Jyy1529/claude-desktop_win-zh_cn`——已经把"CDP 连接 + 目标发现 + 注入 + 备份可还原"这套安装脚本工程化了，脚手架可以直接借用，把"替换文案"逻辑换成"应用主题"逻辑
- `chrome-remote-interface`（npm）——比手搓 WebSocket 协议省事很多，本文档的代码示例都基于它