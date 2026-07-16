import { useEffect, useRef } from "react";

// Branche le bouton retour du téléphone (et le geste "back") sur la fermeture
// de l'overlay au lieu de quitter l'application. Chaque overlay pousse une
// entrée d'historique à l'ouverture ; "retour" ferme l'overlay le plus récent.
let counter = 0;
const stack = [];

export function useBackClose(onClose) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const id = ++counter;
    stack.push(id);
    window.history.pushState({ overlay: id }, "");

    const onPop = () => {
      if (stack[stack.length - 1] === id) closeRef.current();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      stack.splice(stack.indexOf(id), 1);
      // Fermeture par le bouton ✕ : consommer l'entrée d'historique restante.
      if (window.history.state?.overlay === id) window.history.back();
    };
  }, []);
}
