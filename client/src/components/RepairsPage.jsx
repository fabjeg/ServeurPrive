import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { RepairForm } from "./RepairForm.jsx";

// Construit la liste plate "marque" / "marque modèle" utilisée par le
// sélecteur de RepairForm — même logique de parcours que
// FolderPage.jsx (marques = dossiers de premier niveau, modèles = enfants).
async function loadFolderOptions(space) {
  const { folders: brands } = await api.listFolders(space);
  const options = [];
  for (const brand of brands) {
    options.push({ id: brand.id, label: brand.name });
    const { folders: models } = await api.listFolders(space, { parentId: brand.id });
    for (const model of models) {
      options.push({ id: model.id, label: `${brand.name} ${model.name}` });
    }
  }
  return options;
}

function RepairCard({ repair, onOpen }) {
  return (
    <li>
      <button className="repair-card" onClick={() => onOpen(repair)}>
        <div className="repair-card__head">
          <span className="repair-card__symptom">{repair.symptom}</span>
          <span className={`repair-card__status ${repair.resolved ? "is-resolved" : "is-open"}`}>
            {repair.resolved ? "Résolu" : "Non résolu"}
          </span>
        </div>
        <div className="repair-card__meta">
          {repair.folderName && <span className="repair-card__model">{repair.folderName}</span>}
          {repair.faultCodes.length > 0 && (
            <span className="repair-card__codes">{repair.faultCodes.join(", ")}</span>
          )}
          <span className="repair-card__date">
            {new Date(repair.createdAt).toLocaleDateString("fr-FR")}
          </span>
        </div>
        {repair.solution && <p className="repair-card__excerpt">{repair.solution}</p>}
      </button>
    </li>
  );
}

export function RepairsPage({ space, onBack }) {
  const [repairs, setRepairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [folderOptions, setFolderOptions] = useState([]);
  const [formTarget, setFormTarget] = useState(null); // null | "new" | repair

  const load = useCallback(() => {
    setLoading(true);
    api
      .listRepairs(space, { q: query || undefined })
      .then((res) => setRepairs(res.repairs))
      .finally(() => setLoading(false));
  }, [space, query]);

  useEffect(load, [load]);
  useEffect(() => {
    loadFolderOptions(space).then(setFolderOptions);
  }, [space]);

  const handleDelete = async (repair) => {
    if (!window.confirm(`Supprimer ce cas de dépannage (« ${repair.symptom} ») ?`)) return;
    await api.deleteRepair(space, repair.id);
    setFormTarget(null);
    load();
  };

  return (
    <section className="repairs-page">
      <header className="folder-page__head">
        <button className="folder-page__back" onClick={onBack} aria-label="Retour aux dossiers">
          ←
        </button>
        <div className="folder-page__title-row">
          <h1 className="folder-page__title">Dépannage</h1>
          <span className="folder-page__badge">
            {repairs.length} cas
          </span>
        </div>
        <div className="folder-page__actions">
          <button className="btn btn--primary" onClick={() => setFormTarget("new")}>
            + Nouveau dépannage
          </button>
        </div>
      </header>

      <div className="manifest">
        <input
          className="manifest__search"
          type="search"
          placeholder="Recherche par symptôme, diagnostic, solution, code défaut…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Recherche dans le dépannage"
        />
      </div>

      {loading && !repairs.length ? (
        <p className="grid-empty">Chargement…</p>
      ) : !repairs.length ? (
        <div className="grid-empty">
          <p className="grid-empty__title">Aucun dépannage enregistré</p>
          <p>Enregistre un cas manuellement, ou laisse Jarvis le proposer après un diagnostic.</p>
        </div>
      ) : (
        <ul className="repair-grid">
          {repairs.map((r) => (
            <RepairCard key={r.id} repair={r} onOpen={setFormTarget} />
          ))}
        </ul>
      )}

      {formTarget && (
        <RepairForm
          space={space}
          repair={formTarget === "new" ? null : formTarget}
          folderOptions={folderOptions}
          onClose={() => setFormTarget(null)}
          onSaved={() => {
            setFormTarget(null);
            load();
          }}
          onDelete={formTarget !== "new" ? () => handleDelete(formTarget) : undefined}
        />
      )}
    </section>
  );
}
