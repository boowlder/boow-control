// Pilote Chrome (CDP) de la recette. Il ouvre le cockpit dans le Chrome de la
// machine (chrome-cdp.service, port 9222), clique et lit ce qui est VRAIMENT à
// l'écran. C'est ce pilote qui a attrapé, pendant l'audit du 22/07/2026, tous
// les bugs que le typecheck ne voyait pas.

const CDP = process.env.BOOW_CDP ?? 'http://127.0.0.1:9222';

let ws;
let id = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

export async function connect(url) {
  const r = await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const tab = await r.json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error('Chrome CDP injoignable — chrome-cdp.service tourne-t-il ?'));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  return tab.id;
}

export async function close(tabId) {
  try {
    await fetch(`${CDP}/json/close/${tabId}`);
  } catch {
    /* déjà fermé */
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(`${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
  }
  return r.result.value;
}

/** Clique le premier élément cliquable dont le texte contient `text`. */
export async function clickText(text) {
  const ok = await evaluate(`(() => {
    const els = [...document.querySelectorAll('button, [role="tab"], [role="menuitem"], a, [role="switch"]')];
    const el = els.find(e => e.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
    if (!el) return false;
    el.click();
    return true;
  })()`);
  if (!ok) throw new Error(`introuvable à l'écran : « ${text} »`);
}

export async function type(text) {
  await send('Input.insertText', { text });
}
