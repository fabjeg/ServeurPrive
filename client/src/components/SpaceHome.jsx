import { Link } from "react-router-dom";
import { ThemeSwitch } from "./Sidebar.jsx";

// Accueil neutre après connexion : aucune présélection d'espace, l'utilisateur
// choisit explicitement pro ou perso à chaque fois.
export function SpaceHome({ onLogout, themePreference, onChooseTheme }) {
  return (
    <div className="space-home">
      <div className="space-home__card">
        <p className="space-home__brand">Frigo</p>
        <p className="space-home__tagline">Choisir un espace</p>

        <div className="space-home__grid">
          <Link className="space-home__tile" to="/pro">
            <span className="space-home__tile-name">Pro</span>
            <span className="space-home__tile-desc">Notices, schémas, plans frigoriste</span>
          </Link>
          <Link className="space-home__tile" to="/perso">
            <span className="space-home__tile-name">Personnel</span>
            <span className="space-home__tile-desc">Fiches de paie, contrats, administratif</span>
          </Link>
        </div>

        <div className="space-home__appearance">
          <ThemeSwitch preference={themePreference} onChoose={onChooseTheme} />
        </div>

        <button className="space-home__logout" onClick={onLogout}>
          Verrouiller la session
        </button>
      </div>
    </div>
  );
}
