// 极简 Chrome DevTools Protocol 客户端(flatten 会话模式)。
// 零依赖:基于 Node >= 22 内置的 fetch 与 WebSocket。
//
// 安全边界:只允许连接 127.0.0.1,且本项目全程只使用
// Target / Page / Runtime 三个域,不触碰 Network / Fetch。

export class CDPClient {
  #ws;
  #nextId = 1;
  #pending = new Map(); // key: `${sessionId ?? ''}#${id}` —— flatten 模式下 id 按会话分命名空间
  #listeners = new Map();

  /** 连接到 127.0.0.1:port 的浏览器级 target */
  static async connect(port) {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!res.ok) throw new Error(`CDP 端点响应异常: HTTP ${res.status}`);
    const { webSocketDebuggerUrl } = await res.json();
    if (!webSocketDebuggerUrl) throw new Error('CDP /json/version 未返回 webSocketDebuggerUrl');

    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('CDP WebSocket 连接失败')), { once: true });
    });
    return new CDPClient(ws);
  }

  constructor(ws) {
    this.#ws = ws;
    this.closed = new Promise((resolve) => {
      ws.addEventListener('close', () => {
        for (const { reject, method } of this.#pending.values()) {
          reject(new Error(`CDP 连接已关闭(${method} 未收到响应)`));
        }
        this.#pending.clear();
        resolve();
      }, { once: true });
    });
    ws.addEventListener('message', (ev) => this.#onMessage(ev.data));
  }

  /** 发送协议命令。sessionId 为空时发往浏览器级 target。 */
  send(method, params = {}, sessionId) {
    const id = this.#nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.#ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => {
      this.#pending.set(`${sessionId ?? ''}#${id}`, { resolve, reject, method });
    });
  }

  /** 订阅协议事件。handler(params, sessionId) */
  on(method, handler) {
    if (!this.#listeners.has(method)) this.#listeners.set(method, []);
    this.#listeners.get(method).push(handler);
  }

  close() {
    try { this.#ws.close(); } catch { /* 已关闭 */ }
  }

  #onMessage(data) {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    if (msg.id !== undefined) {
      const key = `${msg.sessionId ?? ''}#${msg.id}`;
      const pending = this.#pending.get(key);
      if (!pending) return;
      this.#pending.delete(key);
      if (msg.error) pending.reject(new Error(`${pending.method} 失败: ${msg.error.message}`));
      else pending.resolve(msg.result);
      return;
    }

    for (const handler of this.#listeners.get(msg.method) ?? []) {
      try { handler(msg.params, msg.sessionId); } catch (err) {
        console.error(`[dream-skin] 事件处理器异常 (${msg.method}):`, err.message);
      }
    }
  }
}
