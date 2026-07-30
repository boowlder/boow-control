import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import { App } from './App';
import { useCockpit, enregistrerEtat } from './store/useCockpit';
import './index.css';

// Sauvegarde débouncée des sessions (1,5 s après la dernière activité).
let minuteur: ReturnType<typeof setTimeout> | undefined;
useCockpit.subscribe(() => {
  clearTimeout(minuteur);
  minuteur = setTimeout(enregistrerEtat, 1500);
});
// Un onglet fermé pendant le délai perdrait les derniers messages.
window.addEventListener('beforeunload', enregistrerEtat);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
