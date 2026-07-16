const THEME_OPTIONS = [
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
  { value: "auto", label: "Auto" },
];

function ThemeSwitch({ preference, onChoose }) {
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
  categories,
  activeCategory,
  onSelectCategory,
  onOpenUpload,
  onLogout,
  themePreference,
  onChooseTheme,
}) {
  const total = categories.reduce((sum, c) => sum + c.count, 0);

  return (
    <aside className="sidebar">
      <p className="sidebar__brand">Frigo</p>

      <button className="btn btn--primary sidebar__upload" onClick={onOpenUpload}>
        + Mettre au froid
      </button>

      <nav className="sidebar__nav" aria-label="Compartiments">
        <p className="sidebar__heading">Compartiments</p>
        <button
          className={`sidebar__item ${!activeCategory ? "is-active" : ""}`}
          onClick={() => onSelectCategory("")}
        >
          <span>Tout</span>
          <span className="sidebar__count">{total}</span>
        </button>
        {categories.map((c) => (
          <button
            key={c.name}
            className={`sidebar__item ${activeCategory === c.name ? "is-active" : ""}`}
            onClick={() => onSelectCategory(c.name)}
          >
            <span>{c.name}</span>
            <span className="sidebar__count">{c.count}</span>
          </button>
        ))}
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
