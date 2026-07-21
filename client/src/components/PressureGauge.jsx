import { useEffect, useState } from "react";

// Cadran de manomètre SVG — fidèle à la maquette fournie (arc 270°, 20
// graduations, aiguille + moyeu). Réutilisable ailleurs dans l'app (ex.
// indicateur de statut) via les props accent/label/angles.
const CX = 110;
const CY = 110;
const R_OUTER = 100;
const R_INNER = 92;
const R_INNER_MAJOR = 88;
const START_ANGLE = -225;
const END_ANGLE = 45;
const TICK_COUNT = 20;
const ARC_PATH = "M 40 165 A 90 90 0 1 1 180 165";
const ARC_LENGTH = 330;
const REST_NEEDLE_ANGLE = -90;

function buildTicks() {
  const ticks = [];
  for (let i = 0; i <= TICK_COUNT; i++) {
    const angle = START_ANGLE + (END_ANGLE - START_ANGLE) * (i / TICK_COUNT);
    const rad = (angle * Math.PI) / 180;
    const isMajor = i % 5 === 0;
    const rIn = isMajor ? R_INNER_MAJOR : R_INNER;
    ticks.push({
      key: i,
      major: isMajor,
      x1: CX + R_OUTER * Math.cos(rad),
      y1: CY + R_OUTER * Math.sin(rad),
      x2: CX + rIn * Math.cos(rad),
      y2: CY + rIn * Math.sin(rad),
    });
  }
  return ticks;
}

const TICKS = buildTicks();

export function PressureGauge({ accent, label, restAngle, hoverAngle, arcOffset, onClick }) {
  // "rest" = position de départ (avant l'animation de montage), "settled"
  // = position finale — le passage de l'une à l'autre déclenche la
  // transition CSS (voir _pressure-gauge.scss). Remonté à chaque retour
  // sur l'accueil (GaugeHome n'est monté que sur cette vue), donc l'effet
  // rejoue l'animation à chaque fois sans clé React à gérer.
  const [phase, setPhase] = useState("rest");
  const [hovering, setHovering] = useState(false);

  useEffect(() => {
    let timeout;
    const frame = requestAnimationFrame(() => {
      timeout = setTimeout(() => setPhase("settled"), 150);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
    };
  }, []);

  const angle = phase === "rest" ? REST_NEEDLE_ANGLE : hovering ? hoverAngle : restAngle;
  const dashoffset = phase === "rest" ? ARC_LENGTH : arcOffset;

  return (
    <button
      type="button"
      className={`gauge-panel gauge-panel--${accent}`}
      onClick={onClick}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <span className="gauge-panel__wrap">
        <svg className="gauge-panel__svg" viewBox="0 0 220 220">
          <g>
            {TICKS.map((t) => (
              <line
                key={t.key}
                className={`gauge-panel__tick ${t.major ? "is-major" : ""}`}
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
              />
            ))}
          </g>
          <path className="gauge-panel__arc-bg" d={ARC_PATH} />
          <path
            className="gauge-panel__arc-fill"
            d={ARC_PATH}
            strokeDasharray={ARC_LENGTH}
            strokeDashoffset={dashoffset}
          />
          <line
            className="gauge-panel__needle"
            x1={CX}
            y1={CY}
            x2={CX}
            y2="45"
            strokeWidth="3"
            style={{ transform: `rotate(${angle}deg)` }}
          />
          <circle className="gauge-panel__hub" cx={CX} cy={CY} r="8" />
          <text className="gauge-panel__label" x={CX} y="145" textAnchor="middle">
            {label}
          </text>
        </svg>
      </span>
    </button>
  );
}
