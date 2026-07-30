import { config } from '../config';
import { nowLine } from '../now';

// Appel direct à un cerveau local, hors conversation.
//
// Le chat (qwen.ts) diffuse token par token sur le bus, ce qui est parfait pour
// une discussion mais pas pour un moteur qui a juste besoin du résultat. Ici on
// demande, on attend, on rend le texte. Le mode opération s'en sert pour chaque
// étape confiée à un modèle local.

export interface ReponseLocale {
  texte: string;
  erreur?: string;
}

/** Interroge un cerveau local et rend la réponse complète. */
export async function demanderAuCerveau(
  prompt: string,
  opts: {
    /** Section du routeur à utiliser. Par défaut : le cerveau principal. */
    model?: string;
    /** Laisser le modèle réfléchir à voix haute avant de répondre. */
    reflechir?: boolean;
    systeme?: string;
    maxTokens?: number;
    signal?: AbortSignal;
  } = {},
): Promise<ReponseLocale> {
  const model = opts.model ?? config.brains.coder;
  const messages = [
    { role: 'system', content: `${opts.systeme ?? 'Tu es un exécutant précis.'}\n${nowLine()}` },
    { role: 'user', content: prompt },
  ];

  try {
    const res = await fetch(`${config.endpoints.brain}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(opts.signal ? { signal: opts.signal } : {}),
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        temperature: 0.3,
        // Assez pour une page complète (HTML+CSS+JS) sans se couper en plein
        // milieu — le cas d'usage typique d'une étape « rédige le code ».
        max_tokens: opts.maxTokens ?? 4000,
        // Le garde-fou anti-répétition du preset s'applique déjà, mais on le
        // rappelle ici : un exécutant qui boucle produit du charabia.
        repeat_penalty: 1.1,
        chat_template_kwargs: { enable_thinking: opts.reflechir ?? false },
      }),
    });
    if (!res.ok) return { texte: '', erreur: `le cerveau local a répondu HTTP ${res.status}` };

    const d = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const texte = (d.choices?.[0]?.message?.content ?? '').trim();
    if (!texte) return { texte: '', erreur: 'le cerveau local a renvoyé une réponse vide' };
    return { texte };
  } catch (e) {
    const err = e as Error;
    if (err.name === 'AbortError') return { texte: '', erreur: 'annulé' };
    return { texte: '', erreur: err.message || 'cerveau local injoignable' };
  }
}
