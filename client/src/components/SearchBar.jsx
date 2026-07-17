import { useEffect, useState } from "react";

export function SearchBar({ filters, onChange }) {
  const [q, setQ] = useState(filters.q);

  // Recherche avec léger debounce pour éviter une requête par frappe.
  useEffect(() => {
    const t = setTimeout(() => {
      if (q !== filters.q) onChange((f) => ({ ...f, q }));
    }, 300);
    return () => clearTimeout(t);
  }, [q, filters.q, onChange]);

  return (
    <header className="manifest">
      <input
        className="manifest__search"
        type="search"
        placeholder="Rechercher dans l'inventaire…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Recherche"
      />
    </header>
  );
}
