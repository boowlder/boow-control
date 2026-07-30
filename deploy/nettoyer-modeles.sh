#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  SUPPRESSION RÉELLE des modèles retirés + récupération effective de l'espace
#
#  À lancer SEULEMENT après la décision du bench.
#      bash ~/models/nettoyer-modeles.sh --lister          (voir ce qu'on a)
#      bash ~/models/nettoyer-modeles.sh --supprimer <nom> (supprimer pour de bon)
#
#  Pourquoi ce script : dans WSL, effacer un fichier ne rend pas l'espace à
#  Windows tout seul. Le disque virtuel garde sa taille. Ce script fait les
#  deux étapes : suppression réelle + libération (fstrim).
# ─────────────────────────────────────────────────────────────────────────────
set -u
HF=~/.cache/huggingface/hub
MOD=~/models

lister() {
  echo "═══ Modèles téléchargés à la main (~/models) ═══"
  ls -la $MOD/*.gguf 2>/dev/null | awk '{printf "  %-46s %6.2f Go\n", substr($NF, length("'"$MOD"'")+2), $5/1073741824}'
  echo
  echo "═══ Modèles du cache HuggingFace ═══"
  for d in $HF/models--*; do
    [ -d "$d" ] || continue
    printf "  %-52s %s\n" "$(basename "$d" | sed 's/models--//; s/--/\//g')" "$(du -sh "$d" 2>/dev/null | cut -f1)"
  done
  echo
  echo "═══ Espace disque ═══"
  df -h ~ | tail -1 | awk '{print "  utilisé: "$3" / "$2"  ("$5")  —  libre: "$4}'
}

liberer() {
  echo
  echo "→ libération de l'espace (fstrim)…"
  # rend les blocs libérés au disque virtuel ; sans ça WSL garde la place réservée
  sudo fstrim -v / 2>/dev/null || echo "  (fstrim a besoin de sudo — relance avec sudo si besoin)"
  echo
  echo "  Pour que Windows récupère vraiment la place sur le disque C:,"
  echo "  ferme WSL puis lance ceci dans PowerShell (en administrateur) :"
  echo "      wsl --shutdown"
  echo "      Optimize-VHD -Path \$env:LOCALAPPDATA\\Packages\\<...>\\ext4.vhdx -Mode Full"
  echo "  (ou simplement : wsl --manage <distro> --set-sparse true)"
}

supprimer() {
  local cible="$1" trouve=0
  # 1) fichier explicite dans ~/models
  if [ -f "$MOD/$cible" ]; then
    local t; t=$(du -h "$MOD/$cible" | cut -f1)
    rm -f "$MOD/$cible" && echo "  ✓ supprimé : $cible ($t)" && trouve=1
  fi
  # 2) dossier du cache HuggingFace (blobs compris — c'est là qu'est le poids réel)
  local d="$HF/models--$(echo "$cible" | sed 's|/|--|g')"
  if [ -d "$d" ]; then
    local t; t=$(du -sh "$d" | cut -f1)
    rm -rf "$d" && echo "  ✓ supprimé du cache : $cible ($t)" && trouve=1
  fi
  [ "$trouve" = 1 ] || { echo "  ✗ introuvable : $cible"; return 1; }
}

case "${1:---lister}" in
  --lister) lister ;;
  --supprimer)
    shift
    [ $# -gt 0 ] || { echo "usage: $0 --supprimer <nom-de-fichier-ou-repo> [...]"; exit 1; }
    echo "═══ Suppression ═══"
    for c in "$@"; do supprimer "$c"; done
    liberer
    echo; lister
    ;;
  --liberer) liberer ;;
  *) echo "usage: $0 [--lister | --supprimer <nom> ... | --liberer]"; exit 1 ;;
esac
