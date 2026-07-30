#!/usr/bin/env python3
"""Worker de transcription — l'oreille locale de boow control.

Charge le modèle faster-whisper UNE fois, puis attend des chemins de fichiers
audio sur son entrée standard (un par ligne) et répond une ligne JSON par
transcription. Tourne sur le processeur (int8), ne touche jamais au GPU : la
carte graphique reste au cerveau et aux jeux.

Réutilise le venv et le modèle déjà installés (`~/.hermes/whisper-venv`,
modèle « base » en cache). Piloté par le daemon, qui le relance s'il meurt.
"""
import json
import sys

from faster_whisper import WhisperModel

# base + int8 : ~140 Mo, rapide, largement suffisant pour de la dictée courte.
# small serait plus fin mais deux fois plus lent — on garde base.
MODELE = "base"


def main() -> None:
    model = WhisperModel(MODELE, device="cpu", compute_type="int8")
    # Signale au daemon que le modèle est chargé et qu'on peut envoyer.
    print(json.dumps({"pret": True}), flush=True)

    for ligne in sys.stdin:
        chemin = ligne.strip()
        if not chemin:
            continue
        try:
            segments, info = model.transcribe(chemin, language="fr", vad_filter=True)
            texte = " ".join(s.text.strip() for s in segments).strip()
            print(json.dumps({"texte": texte, "langue": info.language}), flush=True)
        except Exception as e:  # noqa: BLE001 — on renvoie l'erreur, on ne meurt pas
            print(json.dumps({"erreur": str(e)}), flush=True)


if __name__ == "__main__":
    main()
