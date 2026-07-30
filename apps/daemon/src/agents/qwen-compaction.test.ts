import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimeTokens,
  planCompaction,
  reconstruireCarnet,
  CARNET_PREFIX,
  CARNET_ACCUSE,
  type Msg,
} from './qwen-compaction.ts';

// La compaction glissante (chantier 14) doit tenir une session sans fin sans
// partir « en vrille ». Les garanties testées ici, toutes structurelles :
//  - le système n'est jamais résumé (réinjecté tel quel) ;
//  - la queue récente reste mot pour mot ;
//  - un carnet déjà là est MIS À JOUR, pas empilé (pas de second carnet) ;
//  - quand il n'y a rien d'assez vieux, on ne touche à rien.

const sys: Msg = { role: 'system', content: 'Tu es Qwen.' };
const echanges = (n: number): Msg[] =>
  Array.from({ length: n }, (_, i) =>
    i % 2 === 0 ? { role: 'user', content: `question ${i}` } : { role: 'assistant', content: `réponse ${i}` },
  );

test('estimeTokens : ordre de grandeur ~ caractères / 4', () => {
  const t = estimeTokens([{ role: 'user', content: 'a'.repeat(400) }]);
  assert.ok(t >= 100 && t <= 120, `attendu ~102, obtenu ${t}`);
});

test('planCompaction : garde le système, résume le milieu, préserve le récent', () => {
  const history = [sys, ...echanges(20)]; // 1 système + 20 messages
  const { sys: s, ancien, milieu, recent } = planCompaction(history, '', 6);
  assert.equal(s, sys); // le système, tel quel
  assert.equal(ancien, ''); // pas de carnet préexistant
  assert.equal(recent.length, 6); // les 6 derniers verbatim
  assert.equal(milieu.length, 14); // le reste part au résumé
  assert.deepEqual(recent, echanges(20).slice(-6));
});

test('planCompaction : rien d’assez vieux ⇒ milieu vide (ne pas compacter)', () => {
  const history = [sys, ...echanges(5)]; // moins que garderRecent
  const { milieu, recent } = planCompaction(history, '', 6);
  assert.equal(milieu.length, 0);
  assert.equal(recent.length, 5);
});

test('reconstruireCarnet : structure système + carnet + accusé + récent', () => {
  const recent = echanges(4);
  const out = reconstruireCarnet(sys, 'RÉSUMÉ', recent);
  assert.equal(out[0], sys);
  assert.equal(out[1].role, 'user');
  assert.ok(out[1].content.startsWith(CARNET_PREFIX));
  assert.equal(out[1].content.slice(CARNET_PREFIX.length), 'RÉSUMÉ');
  assert.equal(out[2].role, 'assistant');
  assert.equal(out[2].content, CARNET_ACCUSE);
  assert.deepEqual(out.slice(3), recent);
});

test('compaction répétée : le carnet est MIS À JOUR, jamais empilé en double', () => {
  // 1re compaction
  const h1 = [sys, ...echanges(20)];
  const p1 = planCompaction(h1, '', 6);
  const compacte1 = reconstruireCarnet(p1.sys, 'carnet v1', p1.recent);

  // la session repart, de nouveaux échanges arrivent, on re-compacte
  const h2 = [...compacte1, ...echanges(12)];
  const p2 = planCompaction(h2, '', 6);

  // Le carnet précédent a été RECONNU et déballé (pas traité comme un échange).
  assert.equal(p2.ancien, 'carnet v1');
  // Ni le message-carnet ni son accusé ne repartent au résumé.
  assert.ok(!p2.milieu.some((m) => m.content.startsWith(CARNET_PREFIX)));
  assert.ok(!p2.milieu.some((m) => m.content === CARNET_ACCUSE));

  const compacte2 = reconstruireCarnet(p2.sys, 'carnet v2', p2.recent);
  // Toujours UN SEUL carnet dans l'historique reconstruit.
  const carnets = compacte2.filter((m) => m.content.startsWith(CARNET_PREFIX));
  assert.equal(carnets.length, 1);
  assert.equal(compacte2[0], sys); // et le système est toujours en tête
});
