import { useState } from "react";
import { useBackClose } from "../hooks/useBackClose.js";
import { ThemeSwitch } from "./Sidebar.jsx";

// Feuille de menu (apparence + verrouillage) ouverte depuis la barre mobile.
function MobileMenu({ onClose, onLogout, themePreference, onChooseTheme }) {
  useBackClose(onClose);

  return (
    <div className="overlay overlay--sheet" role="dialog" aria-modal="true" aria-label="Menu" onClick={onClose}>
      <div className="mobile-menu" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-menu__head">
          <p className="mobile-menu__brand">Private Server</p>
          <button type="button" className="overlay__close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <p className="mobile-menu__heading">Apparence</p>
        <ThemeSwitch preference={themePreference} onChoose={onChooseTheme} />
        <button className="mobile-menu__logout" onClick={onLogout}>
          Verrouiller la session
        </button>
      </div>
    </div>
  );
}

// Barre de navigation fixée en bas, visible uniquement en mobile (≤ 720px) :
// la sidebar y est masquée, les dossiers restent accessibles via l'accueil.
export function MobileNav({
  active, // "home" | "unfiled" (les pages dossier comptent comme "home")
  onSelectHome,
  onSelectUnfiled,
  onOpenUpload,
  onLogout,
  themePreference,
  onChooseTheme,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <nav className="mobile-nav" aria-label="Navigation principale">
        <button
          className={`mobile-nav__item ${active === "home" ? "is-active" : ""}`}
          onClick={onSelectHome}
        >
          Dossiers
        </button>
        <button className="mobile-nav__item mobile-nav__item--add" onClick={onOpenUpload}>
          Ajouter
        </button>
        <button
          className={`mobile-nav__item ${active === "unfiled" ? "is-active" : ""}`}
          onClick={onSelectUnfiled}
        >
          Non classés
        </button>
        <button className="mobile-nav__item" onClick={() => setMenuOpen(true)}>
          Menu
        </button>
      </nav>

      {menuOpen && (
        <MobileMenu
          onClose={() => setMenuOpen(false)}
          onLogout={onLogout}
          themePreference={themePreference}
          onChooseTheme={onChooseTheme}
        />
      )}
    </>
  );
}
