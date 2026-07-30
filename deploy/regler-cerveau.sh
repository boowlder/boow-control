#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  RÉGLAGE FIN DU CERVEAU — trouver combien de couches laisser au GPU
#
#  Le bench précédent a montré que les deux nouveaux cerveaux n'utilisent
#  qu'une partie de la carte (8,6 Go et 10,1 Go sur 16,3 Go disponibles).
#  Ce script descend le réglage « n-cpu-moe » cran par cran : plus il est bas,
#  plus le GPU travaille, plus c'est rapide — jusqu'à ce que la carte sature.
#
#  IMPORTANT : ce script ne demande PAS de mot de passe.
#  Le GPU doit déjà être libre avant de le lancer.
#
#      bash ~/models/regler-cerveau.sh
# ─────────────────────────────────────────────────────────────────────────────
set -u

PORT=8097
SRV=/home/USER/llama.cpp/build/bin/llama-server
OUT=~/models/reglage-resultats.md
LOG=/tmp/reglage-serveur.log
BUDGET=15400          # Mio : plafond VRAM, on garde ~900 Mio de marge sur 16311
Q4=/home/USER/models/qwen3.6-35b-a3b-UD-Q4_K_XL.gguf
Q3=/home/USER/models/qwen3.6-35b-a3b-UD-Q3_K_XL.gguf

nettoyer() { pkill -f "llama-server.*--port $PORT" 2>/dev/null; sleep 2; }
trap 'echo; echo "→ arrêt du serveur de test…"; nettoyer' EXIT INT TERM

vram_libre() { nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits 2>/dev/null | head -1; }

# ── Garde-fou : le GPU doit être libre ────────────────────────────────────────
utilise=$(vram_libre)
if [ -z "$utilise" ]; then echo "✗ nvidia-smi introuvable — abandon."; exit 1; fi
if [ "$utilise" -gt 2000 ]; then
  echo "✗ Le GPU est déjà occupé ($utilise Mio)."
  echo "  Libère-le d'abord :  sudo systemctl stop llama-brain"
  exit 1
fi
echo "✓ GPU libre ($utilise Mio utilisés)"
echo

# ── Les candidats à tester, du plus prudent au plus gourmand ──────────────────
#    format :  étiquette | fichier | n-cpu-moe
CANDIDATS=(
  "qualite-32|$Q4|32"
  "qualite-26|$Q4|26"
  "qualite-20|$Q4|20"
  "qualite-16|$Q4|16"
  "qualite-12|$Q4|12"
  "leger-24|$Q3|24"
  "leger-18|$Q3|18"
  "leger-12|$Q3|12"
  "leger-8|$Q3|8"
)

PROMPT="Écris un composant React d'une carte témoignage (photo, nom, texte, 5 étoiles), avec du CSS moderne. Code complet."

: > /tmp/reglage-mesures.tsv
saute_qualite=0
saute_leger=0

for c in "${CANDIDATS[@]}"; do
  IFS='|' read -r nom fichier moe <<< "$c"
  famille=${nom%%-*}
  if [ "$famille" = "qualite" ] && [ "$saute_qualite" = "1" ]; then continue; fi
  if [ "$famille" = "leger" ]   && [ "$saute_leger"   = "1" ]; then continue; fi

  echo "═══ $nom  (n-cpu-moe = $moe) ═══"
  nettoyer
  nohup "$SRV" --model "$fichier" --n-cpu-moe "$moe" \
        --n-gpu-layers 99 --ctx-size 65536 --flash-attn on --jinja --no-mmap \
        --cache-type-k q8_0 --cache-type-v q8_0 \
        --temp 0.7 --top-p 0.8 --top-k 20 \
        --host 127.0.0.1 --port $PORT > "$LOG" 2>&1 &
  pid=$!

  # Attente du chargement (jusqu'à 5 min : le fichier fait 20 Go)
  pret=0
  for i in $(seq 1 150); do
    if ! kill -0 $pid 2>/dev/null; then break; fi
    if curl -s -m 2 "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok"'; then pret=1; break; fi
    sleep 2
  done

  if [ "$pret" = "0" ]; then
    motif=$(grep -iE "out of memory|cudaMalloc|failed to allocate|ggml_backend" "$LOG" | tail -1)
    echo "  ✗ n'a pas démarré  ${motif:+— $motif}"
    printf "%s\t%s\tECHEC\t0\t0\n" "$nom" "$moe" >> /tmp/reglage-mesures.tsv
    [ "$famille" = "qualite" ] && saute_qualite=1 || saute_leger=1
    echo "  → on arrête de descendre pour « $famille »"
    echo
    continue
  fi

  sleep 3
  v=$(vram_libre)
  echo "  VRAM : $v Mio"

  if [ "$v" -gt "$BUDGET" ]; then
    echo "  ⚠ dépasse le plafond ($BUDGET Mio) — trop juste, on arrête de descendre"
    printf "%s\t%s\tTROP_GOURMAND\t%s\t0\n" "$nom" "$moe" "$v" >> /tmp/reglage-mesures.tsv
    [ "$famille" = "qualite" ] && saute_qualite=1 || saute_leger=1
    echo
    continue
  fi

  tps=$(python3 - "$PORT" "$PROMPT" <<'PY'
import json, sys, urllib.request
port, prompt = sys.argv[1], sys.argv[2]
body = {"model": "x", "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 900, "stream": False,
        "chat_template_kwargs": {"enable_thinking": False}}
req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions",
                             data=json.dumps(body).encode(),
                             headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=900) as r:
        d = json.load(r)
    t = d.get("timings") or {}
    print(f'{t.get("predicted_per_second", 0):.1f}')
except Exception:
    print("0")
PY
)
  echo "  vitesse : $tps t/s"
  printf "%s\t%s\tOK\t%s\t%s\n" "$nom" "$moe" "$v" "$tps" >> /tmp/reglage-mesures.tsv
  echo
done

nettoyer

# ── Rapport ───────────────────────────────────────────────────────────────────
python3 - "$OUT" <<'PY'
import sys
out = sys.argv[1]
lignes = []
for l in open("/tmp/reglage-mesures.tsv"):
    p = l.rstrip("\n").split("\t")
    if len(p) == 5:
        lignes.append({"nom": p[0], "moe": int(p[1]), "etat": p[2],
                       "vram": int(p[3]), "tps": float(p[4])})

ok = [x for x in lignes if x["etat"] == "OK" and x["tps"] > 0]
def best(prefixe):
    c = [x for x in ok if x["nom"].startswith(prefixe)]
    return max(c, key=lambda x: x["tps"]) if c else None

bq, bl = best("qualite"), best("leger")

with open(out, "w") as f:
    f.write("# Réglage fin du cerveau — combien donner au GPU\n\n")
    f.write("Plus « couches CPU » est bas, plus le GPU travaille et plus c'est rapide,\n")
    f.write("jusqu'à saturation de la carte (16,3 Go).\n\n")
    f.write("Mesuré avec la vraie mémoire de conversation de production (64k), ")
    f.write("pas celle du bench de la nuit (32k) — d'où des chiffres VRAM plus hauts.\n\n")
    f.write("| Réglage | Couches CPU | VRAM | Vitesse |\n|---|---|---|---|\n")
    for x in lignes:
        etat = {"OK": f"{x['tps']} t/s", "ECHEC": "n'a pas démarré",
                "TROP_GOURMAND": "dépasse le plafond"}[x["etat"]]
        vram = f"{x['vram']} Mio" if x["vram"] else "—"
        f.write(f"| {x['nom']} | {x['moe']} | {vram} | {etat} |\n")
    f.write("\n## Meilleur de chaque famille\n\n")
    for nom, b in (("Qualité (Q4)", bq), ("Léger (Q3)", bl)):
        if b:
            f.write(f"- **{nom}** : n-cpu-moe = **{b['moe']}** → {b['tps']} t/s, {b['vram']} Mio\n")
        else:
            f.write(f"- **{nom}** : aucun réglage exploitable\n")
    if bq and bl:
        gagnant = bq if bq["tps"] >= bl["tps"] * 0.9 else bl
        f.write(f"\n> **Recommandation** : `{gagnant['nom']}` "
                f"(n-cpu-moe {gagnant['moe']}, {gagnant['tps']} t/s, {gagnant['vram']} Mio).\n")
        f.write("> À qualité proche on préfère le Q4 : il réfléchit mieux.\n")
print("rapport écrit :", out)
PY

echo
echo "════════════════════════════════════════════════"
echo "  Résultats : $OUT"
echo "  ⚠ Le cerveau n'est PAS relancé — c'est normal,"
echo "     l'étape suivante installe le routeur à sa place."
echo "════════════════════════════════════════════════"
