import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE, CATEGORIES, connecteurParId, resoudreRecette } from './catalogue.ts';

// Le catalogue est curé à la main : ces invariants évitent qu'une entrée mal
// remplie (jeton sans secret, oauth sans voie ②…) ne casse l'UI ou ne mente
// sur ce que les locaux peuvent faire.

test('identifiants uniques', () => {
  const ids = CATALOGUE.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('chaque connecteur est cohérent', () => {
  for (const c of CATALOGUE) {
    assert.ok(c.id && c.nom, `id/nom manquant sur ${c.id}`);
    assert.ok((CATEGORIES as readonly string[]).includes(c.categorie), `catégorie inconnue : ${c.categorie} (${c.id})`);
    assert.ok(c.types.length > 0, `aucun type sur ${c.id}`);
    assert.ok(c.mains.length > 0, `aucune main sur ${c.id}`);

    // ① ou ② → il faut une recette locale exécutable (stdio avec command, ou http avec url).
    if (c.types.includes('local') || c.types.includes('jeton')) {
      assert.ok(c.local, `recette locale manquante sur ${c.id}`);
      const r = c.local!;
      assert.ok(r.transport === 'stdio' ? !!r.command : !!r.url, `recette locale incomplète sur ${c.id}`);
    }
    // ② → au moins un secret à coller, chacun avec sa clé d'env et son aide.
    if (c.types.includes('jeton')) {
      assert.ok(c.local?.secrets?.length, `connecteur jeton sans secret : ${c.id}`);
      for (const s of c.local!.secrets!) assert.ok(s.cle && s.libelle && s.aide, `secret incomplet sur ${c.id}`);
    }
    // ② ne peut viser les LOCAUX que si un secret existe (déjà couvert), et un
    // connecteur qui vise les locaux doit avoir une recette locale.
    if (c.mains.includes('locaux')) {
      assert.ok(c.local, `${c.id} vise les locaux mais n'a pas de recette locale`);
    }
    // La clé de voûte ③→② : un connecteur à la fois oauth ET jeton doit
    // expliquer l'alternative (sinon la promesse « utilisable hors Claude » ment).
    if (c.types.includes('oauth') && c.types.includes('jeton')) {
      assert.ok(c.alternativeJeton, `${c.id} : oauth+jeton sans note d'alternative ③→②`);
    }
  }
});

test('resoudreRecette : secret en variable d’environnement (GitHub)', () => {
  const c = connecteurParId('github')!;
  const def = resoudreRecette(c, { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_x' }, '/home/USER/projects')!;
  assert.equal(def.env?.GITHUB_PERSONAL_ACCESS_TOKEN, 'ghp_x');
  assert.ok(!def.args?.some((a) => a.includes('ghp_x')), 'le jeton ne doit pas fuiter dans les arguments');
});

test('resoudreRecette : secret en argument (synthétique) + pas dans l’env', () => {
  // Connecteur fictif dont le secret est utilisé comme ARGUMENT : le cas doit
  // rester couvert même si aucune entrée du catalogue ne l'emploie.
  const faux = {
    id: 'x',
    nom: 'X',
    categorie: 'Données',
    logo: '·',
    description: '',
    types: ['jeton'] as const,
    mains: ['locaux'] as const,
    local: { transport: 'stdio' as const, command: 'cmd', args: ['--conn', '{X}'], secrets: [{ cle: 'X', libelle: 'X', aide: 'X' }] },
  };
  const def = resoudreRecette(faux, { X: 'secret-val' }, '/tmp')!;
  assert.ok(def.args?.includes('secret-val'), 'le secret doit remplacer {X} dans les arguments');
  assert.ok(!def.env, 'un secret déjà passé en argument ne repart pas en env');
});

test('resoudreRecette : Postgres met la chaîne en variable d’environnement', () => {
  const c = connecteurParId('postgres')!;
  const url = 'postgres://u:p@h:5432/db';
  const def = resoudreRecette(c, { DATABASE_URI: url }, '/home/USER/projects')!;
  assert.equal(def.env?.DATABASE_URI, url);
  assert.ok(!def.args?.some((a) => a.includes(url)), 'la chaîne ne doit pas fuiter dans les arguments');
});

test('resoudreRecette : {cwd} est substitué', () => {
  const c = connecteurParId('filesystem')!;
  const def = resoudreRecette(c, {}, '/home/USER/projets')!;
  assert.ok(def.args?.includes('/home/USER/projets'));
  assert.ok(!def.args?.some((a) => a.includes('{cwd}')));
});

test('la promesse du chantier tient : la majorité est utilisable par les locaux', () => {
  const locaux = CATALOGUE.filter((c) => c.mains.includes('locaux')).length;
  assert.ok(locaux / CATALOGUE.length >= 0.8, `seulement ${locaux}/${CATALOGUE.length} utilisables par les locaux`);
});
