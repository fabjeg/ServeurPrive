export function Sidebar({ categories, activeCategory, onSelectCategory, onOpenUpload, onLogout }) {
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

      <button className="sidebar__logout" onClick={onLogout}>
        Verrouiller la session
      </button>
    </aside>
  );
}
