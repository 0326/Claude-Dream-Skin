# Claude Dream Skin

简体中文 | [English](README.en.md)

Claude Desktop 换肤工具:通过 Chrome DevTools Protocol (CDP) 连接到本机正在运行的 Claude Desktop,对其页面做**运行时 CSS 注入**。不修改官方安装包,关掉工具、正常重开 Claude 即完全还原。

## 工作原理

```
launcher(shell)──关旧进程,带 --remote-debugging-port 重新拉起 Claude
      │
injector(Node 长驻)──连接 127.0.0.1:9222,Target.setAutoAttach 跟踪所有窗口/iframe
      │                (含聊天区嵌套的 a.claude.ai/isolated-segment.html)
      │                对每个 target:Page.setBypassCSP → 注入 skin-runtime
      │
skin-runtime(页面内)──维护 <style> 节点 + MutationObserver 抗 SPA 重渲染
      │
skins/*.json ──主题定义:CSS 变量层 + customCss 兜底层,支持 extends 继承
```

## 环境要求

- Node.js >= 22(零 npm 依赖,无需 `npm install`)
- Claude Desktop 官方版(macOS 装在 `/Applications/Claude.app`,Windows 装在 `%LOCALAPPDATA%\AnthropicClaude`)

## 快速开始

### macOS

双击 `macos/Install Claude Dream Skin.command`,按提示走完即可(检查依赖 → 生成配置 → 启动带皮肤的 Claude)。

或者命令行:

```bash
bash macos/launcher.sh
```

### Windows

PowerShell 运行安装脚本,之后用它创建的桌面快捷方式启动:

```powershell
powershell -ExecutionPolicy Bypass -File windows\install-dream-skin.ps1
```

## 日常使用

**启动**:每次都通过 launcher(macOS 双击 `.command` / Windows 双击桌面快捷方式)启动 Claude,主题即一直生效。launcher 会自动完成「关旧进程 → 带调试端口重开 → 等 CDP 就绪 → 拉起 injector」的完整流程。

**还原**:在 launcher 终端里按 `Ctrl+C` 停掉 injector,然后用正常方式重新打开 Claude Desktop,即完全回到官方原状,无任何残留。

**切换主题(免重启)**:

```bash
node injector/index.js --list              # 列出所有主题
node injector/index.js --set-theme dracula # 写入 config.json,运行中的 injector 秒级热加载
```

也可以直接编辑 [config.json](config.json) 的 `theme` 字段,或改动 `skins/*.json` 本身——两者都被文件监听,保存即生效,不用重启 Claude。

内置主题:`default`(官方原样)/ `nord` / `catppuccin-mocha` / `dracula` / `solarized-light`。

## 自制主题

在 `skins/` 下新建 `my-theme.json`:

```json
{
  "name": "My Theme",
  "extends": "nord",
  "mode": "dark",
  "variables": { "--bg-100": "220 16% 10%" },
  "customCss": [".font-claude-response-body { font-family: 'JetBrains Mono', monospace; }"]
}
```

- `variables`:覆盖 Claude 的 CSS 自定义属性(`--bg-*` / `--text-*` / `--accent-*` 等为 HSL 三元组,`--claude-*` 为色值)
- `customCss`:兜底层,处理硬编码色值等变量够不着的地方,排在变量层之后生效
- `mode`:`"dark"` / `"light"` / `null`,通过 body 的 `.darkTheme` class 控制应用自身的深浅色基调
- `extends`:继承任意现有主题,只声明差异部分

Claude Desktop 大版本更新后,跑一遍变量提取工具并 diff,检查变量有无增减:

```bash
node injector/extract-vars.js > vars.json
```

## 常见问题

**收到「Claude 已重启且未带调试端口」通知?**
Claude 自动更新后会以普通方式重启,CDP 端口就没了。重新运行一次 launcher 即可恢复主题。

**换主题后个别地方颜色不对?**
应用里有少量硬编码色值,变量覆盖不到。用 `extract-vars.js` 找到对应变量,或在主题的 `customCss` 里加针对性规则兜底。

**端口 9222 被占用?**
改 `config.json` 里的 `port`,并用环境变量启动 launcher:`CLAUDE_DREAM_SKIN_PORT=9223 bash macos/launcher.sh`(Windows 同名环境变量)。

## 安全边界

- CDP 只绑定 `127.0.0.1`;运行期间不要在同一台机器上跑来路不明的本机程序(任何本机进程都能连上这个调试端口)
- 不修改官方安装目录、二进制、代码签名
- 不做网络层拦截/篡改:全程只用 `Target` / `Page` / `Runtime` 三个 CDP 域,`Network` / `Fetch` 域完全不碰
- 不读取、不写入账号、API Key、模型配置;不修改模型行为、系统提示词或输出内容——纯视觉层
- 零 npm 依赖(基于 Node 内置 fetch/WebSocket),无供应链风险
- 关闭工具、走正常方式重新打开 Claude Desktop,即可完全回到官方原状

## 目录结构

```
├── macos/            # 双击安装 + launcher
├── windows/          # PowerShell 同构脚本
├── injector/         # 跨平台核心:CDP 客户端 / 注入器 / 页面运行时 / 变量提取
├── skins/            # 主题:default / nord / catppuccin-mocha / dracula / solarized-light
└── config.json       # 当前主题与端口
```
