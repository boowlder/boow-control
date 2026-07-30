# ============================================================
#  INTERRUPTEUR BOOW
# ============================================================
#  Un clic. Si Boow tourne, il s'eteint et rend la carte
#  graphique. S'il est eteint, il s'allume et ouvre le cockpit.
#
#  Ce fichier est volontairement en ASCII pur : PowerShell 5
#  lit les .ps1 en encodage Windows par defaut, et un accent
#  suffit a casser le script.
#
#  Toute la logique vit dans ~/boow, cote Ubuntu. Ici on ne
#  fait que passer l'ordre : une seule verite, pas deux
#  scripts qui finissent par diverger.
# ============================================================

$ErrorActionPreference = 'Stop'
$distro = 'Ubuntu'

function Boow($cmd) {
  return (wsl.exe -d $distro -e /home/USER/boow $cmd 2>&1 | Out-String)
}

Write-Host ''
Write-Host '   b o o w   c o n t r o l' -ForegroundColor Cyan
Write-Host '   ------------------------' -ForegroundColor DarkGray
Write-Host ''

$etat = Boow 'etat'
# Le cerveau est la piece qui compte : c'est lui qui tient la carte graphique.
$allume = $etat -match 'llama-router\s+.*allum'

if ($allume) {
  Write-Host '   Boow tourne. Extinction...' -ForegroundColor Yellow
  Write-Host (Boow 'off')
  Write-Host '   Carte graphique liberee. Bon jeu.' -ForegroundColor Green
  Start-Sleep -Seconds 5
} else {
  Write-Host '   Boow est eteint. Demarrage...' -ForegroundColor Yellow
  Write-Host (Boow 'on')
  Write-Host '   Ouverture du cockpit...' -ForegroundColor Green
  Start-Process 'http://localhost:8788'
  Start-Sleep -Seconds 3
}
