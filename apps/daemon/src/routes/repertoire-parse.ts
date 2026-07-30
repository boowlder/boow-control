// Lecture des sorties du CLI `claude` et validation des entrées du navigateur.
//
// Sans dépendance, à part pour deux raisons : ces fonctions se testent
// directement, et surtout ce sont elles qui décident ce qui part dans un
// `execFile`. Une validation trop lâche ici, et une valeur venue du navigateur
// devient un argument de commande.

export interface ConnecteurInfo {
  nom: string;
  cible: string;
  /**
   * `ok` connecté · `auth` demande une connexion · `ko` en échec ·
   * `inconnu` lu dans la config, santé pas encore contrôlée (l'affichage
   * instantané, pendant que le vrai contrôle tourne en arrière-plan).
   */
  etat: 'ok' | 'auth' | 'ko' | 'inconnu';
  detail: string;
}

/**
 * Analyse la sortie de `claude mcp list`.
 *
 * Une ligne ressemble à `nom: https://… - ✔ Connected`. Cette commande n'a pas
 * de sortie JSON, d'où le découpage — fait sur la DERNIÈRE occurrence de « - »,
 * parce qu'une URL ou une commande en contient souvent.
 */
export function analyserMcp(stdout: string): ConnecteurInfo[] {
  const out: ConnecteurInfo[] = [];
  for (const brut of stdout.split('\n')) {
    const ligne = brut.trim();
    const sep = ligne.lastIndexOf(' - ');
    if (sep < 0) continue;
    const gauche = ligne.slice(0, sep);
    const etatTexte = ligne.slice(sep + 3).trim();
    const deuxPoints = gauche.indexOf(': ');
    if (deuxPoints < 0) continue;
    const nom = gauche.slice(0, deuxPoints).trim();
    const cible = gauche.slice(deuxPoints + 2).trim();
    if (!nom || !cible) continue;
    // Dans le doute, on n'annonce pas qu'un connecteur fonctionne.
    const etat: ConnecteurInfo['etat'] = /connected/i.test(etatTexte)
      ? 'ok'
      : /auth/i.test(etatTexte)
        ? 'auth'
        : 'ko';
    out.push({ nom, cible, etat, detail: etatTexte });
  }
  return out;
}

/** Rejette ce qui n'a rien à faire dans un nom de serveur ou de plugin. */
export function nomValide(v: unknown): v is string {
  return typeof v === 'string' && /^[\w@./-]{1,120}$/.test(v);
}

/** Une source de place de marché : `proprio/depot`, une URL, ou un chemin. */
export function sourceValide(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 300 || !v.trim()) return false;
  return /^[\w.@:/~-]+$/.test(v.trim());
}

/** L'adresse d'un connecteur. Pas de saut de ligne : il injecterait une entrée. */
export function cibleValide(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= 500 && !/[\n\r]/.test(v);
}
