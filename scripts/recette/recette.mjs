#!/usr/bin/env node
// La recette — le filet de boow control.
//
//   pnpm recette             vérifie l'essentiel en ~30 s, sans réveiller de cerveau
//   pnpm recette --complet   + un vrai message part et une réponse revient
//
// Règle de la carte (chantier 5.7) : plus jamais de « c'est fini » sans
// recette verte. Elle regarde le VRAI écran via Chrome, pas seulement le code.

import { spawn } from 'node:child_process';
import { connect, close, sleep, evaluate, clickText, type } from './cdp.mjs';

const BASE = process.env.BOOW_URL ?? 'http://localhost:8788';
const COMPLET = process.argv.includes('--complet');

let rates = 0;
let avertissements = 0;
const ok = (nom, detail = '') => console.log(`  ✔ ${nom}${detail ? ` — ${detail}` : ''}`);
const ko = (nom, detail = '') => {
  rates++;
  console.log(`  ✖ ${nom}${detail ? ` — ${detail}` : ''}`);
};
const attention = (nom, detail = '') => {
  avertissements++;
  console.log(`  ⚠ ${nom}${detail ? ` — ${detail}` : ''}`);
};

async function etape(nom, fn) {
  try {
    const detail = await fn();
    ok(nom, typeof detail === 'string' ? detail : '');
  } catch (e) {
    ko(nom, e.message);
  }
}

// ── 1. Les routes ────────────────────────────────────────────────────────────
console.log('\nLes routes :');

await etape("l'appli répond", async () => {
  const d = Date.now();
  const r = await fetch(BASE);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return `${Date.now() - d} ms`;
});

await etape('métriques', async () => {
  const r = await fetch(`${BASE}/api/metrics`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
});

await etape('cerveaux', async () => {
  const r = await fetch(`${BASE}/api/brains`);
  const j = await r.json();
  if (typeof j.routerUp !== 'boolean') throw new Error('réponse inattendue');
  return j.routerUp ? `routeur prêt · ${j.active.length} chargé(s)` : 'routeur éteint';
});

await etape('connecteurs en < 2 s', async () => {
  const d = Date.now();
  const r = await fetch(`${BASE}/api/repertoire/connecteurs?instant=1`);
  const j = await r.json();
  const ms = Date.now() - d;
  if (ms > 2000) throw new Error(`${ms} ms`);
  return `${j.connecteurs.length} connecteurs en ${ms} ms`;
});

await etape('catalogue de connecteurs', async () => {
  const r = await fetch(`${BASE}/api/catalogue`);
  const j = await r.json();
  if (!Array.isArray(j.connecteurs) || j.connecteurs.length === 0) throw new Error('catalogue vide');
  return `${j.connecteurs.length} connecteurs · ${j.resume.utilisablesLocaux} pour les locaux`;
});

await etape('oreille locale', async () => {
  const r = await fetch(`${BASE}/api/oreille/status`);
  const j = await r.json();
  if (!j.disponible) throw new Error('worker whisper absent');
  return j.moteur;
});

await etape('boîte à outils des cerveaux', async () => {
  const r = await fetch(`${BASE}/api/outils`);
  const j = await r.json();
  if (!Array.isArray(j.outils) || j.outils.length === 0) throw new Error('aucun outil natif');
  return `${j.outils.length} outils, ${j.mcp.length} serveur(s) MCP`;
});

await etape('mémoire de recherche', async () => {
  const r = await fetch(`${BASE}/api/memoire/etat`);
  const j = await r.json();
  if (!j.disponible) throw new Error('modèle d’empreintes absent');
  return j.indexe ? `${j.morceaux} morceaux indexés` : 'prête (index à construire)';
});

// ── 2. Les tests unitaires ───────────────────────────────────────────────────
console.log('\nLes tests unitaires :');

function commande(nom, cmd, args) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let sortie = '';
    p.stdout.on('data', (d) => (sortie += d));
    p.stderr.on('data', (d) => (sortie += d));
    p.on('close', (code) => {
      const passe = sortie.match(/# pass (\d+)/)?.[1];
      if (code === 0) ok(nom, passe ? `${passe} tests` : '');
      else ko(nom, sortie.split('\n').filter((l) => /not ok|error/i.test(l))[0] ?? `code ${code}`);
      resolve();
    });
  });
}

await commande('daemon', 'pnpm', ['--filter', '@boow/daemon', 'test']);
await commande('web', 'node', ['--experimental-strip-types', '--test', 'apps/web/src/store/sessions.test.ts']);

// ── 3. Le vrai écran ─────────────────────────────────────────────────────────
console.log("\nL'écran, via Chrome :");

let tab;
try {
  tab = await connect(BASE);
  await sleep(2500);

  await etape('cockpit connecté au daemon', async () => {
    const t = await evaluate(`document.querySelector('header span[title]')?.getAttribute('title') ?? ''`);
    if (!t.includes('connecté')) throw new Error(t || 'pastille absente');
  });

  await etape('mode Opération', async () => {
    await clickText('opération');
    await sleep(600);
    const t = await evaluate(`document.body.innerText`);
    if (!/Parle-moi du projet|Discussion :/.test(t)) throw new Error('accueil opération absent');
  });

  await etape('mode ClaudeCODE', async () => {
    await clickText('claudecode');
    await sleep(600);
    const t = await evaluate(`document.body.innerText`);
    if (!/Claude Code répond|Parle à Claude Code/.test(t)) throw new Error('accueil ClaudeCODE absent');
  });

  await etape('mode Normal', async () => {
    await clickText('normal');
    await sleep(600);
    const t = await evaluate(`document.body.innerText`);
    if (!/je choisis qui répond|RÉPOND/i.test(t)) throw new Error('accueil normal absent');
  });

  await etape('Routines', async () => {
    await clickText('routines');
    await sleep(600);
    const t = await evaluate(`document.body.innerText`);
    if (!/ROUTINES/i.test(t)) throw new Error('page absente');
  });

  await etape('Réglages — les lignes attendues', async () => {
    await clickText('réglages');
    await sleep(600);
    const t = await evaluate(`document.body.innerText`);
    for (const ligne of ['Répertoire', 'Cerveaux locaux', 'Connexion Anthropic', 'Machine']) {
      if (!t.includes(ligne)) throw new Error(`« ${ligne} » manque`);
    }
  });

  await etape('Répertoire — le catalogue répond', async () => {
    const r = await fetch(`${BASE}/api/repertoire`);
    const j = await r.json();
    if (!Array.isArray(j.plugins) || j.plugins.length === 0) throw new Error('0 plugin');
    return `${j.plugins.length} plugins`;
  });

  // La jauge d'abonnement repose sur un champ expérimental du SDK : si elle
  // meurt en silence alors que Claude est là, c'est ici qu'on le voit.
  {
    const t = await evaluate(`document.body.innerText`);
    const claudeOk = await evaluate(
      `[...document.querySelectorAll('header span[title]')].some(e => (e.getAttribute('title') ?? '').includes('Claude Code'))`,
    );
    const jauge = /\bsem\b/.test(t) || /5 h/.test(t);
    if (claudeOk && !jauge) {
      attention("jauge d'abonnement invisible alors que Claude répond", 'le champ du SDK a peut-être changé');
    } else {
      ok("jauge d'abonnement", jauge ? 'affichée' : 'absente, comme Claude');
    }
  }

  // ── 4. Complet : un vrai aller-retour ──────────────────────────────────────
  if (COMPLET) {
    console.log('\nUn vrai message (--complet) :');
    await etape('une réponse locale arrive', async () => {
      await clickText('travail');
      await sleep(400);
      await clickText('normal');
      await sleep(400);
      const jeton = `pret-${Date.now().toString().slice(-5)}`;
      await evaluate(`(() => { document.querySelector('textarea').focus(); })()`);
      await type(`Recette : réponds exactement ce mot, rien d'autre : ${jeton}`);
      await sleep(200);
      await clickText('envoyer');
      const debut = Date.now();
      // Réveil compris : jusqu'à 2 min (74 s mesurés à froid sur cette machine).
      // On attend que le cerveau RÉPÈTE le jeton — une vraie réponse, pas un
      // en-tête périmé d'un échange précédent. Le jeton apparaît d'abord dans
      // la question ; on exige donc au moins deux occurrences.
      for (let i = 0; i < 60; i++) {
        await sleep(2000);
        const vu = await evaluate(
          `(document.body.innerText.match(new RegExp(${JSON.stringify(jeton)}, 'g')) || []).length`,
        );
        const reveil = await evaluate(`/réveille/.test(document.body.innerText)`);
        if (vu >= 2 && !reveil) return `${Math.round((Date.now() - debut) / 1000)} s`;
      }
      throw new Error('pas de réponse en 2 min');
    });
  }
} catch (e) {
  ko('pilotage Chrome', e.message);
} finally {
  if (tab) await close(tab);
}

// ── Verdict ──────────────────────────────────────────────────────────────────
console.log('');
if (rates === 0) {
  console.log(`Recette verte ✔${avertissements ? ` — ${avertissements} avertissement(s)` : ''}\n`);
  process.exit(0);
} else {
  console.log(`Recette ROUGE — ${rates} échec(s), ${avertissements} avertissement(s)\n`);
  process.exit(1);
}
