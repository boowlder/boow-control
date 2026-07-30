# Allumer, éteindre, entretenir

## La recette — le filet

```bash
pnpm recette             # ~30 s : routes, tests, chaque écran via Chrome
pnpm recette --complet   # + un vrai message part et une réponse revient
```

Elle regarde le **vrai écran** (Chrome, port 9222), pas seulement le code —
c'est ce qui a attrapé, à l'audit du 22/07/2026, tous les bugs que le
typecheck ne voyait pas. Règle de la carte : plus jamais de « c'est fini »
sans recette verte.

Les fichiers de ce dossier sont des **copies de référence**. Les originaux
vivent là où le système les attend :

| copie ici | original | rôle |
|---|---|---|
| `boow` | `~/boow` (lié dans `~/.local/bin`) | l'interrupteur, côté Ubuntu |
| `Boow.ps1` · `Boow.cmd` · `Boow.ico` | `C:\Users\<vous>\` | l'interrupteur, côté Windows |
| `llama-router.service` | `~/.config/systemd/user/` | le routeur de cerveaux |
| `compacter-wsl.ps1` · `.txt` | `C:\Users\<vous>\` | récupérer l'espace disque perdu |

## L'interrupteur

```bash
boow on       # tout démarrer
boow off      # tout arrêter — rend la carte graphique tout de suite
boow veille   # garder le cockpit, rendre juste la mémoire vidéo
boow etat     # où en est-on
```

Sous Windows : le raccourci **Boow** sur le bureau. Un clic bascule d'un état à
l'autre, et ouvre le cockpit à l'allumage.

## La mémoire vidéo

Le cerveau prend **14,8 Go des 16 Go** de la carte quand il est chargé. Sans
rien faire, il les gardait indéfiniment — y compris pendant une partie de jeu.

`--sleep-idle-seconds 300` dans `llama-router.service` corrige ça : après cinq
minutes sans question, le cerveau rend la mémoire (**14,8 Go → 2,0 Go**,
mesuré le 22/07/2026) et se recharge tout seul à la question suivante.

| | mesuré |
|---|---|
| premier chargement, disque froid | 74 s |
| réveil après veille | **29 s** |
| mémoire au repos | 2,0 Go (pilote WSL, aucun processus de calcul) |

Cinq minutes est un compromis : assez long pour ne jamais couper une session de
travail, assez court pour libérer la carte peu après qu'on l'ait quittée. Pour
ne pas attendre — avant de lancer un jeu — `boow off` ou le raccourci.

## Ce qui démarre tout seul

Les trois services sont `enabled` et `linger` est actif : ils repartent dès que
**WSL** démarre.

Mais WSL ne démarre pas avec Windows. Il démarre quand quelque chose le
sollicite : un terminal Ubuntu ouvert, ou le raccourci Boow. Allumer le PC ne
charge donc rien — c'est voulu.

## Récupérer l'espace disque

Le disque virtuel de WSL grossit et ne rétrécit jamais seul : il gardait 115 Go
pour 92 Go de contenu réel. Tous les terminaux Ubuntu fermés, en PowerShell
administrateur :

```powershell
powershell -ExecutionPolicy Bypass -File C:\Users\<vous>\compacter-wsl.ps1
```

Le 22/07/2026 : **115,1 Go → 92,9 Go, 22,3 Go récupérés.**

Le script coupe WSL lui-même — donc aussi le cockpit, qui repart au premier
usage suivant.

## Note sur les scripts PowerShell

`Boow.ps1` est en **ASCII pur**, sans accent ni caractère de dessin. PowerShell 5
lit les `.ps1` dans l'encodage Windows par défaut : un seul accent suffit à
casser le script — vérifié, il recrachait son propre code à l'écran.
