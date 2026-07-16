import { useEffect, useState } from "react";

// Préférence d'apparence : "light" | "dark" | "auto" (suit le système).
// Persistée sous frigo:theme ; l'absence de clé vaut "auto".
// Le premier paint est géré par le script inline d'index.html — ce hook
// prend le relais pour les changements en cours de session.
const STORAGE_KEY = "frigo:theme";
const META_COLORS = { light: "#2e7ca8", dark: "#0e1f27" };
const media = window.matchMedia("(prefers-color-scheme: dark)");

function readPreference() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "auto";
  } catch {
    return "auto";
  }
}

function applyTheme(preference) {
  const effective =
    preference === "auto" ? (media.matches ? "dark" : "light") : preference;
  document.documentElement.dataset.theme = effective;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", META_COLORS[effective]);
}

export function useTheme() {
  const [preference, setPreference] = useState(readPreference);

  useEffect(() => {
    applyTheme(preference);
    if (preference !== "auto") return;
    const onChange = () => applyTheme("auto");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const choosePreference = (next) => {
    try {
      if (next === "auto") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // stockage indisponible : le choix vaut pour la session en cours
    }
    setPreference(next);
  };

  return { preference, choosePreference };
}
