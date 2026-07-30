# Voix locale (Piper)

Le cockpit lit les réponses avec une voix française locale. Rien ne sort de la
machine, et le GPU n'est pas sollicité — Piper tourne sur le processeur.

## Ce qui est installé

    ~/.local/piper/piper                      le moteur (26 Mo)
    ~/.local/piper/fr_FR-siwis-medium.onnx    la voix française (63 Mo)

## Réinstaller

    mkdir -p ~/.local/piper && cd ~/.local/piper
    curl -sL -o piper.tar.gz https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz
    tar xzf piper.tar.gz --strip-components=1 && rm piper.tar.gz
    B=https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium
    curl -sL -o fr_FR-siwis-medium.onnx      $B/fr_FR-siwis-medium.onnx
    curl -sL -o fr_FR-siwis-medium.onnx.json $B/fr_FR-siwis-medium.onnx.json

## Vérifier

    curl -s http://127.0.0.1:8788/api/tts/status

Si la voix locale est absente, le cockpit retombe automatiquement sur celle du
navigateur : le bouton voix marche dans tous les cas.

## Changer de voix

D'autres voix françaises existent sur huggingface.co/rhasspy/piper-voices.
Pointe le daemon dessus avec la variable BOOW_PIPER_VOICE.
