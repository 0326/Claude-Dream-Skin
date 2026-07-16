# Claude Dream Skin

English | [简体中文](README.md)

A theming tool for Claude Desktop. It connects to a running Claude Desktop instance via the Chrome DevTools Protocol (CDP) and performs **runtime CSS injection** on its pages. It never touches the official installer — quit the tool and reopen Claude normally to fully revert.

## How it works

```
launcher (shell) ── quits the old process, relaunches Claude with --remote-debugging-port
      │
injector (long-lived Node) ── connects to 127.0.0.1:9222, tracks every window/iframe via Target.setAutoAttach
      │                        (including the chat area's nested a.claude.ai/isolated-segment.html)
      │                        for each target: Page.setBypassCSP → inject skin-runtime
      │
skin-runtime (in-page) ── maintains a <style> node + a MutationObserver that survives SPA re-renders
      │
skins/*.json ── theme definitions: a CSS-variable layer + a customCss fallback layer, with extends inheritance
```

## Requirements

- Node.js >= 22 (zero npm dependencies, no `npm install` needed)
- Official Claude Desktop (installed at `/Applications/Claude.app` on macOS, `%LOCALAPPDATA%\AnthropicClaude` on Windows)

## Quick start

### macOS

Double-click `macos/Install Claude Dream Skin.command` and follow the prompts (checks dependencies → generates config → launches Claude with the skin applied).

Or from the command line:

```bash
bash macos/launcher.sh
```

### Windows

Run the install script in PowerShell, then launch via the desktop shortcut it creates:

```powershell
powershell -ExecutionPolicy Bypass -File windows\install-dream-skin.ps1
```

## Everyday use

**Launch**: always start Claude through the launcher (double-click the `.command` on macOS / the desktop shortcut on Windows) and the theme stays applied. The launcher handles the full sequence for you: quit the old process → relaunch with the debug port → wait for CDP to be ready → start the injector.

**Revert**: press `Ctrl+C` in the launcher terminal to stop the injector, then open Claude Desktop the normal way — it returns to its stock state with nothing left behind.

**Switch themes (no restart)**:

```bash
node injector/index.js --list              # list all themes
node injector/index.js --set-theme dracula # writes config.json; the running injector hot-reloads within seconds
```

You can also edit the `theme` field in [config.json](config.json) directly, or modify the `skins/*.json` files themselves — both are file-watched and take effect on save, without restarting Claude.

Built-in themes: `default` (stock look) / `nord` / `catppuccin-mocha` / `dracula` / `solarized-light`.

## Custom themes

Create a new `my-theme.json` under `skins/`:

```json
{
  "name": "My Theme",
  "extends": "nord",
  "mode": "dark",
  "variables": { "--bg-100": "220 16% 10%" },
  "customCss": [".font-claude-response-body { font-family: 'JetBrains Mono', monospace; }"]
}
```

- `variables`: overrides Claude's CSS custom properties (`--bg-*` / `--text-*` / `--accent-*` etc. are HSL triplets; `--claude-*` are color values)
- `customCss`: the fallback layer for hardcoded color values and anything the variables can't reach; applied after the variable layer
- `mode`: `"dark"` / `"light"` / `null` — controls the app's own light/dark base via the `.darkTheme` class on `body`
- `extends`: inherit from any existing theme and declare only the differences

After a major Claude Desktop update, run the variable-extraction tool and diff the output to see whether any variables were added or removed:

```bash
node injector/extract-vars.js > vars.json
```

## FAQ

**Got a "Claude restarted without the debug port" notification?**
Claude relaunches normally after an auto-update, which drops the CDP port. Just run the launcher once more to restore the theme.

**Some spots have the wrong color after switching themes?**
The app has a few hardcoded color values that variables can't override. Use `extract-vars.js` to find the relevant variable, or add a targeted rule to the theme's `customCss` as a fallback.

**Port 9222 already in use?**
Change `port` in `config.json` and start the launcher with the environment variable: `CLAUDE_DREAM_SKIN_PORT=9223 bash macos/launcher.sh` (same variable name on Windows).

## Safety boundaries

- CDP binds to `127.0.0.1` only; while it's running, don't run untrusted local programs on the same machine (any local process can connect to this debug port)
- Never modifies the official install directory, binaries, or code signature
- No network-layer interception or tampering: only the `Target` / `Page` / `Runtime` CDP domains are used; the `Network` / `Fetch` domains are never touched
- Never reads or writes account, API key, or model-provider settings; never changes model behavior, system prompts, or output — purely a visual layer
- Zero npm dependencies (built on Node's built-in fetch/WebSocket), no supply-chain risk
- Quit the tool and reopen Claude Desktop the normal way to fully return to its stock state

## Project layout

```
├── macos/            # double-click installer + launcher
├── windows/          # equivalent PowerShell scripts
├── injector/         # cross-platform core: CDP client / injector / in-page runtime / variable extraction
├── skins/            # themes: default / nord / catppuccin-mocha / dracula / solarized-light
└── config.json       # current theme and port
```
