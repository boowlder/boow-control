import { exec } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Operation, OperationEtape } from '@boow/shared';
import type { Bus } from './bus';
import type { Registry } from './registry';
import { askClaudeOnce } from './agents/claude';
import { demanderAuCerveau } from './agents/local';
import { runHermes } from './agents/hermes';

const execP = promisify(exec);

// ─────────────────────────────────────────────────────────────────────────────
//  MODE OPÉRATION
//
//  Claude est le cartographe, pas le contremaître. Deux temps :
//
//  1. LA DISCUSSION — l'utilisateur et Claude préparent le projet ensemble. Un appel
//     par message. Non bridé : c'est l'utilisateur qui tape, donc rien ne s'emballe.
//  2. « ENVOIE AUX LOCAUX » — Claude change la discussion en carte (1 appel),
//     puis le daemon conduit et les modèles locaux marchent (0 appel). Claude
//     n'est rappelé que si une étape échoue deux fois, et pour la revue finale.
//
//  Le budget ne borne que le deuxième temps : celui qui tourne SANS l'utilisateur
//  devant l'écran. C'est là qu'était sa crainte, et c'est là qu'on l'arrête.
//  Tout est compté et affiché dans les deux cas.
// ─────────────────────────────────────────────────────────────────────────────

const DOSSIER = path.join(os.homedir(), '.boow', 'operations');
/** Au-delà, on considère qu'une commande de vérification est partie en vrille. */
const VERIF_TIMEOUT = 60_000;
/** Une étape qui dépasse ça est probablement bloquée. Deux essais possibles,
 *  donc on reste raisonnable : mieux vaut échouer net que faire attendre. */
const ETAPE_TIMEOUT = 300_000;

const operations = new Map<string, Operation>();
/** Opérations dont l'exécution est en cours — sert à demander l'arrêt. */
const arrets = new Set<string>();

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function pousser(bus: Bus, op: Operation): void {
  operations.set(op.id, op);
  bus.emit({ t: 'operation.update', operation: op });
  void sauver(op);
}

async function sauver(op: Operation): Promise<void> {
  try {
    const d = path.join(DOSSIER, op.id);
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, 'carte.json'), JSON.stringify(op, null, 2), 'utf8');
  } catch {
    // Une opération qui tourne vaut mieux qu'une opération qui plante à l'écriture.
  }
}

/** Relit les opérations d'une session précédente (pour l'affichage). */
export async function chargerOperations(): Promise<Operation[]> {
  try {
    const noms = await readdir(DOSSIER);
    for (const n of noms) {
      try {
        const brut = await readFile(path.join(DOSSIER, n, 'carte.json'), 'utf8');
        const op = JSON.parse(brut) as Operation;
        // Une opération interrompue par un redémarrage n'est plus en cours.
        if (op.statut === 'encours' || op.statut === 'carte') {
          op.statut = 'pause';
          op.message = 'Interrompue par un redémarrage du cockpit.';
        }
        operations.set(op.id, op);
      } catch {
        /* dossier illisible — on l'ignore */
      }
    }
  } catch {
    /* pas encore d'opérations */
  }
  return listerOperations();
}

export function listerOperations(): Operation[] {
  return [...operations.values()].sort((a, b) => b.debut - a.debut).slice(0, 30);
}

export function arreterOperation(bus: Bus, id: string): boolean {
  const op = operations.get(id);
  if (!op || ['termine', 'echec', 'arrete'].includes(op.statut)) return false;
  arrets.add(id);
  op.statut = 'arrete';
  op.message = 'Arrêtée à la main.';
  op.fin = Date.now();
  pousser(bus, op);
  return true;
}

// ── 1. La discussion ────────────────────────────────────────────────────────

const SYSTEME_BRAINSTORM = `Tu prépares un projet avec l'utilisateur. Vous en discutez AVANT que quoi que ce soit ne soit lancé.

Ton rôle ici : réfléchir avec lui à voix haute — proposer des pistes, donner ton avis, l'aider à préciser. C'est une conversation normale, détendue, pas un questionnaire.

RÈGLE IMPORTANTE sur les questions : ne termine PAS chacune de tes réponses par une question. La plupart du temps, contente-toi de parler normalement, de proposer, de commenter. Ne pose une question QUE si un choix te bloque vraiment pour la suite — et jamais plus d'une. Si tu as assez pour avancer, dis simplement ce que tu ferais.

Tu ne produis PAS le plan d'exécution ici. Quand l'utilisateur sera prêt, il cliquera lui-même un bouton pour lancer la création de la carte — tu n'as pas à le lui proposer ni à lui demander s'il veut continuer.

Tu DISCUTES, rien d'autre. N'écris pas de plan formel, ne rédige pas de fichier, ne mentionne jamais « plan », « ExitPlanMode » ni la validation d'un plan. Pas de blocs de code non plus, sauf si l'utilisateur en demande. Juste une réponse en phrases, comme dans une conversation.

Garde en tête : le travail sera ensuite exécuté par de PETITS modèles locaux (pas par toi). L'un rédige du texte et du code mais ne touche à rien ; l'autre, plus lent, a accès aux fichiers et au terminal. Oriente le projet vers quelque chose qu'ils sauront faire.

Style : simple, en français, sans jargon. Bref — 8 lignes maximum. Pas de listes interminables.`;

// ── 2. La carte ─────────────────────────────────────────────────────────────

const SYSTEME_CARTE = `Tu es cartographe. À partir de la discussion que vous venez d'avoir, tu produis la CARTE que d'autres suivront.

Ceux qui exécuteront tes étapes sont de PETITS modèles locaux, bien moins puissants que toi. Écris pour eux : chaque consigne doit être autonome, concrète, sans sous-entendu et sans référence à une autre étape.

Trois exécutants possibles :
- "local-texte" : un cerveau local qui produit du texte ou du code. AUCUN accès aux fichiers ni au terminal. C'est lui qui RÉDIGE.
- "fichier" : le système écrit un fichier LUI-MÊME, instantanément. Il y met le résultat de l'étape précédente. Donne un chemin ABSOLU dans le champ "chemin", ex: /home/USER/projects/mon-projet/index.html (jamais un chemin relatif — le fichier serait introuvable). Les dossiers manquants sont créés tout seuls. À utiliser pour TOUTE création/écriture de fichier — c'est rapide et fiable.
- "hermes" : un agent lent avec les mains (terminal, git, build). À RÉSERVER aux actions qui demandent du jugement : lancer une commande, un build, une modification fine d'un fichier existant. NE l'utilise PAS pour créer un fichier depuis zéro (utilise "fichier").

Le résultat de l'étape précédente est automatiquement transmis à la suivante. Le motif idéal : une étape "local-texte" rédige le code, l'étape suivante "fichier" l'écrit sur le disque.

Règles :
- 3 à 7 étapes. Pas plus. Chaque étape fait une seule chose.
- Pour créer un fichier : une étape "local-texte" qui rédige, PUIS une étape "fichier" avec le "chemin". Pas besoin d'étape séparée pour créer le dossier.
- N'utilise "hermes" que si une VRAIE action machine est nécessaire (commande, build, git). Sinon, évite-le : il est lent.
- "verif" est une commande shell qui rend 0 si l'étape a réussi (ex: test -f /chemin/fichier.html). Mets-la dès que c'est possible.
- "critere" est une phrase courte qui dit comment on reconnaît la réussite.

Réponds UNIQUEMENT par du JSON valide, sans texte autour et sans bloc de code :
{"titre":"...","etapes":[{"titre":"...","prompt":"...","executant":"local-texte|fichier|hermes","chemin":"(si fichier)","critere":"...","verif":"..."}]}`;

interface CarteBrute {
  titre?: string;
  etapes?: Array<{
    titre?: string;
    prompt?: string;
    executant?: string;
    chemin?: string;
    critere?: string;
    verif?: string;
  }>;
}

/** Extrait le JSON même si le modèle l'a entouré de texte ou de ```json. */
function extraireJson(texte: string): CarteBrute | null {
  const sansBlocs = texte.replace(/```(?:json)?/gi, '').trim();
  const debut = sansBlocs.indexOf('{');
  const fin = sansBlocs.lastIndexOf('}');
  if (debut < 0 || fin <= debut) return null;
  try {
    return JSON.parse(sansBlocs.slice(debut, fin + 1)) as CarteBrute;
  } catch {
    return null;
  }
}

function normaliser(brut: CarteBrute): OperationEtape[] {
  return (brut.etapes ?? [])
    .filter((e) => e && typeof e.prompt === 'string' && e.prompt.trim())
    .slice(0, 12)
    .map((e, i) => {
      // Une étape « fichier » sans chemin ne veut rien dire : on la ramène à
      // une simple rédaction, pour ne jamais écrire n'importe où.
      const executant: OperationEtape['executant'] =
        e.executant === 'hermes'
          ? 'hermes'
          : e.executant === 'fichier' && e.chemin?.trim()
            ? 'fichier'
            : 'local-texte';
      return {
        id: `e${i + 1}`,
        titre: (e.titre ?? `Étape ${i + 1}`).slice(0, 120),
        prompt: e.prompt!.trim(),
        executant,
        ...(executant === 'fichier' ? { chemin: e.chemin!.trim() } : {}),
        critere: (e.critere ?? 'produit attendu obtenu').slice(0, 200),
        ...(e.verif && e.verif.trim() ? { verif: e.verif.trim() } : {}),
        statut: 'attente' as const,
        essais: 0,
      };
    });
}

// ── 2. L'exécution ──────────────────────────────────────────────────────────

// La base des chemins relatifs d'une opération : le dossier des projets, PAS le
// répertoire du daemon (où les fichiers relatifs finissaient enfouis et
// introuvables). Écritures ET vérifications partent d'ici, pour rester cohérentes.
const BASE_PROJETS = path.join(os.homedir(), 'projects');

/** Lance la commande de vérification. Réussite = code de sortie 0. */
async function verifier(cmd: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const { stdout } = await execP(cmd, { timeout: VERIF_TIMEOUT, shell: '/bin/bash', cwd: BASE_PROJETS });
    return { ok: true, detail: stdout.trim().slice(0, 300) };
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    return { ok: false, detail: (err.stderr || err.message || 'échec').trim().slice(0, 300) };
  }
}

// Où le daemon a le droit d'écrire un fichier d'opération : les dossiers de
// travail. Jamais ailleurs, même si la carte le demandait.
const RACINES_ECRITURE = [
  path.join(os.homedir(), 'projects'),
  path.join(os.homedir(), 'work'),
];
function dansPerimetre(p: string): boolean {
  const r = path.resolve(p);
  return RACINES_ECRITURE.some((base) => r === base || r.startsWith(base + path.sep));
}

/** Débarrasse un contenu de code des éventuelles clôtures markdown (```html …```). */
function extraireContenu(brut: string): string {
  const t = brut.trim();
  const fence = t.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  return t;
}

/**
 * Écriture directe par le DAEMON — instantanée, sans réveiller Hermès. Elle
 * dépose le résultat de l'étape précédente (le code produit) dans le fichier
 * voulu. C'est ce qui remplace les lentes étapes Hermès de création de fichier.
 */
async function ecrireFichierDirect(
  bus: Bus,
  chemin: string,
  contenu: string,
): Promise<{ texte: string; erreur?: string }> {
  // Chemin relatif → résolu dans ~/projects (trouvable), pas dans le répertoire
  // du daemon. Chemin absolu → respecté tel quel (dans le périmètre).
  const cible = path.isAbsolute(chemin) ? path.resolve(chemin) : path.resolve(BASE_PROJETS, chemin);
  if (!dansPerimetre(cible)) {
    return { texte: '', erreur: `chemin hors des dossiers de travail : ${chemin}` };
  }
  if (!contenu.trim()) {
    return { texte: '', erreur: 'rien à écrire (étape précédente vide)' };
  }
  try {
    await mkdir(path.dirname(cible), { recursive: true });
    await writeFile(cible, extraireContenu(contenu));
    bus.emit({ t: 'agent.file', id: 'qwen', path: cible, action: 'write', ts: Date.now() });
    return { texte: `Fichier écrit : ${cible}` };
  } catch (e) {
    return { texte: '', erreur: (e as Error).message };
  }
}

/** Confie une étape à son exécutant et rend ce qu'il a produit. */
async function executer(
  bus: Bus,
  registry: Registry,
  etape: OperationEtape,
  consigne: string,
  precedent: string | undefined,
): Promise<{ texte: string; erreur?: string }> {
  // Écriture de fichier : le daemon la fait lui-même, tout de suite.
  if (etape.executant === 'fichier') {
    return ecrireFichierDirect(bus, etape.chemin ?? '', precedent ?? '');
  }
  if (etape.executant === 'hermes') {
    // Hermes n'a pas de minuteur interne : sans ça, une étape peut bloquer
    // l'opération entière indéfiniment. On préfère un échec net.
    return Promise.race([
      runHermes(bus, registry, 'hermes', consigne),
      new Promise<{ texte: string; erreur: string }>((r) =>
        setTimeout(
          () => r({ texte: '', erreur: `Hermes n'a pas répondu en ${Math.round(ETAPE_TIMEOUT / 60000)} min` }),
          ETAPE_TIMEOUT,
        ),
      ),
    ]);
  }
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), ETAPE_TIMEOUT);
  try {
    return await demanderAuCerveau(consigne, { signal: ctrl.signal });
  } finally {
    clearTimeout(minuteur);
  }
}

/** Longueur max du résultat repassé à l'étape suivante — au-delà, on tronque. */
const REPORT_MAX = 12_000;

/**
 * Construit la consigne réellement envoyée : la demande de la carte, plus le
 * résultat de l'étape précédente. Sans ce report, chaque étape repart de zéro
 * et refait le travail de la précédente.
 */
function consigneAvecContexte(etape: OperationEtape, precedent: string | undefined): string {
  if (!precedent) return etape.prompt;
  const extrait =
    precedent.length > REPORT_MAX ? `${precedent.slice(0, REPORT_MAX)}\n…(tronqué)` : precedent;
  return `${etape.prompt}\n\n--- Résultat de l'étape précédente (à utiliser tel quel) ---\n${extrait}`;
}

/** Une étape est-elle réussie ? La commande fait foi ; sinon, un texte non vide suffit. */
async function evaluer(
  etape: OperationEtape,
  resultat: { texte: string; erreur?: string },
): Promise<{ ok: boolean; detail: string }> {
  // La commande de vérif est la PREUVE objective : si elle passe, l'étape est
  // réussie — même si l'exécutant a hoqueté (Hermès occupé, tour annulé…). Le
  // fichier flappy-hell « échouait » pour ça : Hermès était occupé, mais la
  // commande `wc -c > 1000` serait passée. On la lance donc en premier.
  if (etape.verif) {
    const v = await verifier(etape.verif);
    if (v.ok) return v;
    // Vérif en échec : l'erreur de l'exécutant, si elle existe, est plus parlante.
    return resultat.erreur ? { ok: false, detail: resultat.erreur } : v;
  }
  if (resultat.erreur) return { ok: false, detail: resultat.erreur };
  if (!resultat.texte.trim()) return { ok: false, detail: 'aucun résultat produit' };
  return { ok: true, detail: resultat.texte.trim().slice(0, 300) };
}

// ── 3. Le déroulé ───────────────────────────────────────────────────────────

/** Crée une opération vide, en phase de discussion. */
function nouvelleOperation(objectif: string): Operation {
  return {
    id: uid(),
    titre: objectif.slice(0, 90),
    objectif,
    statut: 'brainstorm',
    budget: 3,
    appelsClaude: 0,
    appelsAuto: 0,
    coutUsd: 0,
    echanges: [],
    etapes: [],
    revueFinale: false,
    debut: Date.now(),
  };
}

/**
 * Met la discussion à plat pour la repasser à Claude en un seul message.
 *
 * On N'UTILISE PLUS la reprise de session de Claude Code (`resume`) : sur une
 * reprise, Claude Code sortait de la conversation pour se mettre à AGIR (mode
 * plan : écrire des fichiers de plan, éditer…), et ces actions revenaient
 * mêlées à la réponse sous forme de charabia. Vérifié le 24/07/2026. En passant
 * plutôt tout l'historique en clair, chaque appel est « frais » — et un appel
 * frais discute proprement.
 */
function discussionAPlat(op: Operation): string {
  if (op.echanges.length <= 1) return op.echanges[0]?.texte ?? op.objectif;
  const fil = op.echanges
    .map((e) => `${e.role === 'moi' ? 'Vous' : 'Toi'} : ${e.texte}`)
    .join('\n\n');
  return `Voici votre discussion jusqu'ici :\n\n${fil}\n\nRéponds au dernier message de l'utilisateur, dans la continuité.`;
}

/**
 * Un tour de discussion avec Claude, avant qu'aucune carte n'existe.
 *
 * Ces appels ne sont PAS bridés par le budget : chacun est déclenché par l'utilisateur
 * en tapant un message. Le budget protège de ce qui tourne sans lui, pas d'une
 * conversation qu'il conduit. Ils restent comptés et affichés.
 */
export async function brainstormer(
  bus: Bus,
  idExistant: string | undefined,
  texte: string,
): Promise<Operation | undefined> {
  const op = idExistant ? operations.get(idExistant) : nouvelleOperation(texte);
  if (!op) return undefined;
  if (op.statut !== 'brainstorm') {
    bus.emit({ t: 'notice', level: 'warn', text: "Cette opération n'est plus en discussion." });
    return op;
  }

  op.echanges.push({ role: 'moi', texte, ts: Date.now() });
  pousser(bus, op);

  op.appelsClaude++;
  const r = await askClaudeOnce(discussionAPlat(op), {
    systeme: SYSTEME_BRAINSTORM,
    maxTurns: 1,
  });
  op.coutUsd += r.coutUsd;

  op.echanges.push({
    role: 'claude',
    texte: r.erreur ? `⚠ ${r.erreur}` : r.texte,
    ts: Date.now(),
  });
  pousser(bus, op);
  return op;
}

/**
 * « Ok, envoie aux locaux » : Claude transforme la discussion en carte, puis
 * l'exécution démarre. À partir d'ici, plus un seul appel — sauf blocage.
 */
export async function dresserCarte(
  bus: Bus,
  registry: Registry,
  id: string,
  reglages: { budget: number; revueFinale: boolean },
): Promise<Operation | undefined> {
  const op = operations.get(id);
  if (!op || op.statut !== 'brainstorm') return op;
  // La carte reçoit la discussion en clair (plus de reprise de session — voir
  // discussionAPlat). Sans ça, le cartographe repartirait sans le contexte.
  const fil = op.echanges.map((e) => `${e.role === 'moi' ? 'Vous' : 'Claude'} : ${e.texte}`).join('\n\n');
  return construireEtExecuter(
    bus,
    registry,
    op,
    `Voici la discussion que l'utilisateur et toi venez d'avoir :\n\n${fil}\n\nTransforme-la en carte, au format JSON demandé. Rien d’autre que le JSON.`,
    reglages,
  );
}

/**
 * Lancement direct, sans discussion préalable : l'objectif part tel quel au
 * cartographe. C'est le chemin des routines, où personne n'est là pour discuter.
 */
export async function lancerOperationDirecte(
  bus: Bus,
  registry: Registry,
  objectif: string,
  reglages: { budget: number; revueFinale: boolean },
): Promise<Operation> {
  const op = nouvelleOperation(objectif);
  pousser(bus, op);
  return construireEtExecuter(bus, registry, op, `Objectif : ${objectif}`, reglages);
}

/** Dresse la carte puis la déroule. Commun aux deux chemins d'entrée. */
async function construireEtExecuter(
  bus: Bus,
  registry: Registry,
  op: Operation,
  promptCarte: string,
  reglages: { budget: number; revueFinale: boolean },
): Promise<Operation> {
  op.budget = Math.max(1, Math.min(20, Math.round(reglages.budget)));
  op.revueFinale = reglages.revueFinale;
  op.statut = 'carte';
  pousser(bus, op);

  op.appelsClaude++;
  op.appelsAuto++;
  const reponse = await askClaudeOnce(promptCarte, {
    systeme: SYSTEME_CARTE,
    maxTurns: 1,
  });
  op.coutUsd += reponse.coutUsd;

  if (reponse.erreur) {
    op.statut = 'echec';
    op.message = `Claude n'a pas pu dresser la carte : ${reponse.erreur}`;
    op.fin = Date.now();
    pousser(bus, op);
    return op;
  }

  const brut = extraireJson(reponse.texte);
  const etapes = brut ? normaliser(brut) : [];
  if (!etapes.length) {
    op.statut = 'echec';
    op.message = "La carte renvoyée par Claude n'était pas exploitable.";
    op.fin = Date.now();
    pousser(bus, op);
    return op;
  }

  op.titre = (brut?.titre ?? op.titre).slice(0, 90);
  op.etapes = etapes;
  op.statut = 'encours';
  pousser(bus, op);
  bus.emit({
    t: 'notice',
    level: 'info',
    text: `Carte dressée : ${etapes.length} étapes. À partir d'ici, tout se fait en local.`,
  });

  return executerCarte(bus, registry, op);
}

/**
 * Déroule une carte déjà dressée.
 * Ne lève jamais : tout échec se traduit par un statut et un message lisible.
 */
async function executerCarte(bus: Bus, registry: Registry, op: Operation): Promise<Operation> {

  // ── La marche : zéro appel Claude, sauf blocage ───────────────────────────
  // Ce que la dernière étape réussie a produit — transmis à la suivante.
  let precedent: string | undefined;

  for (const etape of op.etapes) {
    if (arrets.has(op.id)) break;

    etape.statut = 'encours';
    pousser(bus, op);
    bus.emit({
      t: 'agent.delegation',
      from: 'claude-code',
      to: etape.executant === 'hermes' ? 'hermes' : 'qwen',
      label: etape.titre.slice(0, 40),
    });

    const base = consigneAvecContexte(etape, precedent);
    let consigne = base;
    let verdict = { ok: false, detail: '' };
    let produit = '';

    // Pré-vérification : si l'état voulu est DÉJÀ là (la commande de vérif passe
    // sans qu'on ait rien fait), l'étape est acquise — on ne dérange pas
    // l'exécutant. C'est le cas des étapes de pur contrôle : ça évite l'appel
    // Hermès redondant qui, coup sur coup, se voyait « déjà occupé ».
    if (etape.verif) verdict = await verifier(etape.verif);

    // Deux tentatives en local avant de déranger Claude.
    for (let essai = 1; essai <= 2 && !verdict.ok; essai++) {
      etape.essais = essai;
      const res = await executer(bus, registry, etape, consigne, precedent);
      produit = res.texte;
      verdict = await evaluer(etape, res);
      if (!verdict.ok && essai === 1) {
        consigne = `${base}\n\nTa tentative précédente a échoué : ${verdict.detail}\nCorrige et recommence.`;
        pousser(bus, op);
      }
    }

    // Escalade : on ne rappelle Claude que là, et seulement pour une consigne.
    if (!verdict.ok && op.appelsAuto < op.budget && !arrets.has(op.id)) {
      op.appelsClaude++;
      op.appelsAuto++;
      pousser(bus, op);
      bus.emit({ t: 'notice', level: 'warn', text: `Étape bloquée — j'appelle Claude en renfort (${op.appelsAuto}/${op.budget}).` });

      const aide = await askClaudeOnce(
        `Objectif global : ${op.objectif}\n` +
          `Étape bloquée : ${etape.titre}\n` +
          `Consigne donnée : ${etape.prompt}\n` +
          `Erreur obtenue : ${verdict.detail}\n\n` +
          `Réécris la consigne pour qu'un petit modèle local y arrive. Réponds UNIQUEMENT par la nouvelle consigne, sans commentaire.`,
        { systeme: 'Tu débloques une étape. Sois bref, concret, impératif.', maxTurns: 1 },
      );
      op.coutUsd += aide.coutUsd;

      if (!aide.erreur && aide.texte) {
        etape.essais++;
        const res = await executer(bus, registry, etape, consigneAvecContexte({ ...etape, prompt: aide.texte }, precedent), precedent);
        produit = res.texte;
        verdict = await evaluer(etape, res);
      }
    }

    etape.statut = verdict.ok ? 'ok' : 'echec';
    // Pour une écriture réussie, on montre le CHEMIN écrit (« Fichier écrit :
    // /home/USER/… ») plutôt que la sortie vide de la commande de vérif — sinon
    // l'utilisateur ne sait pas où est passé son fichier.
    etape.detail = etape.executant === 'fichier' && verdict.ok && produit ? produit : verdict.detail;
    if (verdict.ok) precedent = produit || verdict.detail;
    pousser(bus, op);

    if (!verdict.ok) {
      op.statut = 'pause';
      op.message =
        op.appelsAuto >= op.budget
          ? `Budget d'appels Claude atteint (${op.budget}). L'étape « ${etape.titre} » reste bloquée.`
          : `L'étape « ${etape.titre} » a échoué : ${verdict.detail}`;
      op.fin = Date.now();
      pousser(bus, op);
      bus.emit({ t: 'notice', level: 'warn', text: op.message });
      return op;
    }
  }

  if (arrets.has(op.id)) {
    arrets.delete(op.id);
    return operations.get(op.id) ?? op;
  }

  // ── La revue finale, si elle a été demandée ───────────────────────────────
  if (op.revueFinale && op.appelsAuto < op.budget) {
    op.appelsClaude++;
    op.appelsAuto++;
    pousser(bus, op);
    const revue = await askClaudeOnce(
      `Objectif : ${op.objectif}\n\nÉtapes réalisées :\n` +
        op.etapes.map((e) => `- ${e.titre} → ${e.detail ?? 'fait'}`).join('\n') +
        `\n\nEn 5 lignes maximum : est-ce que l'objectif est atteint, et que reste-t-il à faire ?`,
      { systeme: 'Tu relis un travail terminé. Sois direct et honnête.', maxTurns: 1 },
    );
    op.coutUsd += revue.coutUsd;
    if (!revue.erreur) op.revue = revue.texte;
  }

  op.statut = 'termine';
  op.message = `${op.etapes.length} étapes réussies · ${op.appelsAuto} appel${op.appelsAuto > 1 ? 's' : ''} à Claude pour l'exécution`;
  op.fin = Date.now();
  pousser(bus, op);
  bus.emit({ t: 'notice', level: 'info', text: `Opération terminée — ${op.message}.` });
  return op;
}

/** Repart d'une opération en pause, en reprenant à la première étape non réussie. */
export async function reprendreOperation(
  bus: Bus,
  registry: Registry,
  id: string,
  budgetSupplementaire = 0,
): Promise<void> {
  const op = operations.get(id);
  if (!op || op.statut !== 'pause') return;
  op.budget += Math.max(0, Math.min(20, Math.round(budgetSupplementaire)));
  op.message = undefined;
  arrets.delete(id);

  // On relance depuis la carte déjà dressée : aucun appel Claude supplémentaire
  // n'est dépensé pour la refaire.
  const restantes = op.etapes.filter((e) => e.statut !== 'ok');
  for (const e of restantes) {
    e.statut = 'attente';
    e.essais = 0;
  }
  op.statut = 'encours';
  op.fin = undefined;
  pousser(bus, op);
  await poursuivre(bus, registry, op);
}

/** Déroule les étapes restantes d'une opération déjà cartographiée. */
async function poursuivre(bus: Bus, registry: Registry, op: Operation): Promise<void> {
  let precedent: string | undefined;
  for (const etape of op.etapes) {
    if (etape.statut === 'ok') {
      precedent = etape.detail; // on garde la trace pour l'étape suivante
      continue;
    }
    if (arrets.has(op.id)) return;

    etape.statut = 'encours';
    pousser(bus, op);
    // Même pré-vérif qu'à la première marche : un état déjà bon n'a pas à
    // repasser par l'exécutant (utile à la reprise, où le travail est souvent
    // déjà fait — c'était le cas de l'étape de vérif de flappy-hell).
    let verdict = etape.verif ? await verifier(etape.verif) : { ok: false, detail: '' };
    let res: { texte: string; erreur?: string } = { texte: '' };
    if (!verdict.ok) {
      res = await executer(bus, registry, etape, consigneAvecContexte(etape, precedent), precedent);
      verdict = await evaluer(etape, res);
    }
    etape.essais++;
    etape.statut = verdict.ok ? 'ok' : 'echec';
    etape.detail = etape.executant === 'fichier' && verdict.ok && res.texte ? res.texte : verdict.detail;
    if (verdict.ok) precedent = res.texte || verdict.detail;
    pousser(bus, op);

    if (!verdict.ok) {
      op.statut = 'pause';
      op.message = `L'étape « ${etape.titre} » bloque toujours : ${verdict.detail}`;
      op.fin = Date.now();
      pousser(bus, op);
      return;
    }
  }
  op.statut = 'termine';
  op.message = `${op.etapes.length} étapes réussies · ${op.appelsAuto} appel${op.appelsAuto > 1 ? 's' : ''} à Claude pour l'exécution`;
  op.fin = Date.now();
  pousser(bus, op);
}
