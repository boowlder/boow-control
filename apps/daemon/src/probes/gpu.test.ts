import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyser } from './gpu.ts';

test('lit la sortie de nvidia-smi', () => {
  assert.deepEqual(analyser('15129, 16311, NVIDIA GeForce RTX 5060 Ti\n'), {
    utiliseMo: 15129,
    totalMo: 16311,
    nom: 'NVIDIA GeForce RTX 5060 Ti',
  });
});

test('ne garde que la première carte', () => {
  const r = analyser('1000, 8000, Carte A\n2000, 8000, Carte B\n');
  assert.equal(r?.nom, 'Carte A');
});

test('un nom contenant une virgule reste entier', () => {
  assert.equal(analyser('1, 2, NVIDIA RTX A6000, 48GB')?.nom, 'NVIDIA RTX A6000, 48GB');
});

test('une sortie inattendue ne produit rien plutôt qu’un chiffre faux', () => {
  // Mieux vaut pas de jauge qu'une jauge qui ment sur la mémoire disponible.
  for (const s of ['', '\n', 'erreur: pilote absent', 'a, b, c', '100, 0, Carte']) {
    assert.equal(analyser(s), undefined, JSON.stringify(s));
  }
});
