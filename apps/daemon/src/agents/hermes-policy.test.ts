import { test } from 'node:test';
import assert from 'node:assert/strict';
import { choisir, verdict } from './hermes-policy.ts';

// Ces deux fonctions décident si une action s'exécute sur la machine de l'utilisateur.
// Elles sont pures, donc testables — et elles ont toutes les deux un biais
// volontaire : dans le doute, on ne laisse pas passer.
//
// À lire en gardant en tête que la politique ne voit que ce qu'Hermès lui
// soumet. En pratique : les modifications de fichiers, pas les commandes.
// Les cas `execute` ci-dessous décrivent ce que la fonction répondrait si on
// les lui soumettait — pas ce qui se passe aujourd'hui sur la machine.

/** Les catégories d'outils que l'ACP peut annoncer. */
const LECTURE = ['read', 'search', 'fetch', 'think'] as const;
const ECRITURE = ['edit', 'delete', 'move'] as const;
const DANGEREUX = ['execute', 'switch_mode', 'other'] as const;

test('« tout autoriser » laisse tout passer — c’est bien ce qu’il annonce', () => {
  for (const k of [...LECTURE, ...ECRITURE, ...DANGEREUX]) {
    assert.equal(verdict('tout', k), 'oui', k);
  }
});

test('« me demander » ne tranche jamais tout seul', () => {
  for (const k of [...LECTURE, ...ECRITURE, ...DANGEREUX]) {
    assert.equal(verdict('demander', k), 'demander', k);
  }
});

test('« lecture seule » refuse tout ce qui touche à la machine', () => {
  for (const k of LECTURE) assert.equal(verdict('lecture', k), 'oui', k);
  for (const k of [...ECRITURE, ...DANGEREUX]) assert.equal(verdict('lecture', k), 'non', k);
});

test('« accepter les fichiers » s’arrête avant de lancer une commande', () => {
  for (const k of [...LECTURE, ...ECRITURE]) assert.equal(verdict('ecritures', k), 'oui', k);
  // La distinction qui compte : écrire un fichier se répare, lancer une
  // commande peut ne pas se réparer.
  assert.equal(verdict('ecritures', 'execute'), 'demander');
});

test('une catégorie inconnue n’est jamais autorisée d’office', () => {
  // Une version future d'Hermès peut inventer une catégorie. Elle ne doit pas
  // se retrouver permise par défaut.
  for (const mode of ['demander', 'ecritures'] as const) {
    assert.equal(verdict(mode, 'catégorie-inventée'), 'demander', mode);
  }
  assert.equal(verdict('lecture', 'catégorie-inventée'), 'non');
});

test('l’option est choisie sur son type, pas sur son libellé', () => {
  const opts = [
    { optionId: 'a', name: 'Toujours refuser', kind: 'reject_always' },
    { optionId: 'b', name: 'Autoriser une fois', kind: 'allow_once' },
  ];
  assert.equal(choisir(opts, true), 'b');
  assert.equal(choisir(opts, false), 'a');
});

test('sans type exploitable, le libellé prend le relais', () => {
  const opts = [
    { optionId: 'x', name: 'Deny' },
    { optionId: 'y', name: 'Allow once' },
  ];
  assert.equal(choisir(opts, true), 'y');
  assert.equal(choisir(opts, false), 'x');
});

test('un refus impossible à exprimer n’est pas transformé en accord', () => {
  // C'est le piège : si aucune option ne veut dire « non », le repli
  // « prends la première » autoriserait l'action. Il ne doit valoir que pour
  // les accords. L'appelant annule le tour quand il ne reçoit rien.
  const que_des_oui = [{ optionId: 'seul', name: 'Proceed', kind: 'allow_once' }];
  assert.equal(choisir(que_des_oui, false), undefined);
  assert.equal(choisir(que_des_oui, true), 'seul');
});

test('une liste vide ne produit aucune option, dans les deux sens', () => {
  assert.equal(choisir([], true), undefined);
  assert.equal(choisir([], false), undefined);
});
