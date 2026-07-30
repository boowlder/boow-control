import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Recherche web Brave (API à clé) — fiable quelle que soit l'IP (utile derrière un VPN).
 * Activée si BOOW_BRAVE_KEY (ou BRAVE_API_KEY) est définie.
 */
async function braveSearch(query: string, key: string, max: number): Promise<SearchHit[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${max}&country=fr`;
  const res = await fetch(url, {
    headers: { accept: 'application/json', 'accept-encoding': 'gzip', 'x-subscription-token': key },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const data = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } };
  return (data.web?.results ?? []).slice(0, max).map((r) => ({ title: clean(r.title), url: r.url, snippet: clean(r.description ?? '') }));
}

/**
 * Recherche web DuckDuckGo "lite" SANS clé, via curl (undici reçoit un 403 à cause de
 * son empreinte TLS). Best-effort : DDG limite agressivement les IP VPN/datacenter et
 * peut renvoyer 0 résultat — l'appelant répond alors sans le web.
 */
async function ddgSearch(query: string, max: number): Promise<SearchHit[]> {
  const { stdout: html } = await execFileP(
    'curl',
    ['-s', '-m', '12', '-A', UA, '--data-urlencode', `q=${query}`, 'https://lite.duckduckgo.com/lite/'],
    { maxBuffer: 5_000_000, timeout: 14_000 },
  );
  const links: { url: string; title: string }[] = [];
  const linkRe = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(linkRe)) links.push({ url: m[1], title: clean(m[2]) });
  const snippets: string[] = [];
  const snipRe = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
  for (const m of html.matchAll(snipRe)) snippets.push(clean(m[1]));

  const hits: SearchHit[] = [];
  for (let i = 0; i < links.length && hits.length < max; i++) {
    if (!links[i].title || /duckduckgo\.com/.test(links[i].url)) continue;
    hits.push({ title: links[i].title, url: links[i].url, snippet: snippets[i] ?? '' });
  }
  return hits;
}

/** Quel moteur est actif (pour l'UI / logs). */
export const searchBackend = (): 'brave' | 'chrome' | 'duckduckgo' =>
  process.env.BOOW_BRAVE_KEY || process.env.BRAVE_API_KEY ? 'brave' : 'chrome';

/**
 * Top résultats web. Ordre de préférence :
 *   1. Brave (si une clé est donnée) — le plus fiable, mais payant/carte.
 *   2. Chrome furtif — GRATUIT, via le navigateur que boow fait déjà tourner ;
 *      contourne le blocage anti-robot de DuckDuckGo. Le défaut.
 *   3. DuckDuckGo par curl — dernier recours (souvent bloqué depuis un VPN).
 */
export async function webSearch(query: string, max = 5): Promise<SearchHit[]> {
  const key = process.env.BOOW_BRAVE_KEY || process.env.BRAVE_API_KEY;
  if (key) return braveSearch(query, key, max);
  try {
    const { chromeSearch } = await import('./websearch-chrome');
    const hits = await chromeSearch(query, max);
    if (hits.length) return hits;
  } catch {
    /* Chrome indisponible : on tente le curl en dernier recours */
  }
  return ddgSearch(query, max);
}
