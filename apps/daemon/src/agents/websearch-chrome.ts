import { config } from '../config';
import type { SearchHit } from './websearch';

// Recherche web via le vrai Chrome que boow fait déjà tourner (chrome-cdp,
// port 9222). Gratuite, sans clé ni carte. La subtilité : DuckDuckGo bloque les
// requêtes qui « sentent le robot ». On masque donc les marqueurs
// d'automatisation (navigator.webdriver…) AVANT le chargement de la page —
// vérifié le 24/07/2026 : 10 résultats par requête, stable sur plusieurs
// requêtes d'affilée, ~4 s chacune.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const FURTIF = `
  Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
  window.chrome = { runtime: {} };
  Object.defineProperty(navigator,'languages',{get:()=>['fr-FR','fr','en-US']});
  Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});
`;

interface CDP {
  send: (method: string, params?: unknown) => Promise<any>;
  fermer: () => Promise<void>;
}

/** Ouvre un onglet Chrome piloté, prêt à naviguer, avec un délai de sécurité. */
async function ouvrirOnglet(): Promise<CDP> {
  const base = config.endpoints.chromeCdp;
  const r = await fetch(`${base}/json/new?about:blank`, {
    method: 'PUT',
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`Chrome CDP HTTP ${r.status}`);
  const tab = (await r.json()) as { id: string; webSocketDebuggerUrl: string };

  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  let id = 0;
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('Chrome CDP injoignable')), { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(String((ev as MessageEvent).data));
    const p = m.id && pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
    }
  });

  const send = (method: string, params: unknown = {}) =>
    new Promise<any>((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  const fermer = async () => {
    try {
      ws.close();
    } catch {
      /* déjà fermé */
    }
    try {
      await fetch(`${base}/json/close/${tab.id}`, { signal: AbortSignal.timeout(3000) });
    } catch {
      /* onglet déjà parti */
    }
  };

  return { send, fermer };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chromeSearch(query: string, max = 5): Promise<SearchHit[]> {
  const cdp = await ouvrirOnglet();
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: FURTIF });
    await cdp.send('Network.setUserAgentOverride', { userAgent: UA, acceptLanguage: 'fr-FR,fr;q=0.9' });
    await cdp.send('Page.navigate', { url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` });
    await sleep(3500); // le temps que les résultats s'affichent

    const r = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        if (/challenge|bots use|anomaly|unusual traffic/i.test(document.body.innerText)) return { bloque: true };
        // DuckDuckGo enrobe chaque lien dans une redirection de suivi
        // (duckduckgo.com/l/?uddg=<vraie url>). On la déballe pour rendre
        // l'adresse réelle, pas ce pavé illisible.
        const vraie = (href) => {
          try {
            if (/duckduckgo\\.com\\/l\\//.test(href)) {
              const u = new URL(href, location.origin).searchParams.get('uddg');
              if (u) return decodeURIComponent(u);
            }
          } catch (e) {}
          return href;
        };
        const out = [];
        for (const el of document.querySelectorAll('.result__body')) {
          // On saute les PUBS (résultats sponsorisés) : ce ne sont pas de vrais
          // résultats, et leurs liens sont des redirections publicitaires.
          if (el.closest('.result--ad, .result--sponsored')) continue;
          const a = el.querySelector('.result__a');
          if (!a) continue;
          const url = vraie(a.href);
          // Un lien qui pointe encore vers duckduckgo après déballage = pub non
          // résolue : inutile pour l'utilisateur, on l'écarte.
          if (/duckduckgo\\.com/.test(url)) continue;
          out.push({
            title: a.textContent.trim(),
            url,
            snippet: (el.querySelector('.result__snippet')?.textContent || '').trim().slice(0, 300),
          });
          if (out.length >= ${max}) break;
        }
        return { bloque: false, hits: out };
      })()`,
    });
    const val = r?.result?.value as { bloque?: boolean; hits?: SearchHit[] } | undefined;
    if (!val || val.bloque) return [];
    return (val.hits ?? []).filter((h) => h.url && h.title);
  } finally {
    await cdp.fermer();
  }
}

/**
 * Lit le contenu d'une page web (le texte visible), via le vrai Chrome. C'est
 * ce qui permet au modèle de VRAIMENT lire une page et de synthétiser, au lieu
 * de se contenter des extraits de recherche.
 */
export async function chromeReadPage(url: string, maxChars = 6000): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('URL invalide');
  const cdp = await ouvrirOnglet();
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: FURTIF });
    await cdp.send('Network.setUserAgentOverride', { userAgent: UA, acceptLanguage: 'fr-FR,fr;q=0.9' });
    await cdp.send('Page.navigate', { url });
    await sleep(3500);
    const r = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        // On enlève le bruit (nav, pieds de page, scripts) et on garde le texte
        // lisible du contenu principal quand il existe.
        const cible = document.querySelector('main, article, [role=main]') || document.body;
        const t = (cible.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
        return { titre: document.title, texte: t.slice(0, ${maxChars}) };
      })()`,
    });
    const val = r?.result?.value as { titre?: string; texte?: string } | undefined;
    if (!val?.texte) return '(page vide ou illisible)';
    return `# ${val.titre ?? url}\n${val.texte}`;
  } finally {
    await cdp.fermer();
  }
}
