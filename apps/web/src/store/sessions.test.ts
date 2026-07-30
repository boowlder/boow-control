import { test } from 'node:test';
import assert from 'node:assert/strict';

// Le stockage local n'existe pas sous Node : on le remplace avant de charger le
// module, qui le lit dès l'import.
const disque = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => disque.get(k) ?? null,
  setItem: (k: string, v: string) => void disque.set(k, String(v)),
  removeItem: (k: string) => void disque.delete(k),
  clear: () => disque.clear(),
  key: () => null,
  length: 0,
} as Storage;

const { charger, enregistrer, filtrer, nouvelle, parMode, titreDepuis, SANS_TITRE } = await import('./sessions.ts');

test('un stockage vide ne rend aucune session', () => {
  disque.clear();
  assert.equal(charger().length, 0);
});

test('les sessions survivent à un aller-retour sur disque', () => {
  disque.clear();
  const a = nouvelle('normal');
  const b = nouvelle('claude');
  enregistrer([a, b]);
  const relu = charger();
  assert.equal(relu.length, 2);
  assert.deepEqual(relu.map((s) => s.id).sort(), [a.id, b.id].sort());
});

test('aucune session ne fuit d’un mode vers un autre', () => {
  disque.clear();
  enregistrer([nouvelle('normal'), nouvelle('claude'), nouvelle('claude'), nouvelle('operation')]);
  const relu = charger();
  // C'est la garantie qui compte : une discussion locale est gratuite, une
  // session Claude est facturée. Mélangées, on rouvre l'une pour l'autre.
  for (const mode of ['normal', 'claude', 'operation'] as const) {
    assert.ok(parMode(relu, mode).every((s) => s.mode === mode), mode);
  }
  assert.equal(parMode(relu, 'claude').length, 2);
});

test('la liste d’un mode va du plus récent au plus ancien', () => {
  disque.clear();
  const vieux = nouvelle('normal');
  vieux.vu = 1_000;
  const recent = nouvelle('normal');
  recent.vu = 9_000;
  enregistrer([vieux, recent]);
  assert.deepEqual(
    parMode(charger(), 'normal').map((s) => s.id),
    [recent.id, vieux.id],
  );
});

test('un mode bavard n’efface pas l’historique des autres', () => {
  disque.clear();
  const masse = Array.from({ length: 105 }, (_, i) => {
    const s = nouvelle('normal');
    s.vu = 1_000 + i;
    return s;
  });
  const claude = nouvelle('claude');
  claude.vu = 1; // la plus vieille de toutes
  enregistrer([...masse, claude]);

  const relu = charger();
  assert.equal(parMode(relu, 'normal').length, 100, 'le tas bavard est élagué');
  assert.equal(parMode(relu, 'claude').length, 1, 'le tas discret est intact');
  assert.equal(parMode(relu, 'normal')[0].vu, 1_104, 'ce sont les plus récentes qui restent');
});

test('la recherche fouille le titre ET le contenu des messages', () => {
  const a = nouvelle('normal');
  a.titre = 'refais la maquette';
  const b = nouvelle('normal');
  b.titre = 'question réseau';
  b.chats = { qwen: [{ id: '1', role: 'assistant', text: 'un routeur dirige les paquets', ts: 1 }] };

  // trouvé par le titre
  assert.deepEqual(filtrer([a, b], 'maquette').map((s) => s.id), [a.id]);
  // trouvé par le contenu d'un message
  assert.deepEqual(filtrer([a, b], 'paquets').map((s) => s.id), [b.id]);
  // plusieurs mots = tous présents, ordre libre
  assert.deepEqual(filtrer([a, b], 'routeur réseau').map((s) => s.id), [b.id]);
  // une requête vide ne filtre rien
  assert.equal(filtrer([a, b], '   ').length, 2);
  // aucune correspondance
  assert.equal(filtrer([a, b], 'introuvable').length, 0);
});

test('un flux coupé par un rechargement ne reste pas « en cours »', () => {
  disque.clear();
  const s = nouvelle('normal');
  s.chats = { hermes: [{ id: '1', role: 'assistant', text: 'coup…', streaming: true, ts: Date.now() }] };
  enregistrer([s]);
  assert.equal(charger()[0].chats.hermes[0].streaming, false);
});

test('un stockage abîmé ne fait pas planter le cockpit', () => {
  disque.clear();
  disque.set('boow.sessions', '{pas du json');
  assert.deepEqual(charger(), []);
  disque.set('boow.sessions', '{"ceci":"n’est pas un tableau"}');
  assert.deepEqual(charger(), []);
});

test('le titre reprend la première phrase, coupée au mot', () => {
  assert.equal(titreDepuis(''), SANS_TITRE);
  assert.equal(titreDepuis('   '), SANS_TITRE);
  assert.equal(titreDepuis('  refais   la   maquette  '), 'refais la maquette');

  const long = titreDepuis(`${'a'.repeat(20)} ${'b'.repeat(60)}`);
  assert.ok(long.length <= 49, 'assez court pour la barre latérale');
  assert.ok(long.endsWith('…'), 'la coupe se voit');
  assert.ok(!long.slice(0, -1).endsWith(' '), 'pas d’espace avant les points de suspension');
});
