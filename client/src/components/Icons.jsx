// Icônes en trait (stroke currentColor) — pas de dépendance, pas d'emoji.
function Icon({ children, ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconDoc = (p) => (
  <Icon {...p}>
    <path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" />
    <path d="M14 3v4h4M9.5 12h5M9.5 16h5" />
  </Icon>
);

export const IconSchema = (p) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <path d="M8 15.5v-3.5h8v3.5M12 12V8.5M12 8.5h-2M12 8.5h2" />
  </Icon>
);

export const IconAlert = (p) => (
  <Icon {...p}>
    <path d="M12 3l8 4v5c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V7z" />
    <path d="M12 8.5v4M12 15.8v.2" />
  </Icon>
);

export const IconChevron = (p) => (
  <Icon {...p}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);

export const IconFolder = (p) => (
  <Icon {...p}>
    <path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z" />
  </Icon>
);

export const IconSnow = (p) => (
  <Icon {...p}>
    <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />
  </Icon>
);

export const IconPlus = (p) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconMenu = (p) => (
  <Icon {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const IconImage = (p) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="M4.5 17.5l5-5 3.5 3.5 2.5-2.5 4 4" />
  </Icon>
);

// Assistant virtuel — tête arrondie, antenne, yeux et sourire en trait :
// signale sans ambiguïté « ceci est un bot », dans le même vocabulaire
// graphique (trait, currentColor) que le reste de l'iconographie Frigo.
export const IconBot = (p) => (
  <Icon {...p}>
    <path d="M12 3v3" />
    <circle cx="12" cy="3" r="1.1" fill="currentColor" stroke="none" />
    <rect x="4.5" y="7.5" width="15" height="11.5" rx="3.5" />
    <path d="M9 12.5v1.5M15 12.5v1.5" />
    <path d="M9.3 16.3c.8.6 1.7.9 2.7.9s1.9-.3 2.7-.9" />
    <path d="M2.5 11v3.5M21.5 11v3.5" />
  </Icon>
);

// Petite étincelle — badge « propulsé par l'IA », accolée au bot.
export const IconSparkle = (p) => (
  <Icon {...p}>
    <path d="M12 3l1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4z" strokeLinejoin="round" />
  </Icon>
);

// Repère "assistant" de la maquette d'accueil (cadrans) — astérisque à 8
// branches + cercle, distinct d'IconSparkle (déjà utilisée ailleurs).
export const IconSunburst = (p) => (
  <Icon strokeWidth="1.6" {...p}>
    <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    <circle cx="12" cy="12" r="4.2" />
  </Icon>
);

export const IconSend = (p) => (
  <Icon {...p}>
    <path d="M21 3L14.5 21l-3.5-8-8-3.5z" strokeLinejoin="round" />
    <path d="M21 3L11 13" />
  </Icon>
);

export const IconMinus = (p) => (
  <Icon {...p}>
    <path d="M5 12h14" />
  </Icon>
);

export const IconExpand = (p) => (
  <Icon {...p}>
    <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
  </Icon>
);

export const IconCollapse = (p) => (
  <Icon {...p}>
    <path d="M4 9V4h5M15 4h5v5M4 15v5h5M20 15v5h-5" />
  </Icon>
);

export const IconTrash = (p) => (
  <Icon {...p}>
    <path d="M4.5 7h15" />
    <path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" />
    <path d="M6.5 7l.9 12.4A1.5 1.5 0 0 0 8.9 21h6.2a1.5 1.5 0 0 0 1.5-1.6L17.5 7" />
    <path d="M10 11v6M14 11v6" />
  </Icon>
);

// Icône de tuile selon la catégorie de documents (heuristique simple).
export function categoryIcon(name) {
  if (/schema|schéma|plan|electr/i.test(name)) return IconSchema;
  if (/defaut|défaut|erreur|code|alarme/i.test(name)) return IconAlert;
  if (/photo|image/i.test(name)) return IconImage;
  return IconDoc;
}
