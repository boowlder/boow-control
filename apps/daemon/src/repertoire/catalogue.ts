// Le catalogue de connecteurs — le cœur du chantier 12. Curé à la main et
// versionné (pas recopié d'un annuaire qui périmerait), il répond à une
// question que le CLI `claude` ne pose jamais : « qu'est-ce que MES cerveaux
// locaux peuvent faire, et comment ? ». Trois types de connecteurs :
//   ① local  — un programme stdio sans clé (gratuit, tourne sur les locaux)
//   ② jeton  — un serveur qui marche avec une clé/un jeton à coller (locaux)
//   ③ oauth  — un serveur distant OAuth, réservé à Claude
// La clé de voûte : pour un ③, proposer sa voie ② quand elle existe (GitHub →
// jeton perso, Gmail → mot de passe d'app + IMAP…), ce qui rend ~80 % de la
// liste accessible aux LOCAUX.
//
// PRUDENCE : phase 1, ce fichier ne fait que DÉCRIRE. Rien n'est exécuté tant
// que l'installation (phase 2) n'est pas branchée — les recettes stdio seront
// re-vérifiées avant d'être lancées.

export type Main = 'claude' | 'locaux' | 'hermes';
export type TypeConn = 'local' | 'jeton' | 'oauth'; // ① ② ③

/** Un secret que l'utilisateur doit fournir pour un connecteur ② (jeton). */
export interface SecretRequis {
  /** Nom de la variable d'environnement passée au serveur (ex: GITHUB_PERSONAL_ACCESS_TOKEN). */
  cle: string;
  /** Libellé lisible dans le formulaire. */
  libelle: string;
  /** Où et comment l'obtenir, en une phrase. */
  aide: string;
}

/** Comment brancher le connecteur sur les LOCAUX (stdio ou HTTP). */
export interface RecetteLocale {
  transport: 'stdio' | 'http';
  command?: string; // stdio : le programme (npx, uvx…)
  args?: string[]; // stdio : ses arguments ; `{cwd}` sera remplacé par le dossier
  url?: string; // http : l'adresse du serveur MCP
  /** Clés à coller (connecteur ②). Vide/absent = ① sans clé. */
  secrets?: SecretRequis[];
}

export interface Connecteur {
  id: string;
  nom: string;
  categorie: string;
  logo: string; // emoji court
  description: string;
  /** Ce que ce connecteur sait faire (① ② ③). */
  types: TypeConn[];
  /** Les mains qui PEUVENT s'en servir (les autres cases sont grisées). */
  mains: Main[];
  /** Recette locale, présente pour ① et ②. */
  local?: RecetteLocale;
  /** La note ③→② : comment passer l'OAuth en jeton collable. */
  alternativeJeton?: string;
  /** Pour un ③ : comment l'activer côté Claude. */
  oauthNote?: string;
  /** Compétence (SKILL) suggérée avec ce connecteur (rejoint 9.4). */
  competence?: string;
  /** Mise en garde honnête (paquet figé, réglage particulier…). */
  note?: string;
}

/** Catégories, dans l'ordre d'affichage. */
export const CATEGORIES = [
  'Fichiers & mémoire',
  'Développement',
  'Données',
  'Recherche & web',
  'Mail',
  'Productivité',
  'Design',
  'Voyage',
  'Automatisation',
] as const;

// Seed curé. Les ① (sans clé) sont les serveurs de référence officiels, sûrs et
// stables. Les ② portent le nom EXACT de la variable d'environnement attendue.
// À étendre (objectif ~50-80) ; les recettes stdio seront re-vérifiées avant
// d'être exécutées en phase 2.
export const CATALOGUE: Connecteur[] = [
  // ── Fichiers & mémoire ──────────────────────────────────────────────
  {
    id: 'filesystem',
    nom: 'Fichiers',
    categorie: 'Fichiers & mémoire',
    logo: '📁',
    description: 'Lire et écrire dans un dossier autorisé — au-delà des outils fichiers natifs.',
    types: ['local'],
    mains: ['locaux', 'hermes', 'claude'],
    local: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '{cwd}'] },
  },
  {
    id: 'memory',
    nom: 'Mémoire (graphe)',
    categorie: 'Fichiers & mémoire',
    logo: '🧠',
    description: 'Un graphe de connaissances persistant : se souvenir de faits d’une session à l’autre.',
    types: ['local'],
    mains: ['locaux', 'claude'],
    local: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
  },
  {
    id: 'fetch',
    nom: 'Lire une page',
    categorie: 'Fichiers & mémoire',
    logo: '🌐',
    description: 'Récupérer le contenu d’une URL et le convertir en texte lisible.',
    types: ['local'],
    mains: ['locaux', 'claude'],
    local: { transport: 'stdio', command: 'uvx', args: ['mcp-server-fetch'] },
  },

  {
    id: 'pdf-reader',
    nom: 'Lecteur PDF',
    categorie: 'Fichiers & mémoire',
    logo: '📄',
    description: 'Lire et extraire le texte de fichiers PDF locaux ou distants.',
    types: ['local'],
    mains: ['locaux', 'claude'],
    local: { transport: 'stdio', command: 'npx', args: ['-y', '@sylphlab/pdf-reader-mcp'] },
  },

  // ── Développement ───────────────────────────────────────────────────
  {
    id: 'git',
    nom: 'Git',
    categorie: 'Développement',
    logo: '🔧',
    description: 'Historique, diff, statut, commits sur un dépôt local.',
    types: ['local'],
    mains: ['locaux', 'hermes'],
    local: { transport: 'stdio', command: 'uvx', args: ['mcp-server-git', '--repository', '{cwd}'] },
    competence: 'git-hygiene',
  },
  {
    id: 'github',
    nom: 'GitHub',
    categorie: 'Développement',
    logo: '🐙',
    description: 'Dépôts, issues, pull requests, recherche de code sur GitHub.',
    types: ['jeton', 'oauth'],
    mains: ['locaux', 'hermes', 'claude'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      secrets: [
        {
          cle: 'GITHUB_PERSONAL_ACCESS_TOKEN',
          libelle: 'Jeton d’accès personnel',
          aide: 'GitHub ▸ Settings ▸ Developer settings ▸ Personal access tokens ▸ Fine-grained. Coche les dépôts voulus.',
        },
      ],
    },
    alternativeJeton: 'Plutôt que l’OAuth de Claude, un jeton perso (PAT) donne le même accès à tes LOCAUX. C’est la voie ③→② de référence.',
    oauthNote: 'Disponible aussi en OAuth sur ton compte claude.ai (rien à coller, mais réservé à Claude).',
    note: 'Paquet officiel figé (déprécié) mais fonctionnel avec un PAT.',
  },
  {
    id: 'gitlab',
    nom: 'GitLab',
    categorie: 'Développement',
    logo: '🦊',
    description: 'Projets, issues et merge requests sur GitLab.',
    types: ['jeton'],
    mains: ['locaux', 'hermes'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-gitlab'],
      secrets: [{ cle: 'GITLAB_PERSONAL_ACCESS_TOKEN', libelle: 'Jeton d’accès', aide: 'GitLab ▸ Préférences ▸ Access Tokens (scope api).' }],
    },
    note: 'Paquet officiel figé (déprécié) mais fonctionnel avec un jeton.',
  },
  {
    id: 'sentry',
    nom: 'Sentry',
    categorie: 'Développement',
    logo: '🚨',
    description: 'Récupérer et analyser les erreurs remontées par Sentry.',
    types: ['jeton'],
    mains: ['locaux', 'claude'],
    local: {
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-sentry'],
      secrets: [{ cle: 'SENTRY_AUTH_TOKEN', libelle: 'Jeton d’authentification', aide: 'Sentry ▸ Settings ▸ Auth Tokens.' }],
    },
  },

  {
    id: 'context7',
    nom: 'Context7 (docs)',
    categorie: 'Développement',
    logo: '📚',
    description: 'Documentation À JOUR des bibliothèques (React, etc.), injectée à la demande.',
    types: ['local'],
    mains: ['locaux', 'claude'],
    local: { transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] },
  },

  // ── Données ─────────────────────────────────────────────────────────
  {
    id: 'postgres',
    nom: 'PostgreSQL',
    categorie: 'Données',
    logo: '🐘',
    description: 'Interroger une base Postgres en lecture (schéma + requêtes), mode restreint.',
    types: ['jeton'],
    mains: ['locaux', 'hermes'],
    local: {
      transport: 'stdio',
      command: 'uvx',
      args: ['postgres-mcp', '--access-mode=restricted'],
      secrets: [{ cle: 'DATABASE_URI', libelle: 'Chaîne de connexion', aide: 'postgres://utilisateur:motdepasse@hôte:5432/base' }],
    },
    alternativeJeton: 'Une base = une chaîne de connexion à coller. Aucune OAuth : directement utilisable par les locaux.',
  },
  {
    id: 'sqlite',
    nom: 'SQLite',
    categorie: 'Données',
    logo: '🗃️',
    description: 'Lire et interroger un fichier de base SQLite local.',
    types: ['local'],
    mains: ['locaux', 'hermes'],
    local: { transport: 'stdio', command: 'uvx', args: ['mcp-server-sqlite', '--db-path', '{cwd}/base.db'] },
  },

  // ── Recherche & web ─────────────────────────────────────────────────
  {
    id: 'brave-search',
    nom: 'Brave Search',
    categorie: 'Recherche & web',
    logo: '🔎',
    description: 'Recherche web via l’API Brave (alternative payante à la recherche Chrome native).',
    types: ['jeton'],
    mains: ['locaux', 'claude'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@brave/brave-search-mcp-server'],
      secrets: [{ cle: 'BRAVE_API_KEY', libelle: 'Clé API Brave', aide: 'api-dashboard.search.brave.com — offre gratuite limitée.' }],
    },
  },
  {
    id: 'google-maps',
    nom: 'Google Maps',
    categorie: 'Recherche & web',
    logo: '🗺️',
    description: 'Géocodage, itinéraires, lieux à proximité.',
    types: ['jeton'],
    mains: ['locaux', 'claude'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-google-maps'],
      secrets: [{ cle: 'GOOGLE_MAPS_API_KEY', libelle: 'Clé API Maps', aide: 'Google Cloud Console ▸ APIs ▸ Maps.' }],
    },
    note: 'Paquet officiel figé (déprécié) mais fonctionnel avec une clé.',
  },
  {
    id: 'playwright',
    nom: 'Navigateur (Playwright)',
    categorie: 'Recherche & web',
    logo: '🕹️',
    description: 'Piloter un navigateur : ouvrir des pages, cliquer, remplir, capturer.',
    types: ['local'],
    mains: ['locaux', 'hermes'],
    local: { transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
    competence: 'navigation-web',
  },

  // ── Mail ────────────────────────────────────────────────────────────
  {
    id: 'gmail',
    nom: 'Gmail',
    categorie: 'Mail',
    logo: '📬',
    description: 'Lire, chercher, trier et répondre à tes mails Gmail.',
    types: ['oauth'],
    mains: ['claude'],
    oauthNote: 'Voie OAuth « Gmail » sur ton compte claude.ai (côté Claude).',
    note: 'Un accès LOCAL au mail existe (serveurs Gmail/IMAP) mais demande un réglage OAuth en une fois — pas encore vérifié ici. À câbler proprement plus tard.',
    competence: 'triage-mail',
  },

  // ── Productivité ────────────────────────────────────────────────────
  {
    id: 'notion',
    nom: 'Notion',
    categorie: 'Productivité',
    logo: '📝',
    description: 'Lire et écrire dans tes pages et bases Notion.',
    types: ['jeton', 'oauth'],
    mains: ['locaux', 'claude'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@notionhq/notion-mcp-server'],
      secrets: [{ cle: 'NOTION_TOKEN', libelle: 'Jeton d’intégration', aide: 'notion.so/my-integrations ▸ New integration, puis partage la page avec elle.' }],
    },
    alternativeJeton: 'Un jeton d’intégration Notion remplace l’OAuth pour tes locaux.',
  },
  {
    id: 'slack',
    nom: 'Slack',
    categorie: 'Productivité',
    logo: '💬',
    description: 'Lire les canaux, poster des messages, chercher dans l’historique.',
    types: ['jeton', 'oauth'],
    mains: ['locaux', 'claude'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-slack'],
      secrets: [
        { cle: 'SLACK_BOT_TOKEN', libelle: 'Jeton du bot', aide: 'api.slack.com/apps ▸ ton app ▸ OAuth ▸ Bot User OAuth Token (xoxb-…).' },
        { cle: 'SLACK_TEAM_ID', libelle: 'ID de l’espace', aide: 'Commence par T… (URL de l’espace ou réglages).' },
      ],
    },
    alternativeJeton: 'Un jeton de bot Slack (xoxb-) donne l’accès aux locaux, sans OAuth.',
    note: 'Paquet officiel figé (déprécié) mais fonctionnel avec un jeton de bot.',
  },
  {
    id: 'todoist',
    nom: 'Todoist',
    categorie: 'Productivité',
    logo: '✅',
    description: 'Tâches, projets et échéances Todoist.',
    types: ['jeton'],
    mains: ['locaux', 'claude'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@abhiz123/todoist-mcp-server'],
      secrets: [{ cle: 'TODOIST_API_TOKEN', libelle: 'Jeton API', aide: 'Todoist ▸ Paramètres ▸ Intégrations ▸ API token.' }],
    },
  },

  // ── Design ──────────────────────────────────────────────────────────
  {
    id: 'figma',
    nom: 'Figma',
    categorie: 'Design',
    logo: '🎨',
    description: 'Lire les fichiers et variables de design Figma.',
    types: ['jeton', 'oauth'],
    mains: ['locaux', 'claude'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'figma-developer-mcp', '--stdio'],
      secrets: [{ cle: 'FIGMA_API_KEY', libelle: 'Jeton personnel', aide: 'Figma ▸ Settings ▸ Personal access tokens.' }],
    },
    alternativeJeton: 'Un jeton personnel Figma remplace l’OAuth pour la lecture des designs.',
  },

  // ── Automatisation ──────────────────────────────────────────────────
  {
    id: 'time',
    nom: 'Heure & fuseaux',
    categorie: 'Automatisation',
    logo: '🕐',
    description: 'Heure courante et conversions de fuseaux horaires.',
    types: ['local'],
    mains: ['locaux', 'claude'],
    local: { transport: 'stdio', command: 'uvx', args: ['mcp-server-time'] },
  },
  {
    id: 'sequential-thinking',
    nom: 'Réflexion séquentielle',
    categorie: 'Automatisation',
    logo: '🧩',
    description: 'Aide le modèle à décomposer un problème en étapes vérifiables.',
    types: ['local'],
    mains: ['locaux', 'claude'],
    local: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
  },
  {
    id: 'calculator',
    nom: 'Calculatrice',
    categorie: 'Automatisation',
    logo: '🧮',
    description: 'Évalue des expressions mathématiques exactes (là où un LLM se trompe).',
    types: ['local'],
    mains: ['locaux', 'claude'],
    local: { transport: 'stdio', command: 'uvx', args: ['mcp-server-calculator'] },
  },

  // ── Fournée vérifiée le 25/07/2026 (existence + config confirmées) ──────
  {
    id: 'youtube-transcript',
    nom: 'Transcription YouTube',
    categorie: 'Recherche & web',
    logo: '▶️',
    description: 'Récupère la transcription d’une vidéo YouTube pour la résumer/analyser.',
    types: ['local'],
    mains: ['locaux', 'claude'],
    local: { transport: 'stdio', command: 'npx', args: ['-y', '@kimtaeyoon83/mcp-server-youtube-transcript'] },
  },
  {
    id: 'tavily',
    nom: 'Tavily (recherche)',
    categorie: 'Recherche & web',
    logo: '🔍',
    description: 'Recherche web orientée IA, avec extraction de contenu propre.',
    types: ['jeton'],
    mains: ['locaux', 'claude'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'tavily-mcp'],
      secrets: [{ cle: 'TAVILY_API_KEY', libelle: 'Clé API Tavily', aide: 'app.tavily.com — offre gratuite (1000 requêtes/mois).' }],
    },
  },
  {
    id: 'exa',
    nom: 'Exa (recherche)',
    categorie: 'Recherche & web',
    logo: '🧭',
    description: 'Recherche web sémantique de haute qualité, pensée pour les agents.',
    types: ['jeton'],
    mains: ['locaux', 'claude'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'exa-mcp-server'],
      secrets: [{ cle: 'EXA_API_KEY', libelle: 'Clé API Exa', aide: 'dashboard.exa.ai ▸ API Keys.' }],
    },
  },
  {
    id: 'firecrawl',
    nom: 'Firecrawl (scraping)',
    categorie: 'Recherche & web',
    logo: '🕷️',
    description: 'Aspire un site entier en Markdown propre (crawl + extraction).',
    types: ['jeton'],
    mains: ['locaux', 'claude'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'firecrawl-mcp'],
      secrets: [{ cle: 'FIRECRAWL_API_KEY', libelle: 'Clé API Firecrawl', aide: 'firecrawl.dev ▸ API Keys.' }],
    },
  },
  {
    id: 'mongodb',
    nom: 'MongoDB',
    categorie: 'Données',
    logo: '🍃',
    description: 'Interroger une base MongoDB (collections, documents, agrégations).',
    types: ['jeton'],
    mains: ['locaux', 'hermes'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'mongodb-mcp-server'],
      secrets: [{ cle: 'MDB_MCP_CONNECTION_STRING', libelle: 'Chaîne de connexion', aide: 'mongodb+srv://utilisateur:motdepasse@cluster/base' }],
    },
    alternativeJeton: 'Une chaîne de connexion à coller, aucune OAuth : utilisable par les locaux.',
  },
  {
    id: 'airtable',
    nom: 'Airtable',
    categorie: 'Données',
    logo: '🧱',
    description: 'Lire et écrire dans tes bases Airtable.',
    types: ['jeton'],
    mains: ['locaux', 'claude'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'airtable-mcp-server'],
      secrets: [{ cle: 'AIRTABLE_API_KEY', libelle: 'Jeton d’accès', aide: 'airtable.com/create/tokens (Personal access token).' }],
    },
  },
  {
    id: 'excel',
    nom: 'Excel',
    categorie: 'Données',
    logo: '📊',
    description: 'Lire et écrire des fichiers Excel (.xlsx) locaux.',
    types: ['local'],
    mains: ['locaux', 'hermes'],
    local: { transport: 'stdio', command: 'npx', args: ['-y', '@negokaz/excel-mcp-server'] },
  },
  {
    id: 'kubernetes',
    nom: 'Kubernetes',
    categorie: 'Développement',
    logo: '☸️',
    description: 'Piloter un cluster k8s via ton kubeconfig local (pods, services, logs).',
    types: ['local'],
    mains: ['locaux', 'hermes'],
    local: { transport: 'stdio', command: 'npx', args: ['-y', 'mcp-server-kubernetes'] },
    note: 'Utilise ton ~/.kube/config existant. Réserve-le à un contexte de confiance.',
  },
  {
    id: 'stripe',
    nom: 'Stripe',
    categorie: 'Productivité',
    logo: '💳',
    description: 'Paiements, clients, factures et produits Stripe.',
    types: ['jeton'],
    mains: ['locaux', 'claude'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@stripe/mcp', '--tools=all'],
      secrets: [{ cle: 'STRIPE_SECRET_KEY', libelle: 'Clé secrète', aide: 'dashboard.stripe.com ▸ Developers ▸ API keys (sk_… — mode test conseillé).' }],
    },
  },
  {
    id: 'jira',
    nom: 'Jira & Confluence',
    categorie: 'Productivité',
    logo: '📋',
    description: 'Tickets Jira et pages Confluence (Atlassian).',
    types: ['jeton'],
    mains: ['locaux', 'claude'],
    local: {
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-atlassian'],
      secrets: [
        { cle: 'JIRA_URL', libelle: 'URL Jira', aide: 'https://ton-espace.atlassian.net' },
        { cle: 'JIRA_USERNAME', libelle: 'E-mail du compte', aide: 'Ton adresse Atlassian.' },
        { cle: 'JIRA_API_TOKEN', libelle: 'Jeton API', aide: 'id.atlassian.com ▸ Security ▸ API tokens.' },
      ],
    },
  },
  {
    id: 'apify',
    nom: 'Apify (agents web)',
    categorie: 'Automatisation',
    logo: '🤖',
    description: 'Lancer des « actors » Apify : scraping, extraction, automatisations prêtes.',
    types: ['jeton'],
    mains: ['locaux', 'claude'],
    local: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@apify/actors-mcp-server'],
      secrets: [{ cle: 'APIFY_TOKEN', libelle: 'Jeton Apify', aide: 'console.apify.com ▸ Settings ▸ Integrations.' }],
    },
  },
];

export function connecteurParId(id: string): Connecteur | undefined {
  return CATALOGUE.find((c) => c.id === id);
}

/** Une définition de serveur MCP prête à écrire dans ~/.boow/mcp.json. */
export interface DefResolue {
  nom: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
}

/**
 * Résout la recette locale d'un connecteur en définition concrète : remplace
 * `{cwd}` par le dossier de travail et les `{CLE}` par les secrets collés (usage
 * en argument, ex. chaîne Postgres). Les secrets NON utilisés en argument
 * partent en variables d'environnement. Rend `null` si pas de recette locale.
 */
export function resoudreRecette(c: Connecteur, valeurs: Record<string, string>, cwd: string): DefResolue | null {
  const r = c.local;
  if (!r) return null;
  const subst = (s: string) =>
    s.replace(/\{cwd\}/g, cwd).replace(/\{(\w+)\}/g, (m, k: string) => (k in valeurs ? valeurs[k] : m));
  const args = (r.args ?? []).map(subst);
  const enArg = (cle: string) => (r.args ?? []).some((a) => a.includes(`{${cle}}`));
  const env: Record<string, string> = {};
  for (const s of r.secrets ?? []) if (!enArg(s.cle) && valeurs[s.cle]) env[s.cle] = valeurs[s.cle];
  return {
    nom: c.id,
    command: r.command,
    args: args.length ? args : undefined,
    url: r.url ? subst(r.url) : undefined,
    env: Object.keys(env).length ? env : undefined,
  };
}

/** Compteurs pour l'UI / la recette. */
export function resumeCatalogue() {
  const parType = (t: TypeConn) => CATALOGUE.filter((c) => c.types.includes(t)).length;
  return {
    total: CATALOGUE.length,
    categories: CATEGORIES.length,
    local: parType('local'),
    jeton: parType('jeton'),
    oauth: parType('oauth'),
    utilisablesLocaux: CATALOGUE.filter((c) => c.mains.includes('locaux')).length,
  };
}
