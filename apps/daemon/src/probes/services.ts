import { execFile } from 'node:child_process';
import type { SystemService, SystemStatus } from '@boow/shared';
import { config } from '../config';
import { routerState } from '../routes/brains';
import { checkGpu } from './gpu';

async function ping(url: string, ms = 1500): Promise<{ ok: boolean; detail?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return { ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return { ok: false, detail: aborted ? 'timeout' : 'injoignable' };
  } finally {
    clearTimeout(timer);
  }
}

function checkBin(bin: string): Promise<{ ok: boolean; detail?: string }> {
  return new Promise((resolve) => {
    // Timeout large : un binaire Python (hermes) peut être lent au démarrage à froid.
    execFile(bin, ['--version'], { timeout: 8000 }, (err, stdout) => {
      if (err) resolve({ ok: false, detail: 'absent' });
      else resolve({ ok: true, detail: String(stdout).trim().split('\n')[0]?.slice(0, 40) });
    });
  });
}

// On ne mémorise QUE les succès : un binaire trouvé ne rebouge plus, mais un
// échec transitoire (timeout à froid) est re-sondé au prochain tick.
const binCache: { hermes?: SystemService; claude?: SystemService } = {};

export async function checkSystem(): Promise<SystemStatus> {
  const ep = config.endpoints;
  const [brain, chrome, gpu, routeur] = await Promise.all([
    ping(`${ep.brain}/models`),
    ping(`${ep.chromeCdp}/json/version`),
    checkGpu(),
    routerState().catch(() => null),
  ]);

  const probeHermes = !binCache.hermes?.ok;
  const probeClaude = !binCache.claude?.ok;
  if (probeHermes || probeClaude) {
    const [h, c] = await Promise.all([
      probeHermes ? checkBin(config.bin.hermes) : Promise.resolve(null),
      probeClaude ? checkBin(config.bin.claude) : Promise.resolve(null),
    ]);
    if (h) binCache.hermes = { id: 'hermes', label: 'Hermes CLI', ok: h.ok, detail: h.detail };
    if (c) binCache.claude = { id: 'claude', label: 'Claude Code CLI', ok: c.ok, detail: c.detail };
  }

  const services: SystemService[] = [
    { id: 'brain', label: 'Cerveau Qwen', url: ep.brain, ...brain },
    { id: 'chrome-cdp', label: 'Chrome CDP', url: ep.chromeCdp, ...chrome },
    binCache.hermes ?? { id: 'hermes', label: 'Hermes CLI', ok: false, detail: 'absent' },
    binCache.claude ?? { id: 'claude', label: 'Claude Code CLI', ok: false, detail: 'absent' },
  ];

  return {
    services,
    ...(gpu ? { gpu } : {}),
    // Vide = tout dort. Le front s'en sert pour la bulle de réveil et les
    // pastilles à trois états — sans jamais toucher à la veille elle-même.
    ...(routeur?.routerUp ? { cerveaux: { actifs: routeur.active, oeil: config.brains.vision } } : {}),
    checkedAt: Date.now(),
  };
}
