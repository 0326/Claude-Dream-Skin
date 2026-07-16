// 注入到 Claude Desktop 每个页面/iframe 里的运行时。
// 本文件整体作为字符串通过 CDP 注入执行,不走模块系统。
//
// 职责:
//   1. 维护一个 <style id="__claude_dream_skin__"> 节点承载主题 CSS
//   2. MutationObserver 防御 SPA 重渲染把样式冲掉
//   3. 暴露 window.__applyDreamSkinTheme(css, mode) 供 Injector 热切换主题
(() => {
  'use strict';
  const STYLE_ID = '__claude_dream_skin__';

  // 幂等保护:重复注入时复用已安装的运行时(Injector 会另行调用 __applyDreamSkinTheme)
  if (window.__applyDreamSkinTheme) return;

  let currentCss = '';
  let currentMode = null; // 'dark' | 'light' | null(跟随应用自身)
  let observer = null;

  function ensureStyle() {
    const host = document.head || document.documentElement;
    if (!host) return null;
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      host.appendChild(el);
    } else if (el.parentNode !== host) {
      // head 被整体替换过,把样式节点挂回去
      host.appendChild(el);
    }
    return el;
  }

  // 深色/浅色由 <body> 上的 .darkTheme class 触发(见 PRD §1)。
  // 注意:classList.add 在 class 已存在时仍会重写属性并触发 mutation,
  // 必须先比对再改,否则会和下面的 MutationObserver 形成微任务死循环。
  function applyMode() {
    const body = document.body;
    if (!body || !currentMode) return;
    const wantDark = currentMode === 'dark';
    if (body.classList.contains('darkTheme') !== wantDark) {
      body.classList.toggle('darkTheme', wantDark);
    }
  }

  function reapply() {
    const el = ensureStyle();
    if (el && el.textContent !== currentCss) el.textContent = currentCss;
    applyMode();
  }

  function installObservers() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(reapply);
    if (document.documentElement) observer.observe(document.documentElement, { childList: true });
    if (document.head) observer.observe(document.head, { childList: true });
    if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  }

  window.__applyDreamSkinTheme = (css, mode) => {
    currentCss = typeof css === 'string' ? css : '';
    currentMode = mode || null;
    reapply();
    installObservers();
  };

  // 脚本在 document-start 注入时 head/body 可能还不存在,DOM 就绪后补一次
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      reapply();
      installObservers();
    }, { once: true });
  }
})();
