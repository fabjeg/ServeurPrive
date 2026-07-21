import { PressureGauge } from "./PressureGauge.jsx";
import { IconSunburst } from "./Icons.jsx";

// Écran d'accueil : deux cadrans de manomètre (un par marque), fidèles à la
// maquette fournie — écran autonome, sans sidebar (voir ProSpace.jsx, rendu
// avant le <div className="shell">). Cliquer sur un cadran entre dans la
// navigation habituelle pour cette marque ; les autres dossiers
// ("documentation générale", futures marques) restent joignables depuis la
// sidebar une fois entré, mais n'ont pas de cadran dédié ici.
const GAUGES = [
  {
    key: "thermo king",
    accent: "blue",
    label: "BASSE PRESSION",
    name: "Thermo King",
    restAngle: -10,
    hoverAngle: 5,
    arcOffset: 90,
  },
  {
    key: "carrier",
    accent: "red",
    label: "HAUTE PRESSION",
    name: "Carrier",
    restAngle: 15,
    hoverAngle: 30,
    arcOffset: 130,
  },
];

export function GaugeHome({ folders, onSelectBrand, onOpenAssistant }) {
  return (
    <div className="gauge-home">
      <header className="gauge-home__header">
        <p className="gauge-home__eyebrow">Frigo — Documentation technique</p>
        <h1 className="gauge-home__title">Choisir une marque</h1>
        <p className="gauge-home__subtitle">Schémas, manuels et fiches modèles</p>
      </header>

      <div className="gauge-home__panels">
        {GAUGES.map((g) => {
          const folder = folders.find((f) => f.name === g.key);
          return (
            <div className="gauge-home__panel" key={g.key}>
              <PressureGauge
                accent={g.accent}
                label={g.label}
                restAngle={g.restAngle}
                hoverAngle={g.hoverAngle}
                arcOffset={g.arcOffset}
                onClick={() => folder && onSelectBrand(folder)}
              />
              <p className="gauge-home__brand-name">{g.name}</p>
            </div>
          );
        })}
      </div>

      <button type="button" className="gauge-home__assistant" onClick={onOpenAssistant}>
        <IconSunburst className="gauge-home__assistant-icon" />
        <span>Assistant IA</span>
      </button>

      <p className="gauge-home__footer">ESPACE PRO · 2 MARQUES · MISE À JOUR CONTINUE</p>
    </div>
  );
}
