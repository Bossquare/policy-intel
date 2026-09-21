#!/usr/bin/env node
'use strict';
/**
 * 无头渲染导出 DOM（Edge/Chrome + CDP，零依赖）。
 *
 * 给静态抓不到的 JS 渲染 / 异步加载站点兜底：用本机浏览器渲染完成后，
 * 把 outerHTML 落盘，交给 collect.py 走**同一套**解析逻辑。
 *
 * 用法：
 *   node agent/render.js --urls /tmp/urls.json --out /tmp/rendered
 *
 * 参数：
 *   --urls     JSON 文件，[{"key":"zzj_zcwj","url":"https://..."}, ...]
 *   --out      输出目录，每个 key 落一个 <key>.html
 *   --port     调试端口（默认 9333）
 *   --browser  浏览器可执行文件（默认按候选列表探测）
 *   --settle   加载完成后再等多少毫秒（默认 2500，等异步列表渲染完）
 *   --timeout  单个 URL 的超时毫秒（默认 30000）
 *
 * 输出：stdout 最后一行以 `RENDER_RESULT ` 开头的 JSON 摘要，供 collect.py 解析。
 *
 * 浏览器生命周期由本脚本自己管：启动时记下 child.pid，结束时对**该 pid**发信号，
 * 不使用 pkill / pgrep 这类宽泛匹配（本机企业微信也带 remote-debugging-port，
 * 宽匹配会误伤）。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const opt = {
  port: 9333,
  settle: 2500,
  timeout: 30000,
  out: '',
  urls: '',
  browser: '',
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  if (a === '--urls') opt.urls = next();
  else if (a === '--out') opt.out = next();
  else if (a === '--port') opt.port = Number(next());
  else if (a === '--browser') opt.browser = next();
  else if (a === '--settle') opt.settle = Number(next());
  else if (a === '--timeout') opt.timeout = Number(next());
  else if (a === '--help' || a === '-h') {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    process.exit(0);
  }
}

const BROWSERS = [
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];

function findBrowser() {
  if (opt.browser) return fs.existsSync(opt.browser) ? opt.browser : '';
  return BROWSERS.find((p) => fs.existsSync(p)) || '';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 极简 CDP 客户端 ---------- */
class CDP {
  constructor(ws, timeout) {
    this.ws = ws;
    this.timeout = timeout || 15000;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method && this.handlers.has(msg.method)) {
        for (const h of this.handlers.get(msg.method)) h(msg.params);
      }
    });
    ws.addEventListener('close', () => this.rejectAll(new Error('CDP 连接已断开')));
    ws.addEventListener('error', () => this.rejectAll(new Error('CDP 连接出错')));
  }
  rejectAll(err) {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} 超时（${this.timeout} ms）`));
      }, this.timeout);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }
  /** 等一个事件；超时不抛错，返回 null —— 页面 load 事件对某些站点可能不发。 */
  onceOrNull(method, ms) {
    return new Promise((resolve) => {
      const cb = (p) => {
        clearTimeout(timer);
        this.handlers.set(method, (this.handlers.get(method) || []).filter((x) => x !== cb));
        resolve(p);
      };
      const timer = setTimeout(() => {
        this.handlers.set(method, (this.handlers.get(method) || []).filter((x) => x !== cb));
        resolve(null);
      }, ms);
      if (!this.handlers.has(method)) this.handlers.set(method, []);
      this.handlers.get(method).push(cb);
    });
  }
}

async function waitForCdp(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return true;
    } catch (_) { /* 还没起来 */ }
    await sleep(300);
  }
  return false;
}

async function main() {
  if (!opt.urls || !opt.out) throw new Error('缺少 --urls 或 --out');
  const jobs = JSON.parse(fs.readFileSync(opt.urls, 'utf8'));
  if (!jobs.length) {
    console.log('RENDER_RESULT ' + JSON.stringify({ ok: [], failed: [], skipped: 'no-jobs' }));
    return;
  }
  fs.mkdirSync(opt.out, { recursive: true });

  const browser = findBrowser();
  if (!browser) throw new Error('未找到 Edge / Chrome，无法渲染');

  const udd = path.join(os.tmpdir(), `edge-render-${process.pid}`);
  let child = null;
  const summary = { ok: [], failed: [] };

  try {
    child = spawn(browser, [
      '--headless=new',
      '--no-sandbox',                       // Chrome 自身沙箱在本环境无法初始化，必需
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-crash-reporter',
      '--disable-breakpad',
      // 绕过系统代理：本机装了代理（aTrust 等），浏览器默认走系统代理设置，
      // 国内政务站点会被代理拦成 ERR_CONNECTION_CLOSED；直连才正常（与 curl --noproxy 同理）。
      '--no-proxy-server',
      '--disable-quic',                     // 部分政务网关对 QUIC/UDP 443 直接断连
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${udd}`,
      `--remote-debugging-port=${opt.port}`,
      '--window-size=1440,1200',
      'about:blank',
    ], { stdio: 'ignore' });

    if (!(await waitForCdp(opt.port, 20000))) {
      throw new Error(`浏览器 20s 内未就绪（端口 ${opt.port}）`);
    }

    const list = await (await fetch(`http://127.0.0.1:${opt.port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (!page) throw new Error('未找到页面 target');

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((ok, bad) => {
      ws.addEventListener('open', ok);
      ws.addEventListener('error', bad);
    });
    const cdp = new CDP(ws, opt.timeout);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    for (const job of jobs) {
      const label = `${job.key}`.padEnd(22).slice(0, 22);
      try {
        const loaded = cdp.onceOrNull('Page.loadEventFired', opt.timeout);
        await cdp.send('Page.navigate', { url: job.url });
        const ev = await loaded;
        await sleep(opt.settle);      // 等异步列表渲染落定
        const r = await cdp.send('Runtime.evaluate', {
          expression: 'document.documentElement.outerHTML',
          returnByValue: true,
        });
        const html = (r && r.result && r.result.value) || '';
        if (!html || html.length < 200) throw new Error(`DOM 过短（${html.length} 字节）`);
        const file = path.join(opt.out, `${job.key}.html`);
        fs.writeFileSync(file, html, 'utf8');
        summary.ok.push({ key: job.key, bytes: Buffer.byteLength(html), file });
        console.log(`  ✓ ${label} ${Buffer.byteLength(html)} B${ev ? '' : '（未收到 load 事件，按 settle 等待后取值）'}`);
      } catch (e) {
        summary.failed.push({ key: job.key, error: e.message });
        console.log(`  ✗ ${label} ${e.message}`);
      }
    }

    ws.close();
  } finally {
    // 只对自己拉起的进程发信号；再等它退出，最后清临时 profile
    if (child && child.pid) {
      try { process.kill(child.pid, 'SIGTERM'); } catch (_) { /* 已退出 */ }
      for (let i = 0; i < 30 && child.exitCode === null; i++) await sleep(100);
      if (child.exitCode === null) {
        try { process.kill(child.pid, 'SIGKILL'); } catch (_) { /* 忽略 */ }
      }
    }
    try { fs.rmSync(udd, { recursive: true, force: true }); } catch (_) { /* 忽略 */ }
  }

  console.log('RENDER_RESULT ' + JSON.stringify(summary));
}

main().catch((e) => {
  console.error('渲染失败：', e.message);
  console.log('RENDER_RESULT ' + JSON.stringify({ ok: [], failed: [], fatal: e.message }));
  process.exit(1);
});
