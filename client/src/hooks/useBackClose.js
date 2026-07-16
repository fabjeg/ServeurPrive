import { useEffect, useRef } from "react";

// Branche le bouton retour du téléphone (et le geste "back") sur la fermeture
// de l'overlay au lieu de quitter l'application. Chaque overlay pousse une
// entrée d'historique à l'ouverture ; "retour" ferme l'overlay le plus récent.
let counter = 0;
const stack = [];
// StrictMode (dev) démonte puis remonte immédiatement chaque effet : le
// history.back() du cleanup est asynchrone et atterrirait APRÈS le remontage,
// fermant l'overlay à peine ouvert. On le diffère donc d'un tick pour que le
// remontage puisse l'annuler et adopter l'entrée d'historique déjà poussée.
let orphan = null; // { id, timer } : entrée poussée dont le back est en attente

export function useBackClose(onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let id;
    if (orphan) {
      clearTimeout(orphan.timer);
      id = orphan.id;
      orphan = null;
    } else {
      id = ++counter;
      window.history.pushState({ overlay: id }, "");
    }
    stack.push(id);

    const onPop = () => {
      if (stack[stack.length - 1] === id) closeRef.current();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      stack.splice(stack.indexOf(id), 1);
      // Fermeture par le bouton ✕ : consommer l'entrée d'historique restante.
      if (window.history.state?.overlay === id) {
        const timer = setTimeout(() => {
          orphan = null;
          window.history.back();
        }, 0);
        orphan = { id, timer };
      }
    };
  }, []);
}
