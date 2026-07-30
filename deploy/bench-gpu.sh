#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  BENCH GPU — ancien cerveau 30B  vs  nouveau 35B
#  Mesure ce que le bench CPU de la nuit ne pouvait pas : vitesse réelle + VRAM.
#
#  À LANCER EN UNE FOIS :   bash ~/models/bench-gpu.sh
#  (il demandera ton mot de passe : il doit arrêter llama-brain pour libérer
#   le GPU, puis le remet en marche à la fin, quoi qu'il arrive)
# ─────────────────────────────────────────────────────────────────────────────
set -u
PORT=8097
INI=/tmp/bench-gpu.ini
OUT=~/models/bench-gpu-resultats.md
SRV=/home/USER/llama.cpp/build/bin/llama-server

# Remet TOUJOURS le cerveau d'origine en marche, même en cas d'interruption.
restaurer() {
  echo; echo "→ remise en marche du cerveau d'origine…"
  pkill -f "port $PORT" 2>/dev/null
  sudo systemctl start llama-brain
  sleep 5
  curl -s -m 5 http://127.0.0.1:8080/health >/dev/null && echo "  ✓ llama-brain de nouveau en ligne" \
                                                       || echo "  ⚠ llama-brain n'a pas redémarré — lance : sudo systemctl start llama-brain"
}
trap restaurer EXIT INT TERM

cat > $INI <<'EOF'
[*]
flash-attn   = on
jinja        = 1
mmap         = 0
n-gpu-layers = 99
ctx-size     = 32768
cache-type-k = q8_0
cache-type-v = q8_0
temp         = 0.7
top-p        = 0.8
top-k        = 20

[ancien-30b]
hf        = unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:UD-Q4_K_XL
n-cpu-moe = 22

[nouveau-35b]
model     = /home/USER/models/qwen3.6-35b-a3b-UD-Q4_K_XL.gguf
n-cpu-moe = 32

[nouveau-35b-leger]
model     = /home/USER/models/qwen3.6-35b-a3b-UD-Q3_K_XL.gguf
n-cpu-moe = 24
EOF

echo "→ arrêt du cerveau actuel pour libérer le GPU…"
sudo systemctl stop llama-brain || { echo "impossible d'arrêter llama-brain"; exit 1; }
sleep 4

echo "→ démarrage du routeur sur le port $PORT…"
nohup $SRV --models-preset $INI --models-max 1 --host 127.0.0.1 --port $PORT > /tmp/bench-gpu-server.log 2>&1 &
for i in $(seq 1 30); do curl -s -m 2 http://127.0.0.1:$PORT/models >/dev/null 2>&1 && break; sleep 2; done

python3 - "$PORT" "$OUT" <<'PY'
import json, sys, time, urllib.request, subprocess
port, out = sys.argv[1], sys.argv[2]
URL = f"http://127.0.0.1:{port}/v1/chat/completions"

PROMPTS = [
    ("Court",  "Explique en 2 phrases ce qu'est une API.", 120),
    ("Code",   "Écris un composant React d'une carte témoignage (photo, nom, texte, 5 étoiles), "
               "avec du CSS moderne. Code complet.", 900),
    ("Long",   "Rédige un plan détaillé pour refaire la page d'accueil d'un site de restaurant.", 700),
]

def vram():
    try:
        r = subprocess.run(["nvidia-smi","--query-gpu=memory.used","--format=csv,noheader,nounits"],
                           capture_output=True, text=True, timeout=10)
        return int(r.stdout.strip().split("\n")[0])
    except Exception:
        return -1

def ask(model, prompt, mt, think=False):
    body = {"model": model, "messages":[{"role":"user","content":prompt}],
            "max_tokens": mt, "stream": False}
    if not think:
        body["chat_template_kwargs"] = {"enable_thinking": False}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(),
                                 headers={"Content-Type":"application/json"})
    t0=time.time()
    with urllib.request.urlopen(req, timeout=1200) as r: d=json.load(r)
    return d, time.time()-t0

res={}
for model in ["ancien-30b","nouveau-35b","nouveau-35b-leger"]:
    print(f"\n=== {model} ===", flush=True)
    # chargement + mesure VRAM
    try:
        ask(model,"ok",8)
    except Exception as e:
        print("  échec de chargement :",e); res[model]={"erreur":str(e)}; continue
    time.sleep(3); v=vram(); print(f"  VRAM utilisée : {v} Mio", flush=True)
    lignes=[]
    for titre,p,mt in PROMPTS:
        try:
            d,wall=ask(model,p,mt)
            t=d.get("timings") or {}
            txt=(d.get("choices") or [{}])[0].get("message",{}).get("content","") or ""
            lignes.append({"titre":titre,"tps":round(t.get("predicted_per_second",0),1),
                           "pp":round(t.get("prompt_per_second",0),1),
                           "tok":t.get("predicted_n",0),"wall":round(wall,1),"txt":txt[:1200]})
            print(f"  {titre:<7} {lignes[-1]['tps']:>6} t/s  ({lignes[-1]['tok']} tokens)", flush=True)
        except Exception as e:
            lignes.append({"titre":titre,"erreur":str(e)}); print(f"  {titre}: ÉCHEC {e}")
    res[model]={"vram":v,"taches":lignes}

with open(out,"w") as f:
    f.write("# Bench GPU — quel cerveau garder ?\n\n## Résumé chiffré\n\n")
    f.write("| Cerveau | VRAM | Court | Code | Long |\n|---|---|---|---|---|\n")
    for m,d in res.items():
        if "erreur" in d: f.write(f"| {m} | ÉCHEC | | | |\n"); continue
        g=lambda t:next((f"{x['tps']} t/s" for x in d["taches"] if x["titre"]==t and "tps" in x),"—")
        f.write(f"| {m} | {d['vram']} Mio | {g('Court')} | {g('Code')} | {g('Long')} |\n")
    f.write("\n> Règle de décision : le 35B ne gagne que s'il est au moins aussi bon\n"
            "> ET pas plus gourmand (VRAM ≤ 15 500 Mio, vitesse ≥ 85 % de l'ancien).\n")
    for m,d in res.items():
        if "erreur" in d: continue
        f.write(f"\n---\n\n## {m} — réponses\n")
        for x in d["taches"]:
            if "erreur" in x: f.write(f"\n### {x['titre']}\nÉCHEC : {x['erreur']}\n"); continue
            f.write(f"\n### {x['titre']}\n*{x['tps']} t/s · {x['tok']} tokens · {x['wall']}s*\n\n```\n{x['txt'].strip()}\n```\n")
print("\n=== rapport écrit ===", out)
PY

echo
echo "════════════════════════════════════════════════"
echo "  Résultats : $OUT"
echo "════════════════════════════════════════════════"
