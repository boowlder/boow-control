#!/bin/bash
# Téléchargement des nouveaux modèles (chantier 2, étape 2.3).
# Fichiers explicites dans ~/models/ : faciles à inventorier et à SUPPRIMER
# réellement, contrairement au cache HuggingFace (blobs + liens symboliques).
set -u
cd "$(dirname "$0")" || exit 1

get() {  # get <repo> <fichier distant> <nom local>
  local repo="$1" remote="$2" out="$3"
  if [ -f "$out" ]; then
    echo "[=] $out déjà présent ($(du -h "$out" | cut -f1))"
    return 0
  fi
  echo "[↓] $out …"
  # -C - : reprise si coupure ; --retry : résiste aux micro-coupures réseau
  curl -L --fail --retry 5 --retry-delay 5 --retry-all-errors -C - \
       -o "$out.part" "https://huggingface.co/$repo/resolve/main/$remote" \
    && mv "$out.part" "$out" \
    && echo "[✓] $out ($(du -h "$out" | cut -f1))" \
    || echo "[✗] ÉCHEC $out"
}

# 1. Candidat cerveau — même quantification que le 30B actuel (comparaison équitable)
get unsloth/Qwen3.6-35B-A3B-GGUF        Qwen3.6-35B-A3B-UD-Q4_K_XL.gguf  qwen3.6-35b-a3b-UD-Q4_K_XL.gguf
# 2. Candidat cerveau — variante économe en VRAM
get unsloth/Qwen3.6-35B-A3B-GGUF        Qwen3.6-35B-A3B-UD-Q3_K_XL.gguf  qwen3.6-35b-a3b-UD-Q3_K_XL.gguf
# 3. Œil nouvelle génération (+ son encodeur vision obligatoire)
get unsloth/Qwen3-VL-8B-Instruct-GGUF   Qwen3-VL-8B-Instruct-Q4_K_M.gguf qwen3-vl-8b-Q4_K_M.gguf
get unsloth/Qwen3-VL-8B-Instruct-GGUF   mmproj-F16.gguf                  qwen3-vl-8b-mmproj-F16.gguf
# 4. Mémoire de recherche (tourne sur CPU, reste chargée en permanence)
get Qwen/Qwen3-Embedding-0.6B-GGUF      Qwen3-Embedding-0.6B-f16.gguf    qwen3-embedding-0.6b-f16.gguf

echo "=== terminé ==="
du -sh . | cut -f1
