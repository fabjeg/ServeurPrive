import { IconAlert } from "./Icons.jsx";

const THEME_OPTIONS = [
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
  { value: "auto", label: "Auto" },
];

export function ThemeSwitch({ preference, onChoose }) {
  const handleKeyDown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const current = THEME_OPTIONS.findIndex((o) => o.value === preference);
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = THEME_OPTIONS[(current + step + THEME_OPTIONS.length) % THEME_OPTIONS.length];
    onChoose(next.value);
    event.currentTarget.querySelector(`[data-value="${next.value}"]`)?.focus();
  };

  return (
    <div
      className="theme-switch"
      role="radiogroup"
      aria-label="Apparence"
      onKeyDown={handleKeyDown}
    >
      {THEME_OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          data-value={value}
          aria-checked={preference === value}
          tabIndex={preference === value ? 0 : -1}
          className={`theme-switch__option ${preference === value ? "is-selected" : ""}`}
          onClick={() => onChoose(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Sidebar({
  spaceLabel,
  onChangeSpace,
  folders,
  unfiledCount,
  activeFolderId,
  onSelectHome,
  onSelectFolder,
  onSelectUnfiled,
  onSelectRepairs,
  onOpenUpload,
  onLogout,
  themePreference,
  onChooseTheme,
}) {
  const total = folders.reduce((sum, f) => sum + f.documentCount, 0) + unfiledCount;

  return (
    <aside className="sidebar">
      <p className="sidebar__brand">Private Server</p>
      {spaceLabel && (
        <button type="button" className="sidebar__space" onClick={onChangeSpace}>
          Espace {spaceLabel} <span className="sidebar__space-change">Changer</span>
        </button>
      )}

      <button className="btn btn--primary sidebar__upload" onClick={onOpenUpload}>
        + Ajouter un document
      </button>

      <nav className="sidebar__nav" aria-label="Dossiers">
        <p className="sidebar__heading">Dossiers</p>
        <button
          className={`sidebar__item ${!activeFolderId ? "is-active" : ""}`}
          onClick={onSelectHome}
        >
          <span>Tous les dossiers</span>
          <span className="sidebar__count">{total}</span>
        </button>
        <button
          className={`sidebar__item ${activeFolderId === "repairs" ? "is-active" : ""}`}
          onClick={onSelectRepairs}
        >
          <span className="sidebar__item-label">
            <IconAlert /> Dépannage
          </span>
        </button>
        {folders.map((f) => (
          <button
            key={f.id}
            className={`sidebar__item sidebar__item--folder ${
              activeFolderId === f.id ? "is-active" : ""
            }`}
            onClick={() => onSelectFolder(f)}
          >
            <span>{f.name}</span>
            <span className="sidebar__count">{f.documentCount}</span>
          </button>
        ))}
        {unfiledCount > 0 && (
          <button
            className={`sidebar__item ${activeFolderId === "unfiled" ? "is-active" : ""}`}
            onClick={onSelectUnfiled}
          >
            <span>Non classés</span>
            <span className="sidebar__count">{unfiledCount}</span>
          </button>
        )}
      </nav>

      <div className="sidebar__appearance">
        <p className="sidebar__heading">Apparence</p>
        <ThemeSwitch preference={themePreference} onChoose={onChooseTheme} />
      </div>

      <button className="sidebar__logout" onClick={onLogout}>
        Verrouiller la session
      </button>
    </aside>
  );
}
