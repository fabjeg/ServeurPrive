import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { ThemeSwitch } from "../components/Sidebar.jsx";
import { DocumentGrid } from "../components/DocumentGrid.jsx";
import { UploadPanel } from "../components/UploadPanel.jsx";
import { Viewer } from "../components/Viewer.jsx";

const SPACE = "perso";

const CATEGORIES = [
  { value: "", label: "Toutes les catégories" },
  { value: "fiche de paie", label: "Fiches de paie" },
  { value: "contrat", label: "Contrats" },
  { value: "autre", label: "Autre" },
];

const SORTS = [
  { value: "date-desc", label: "Date (récent d'abord)" },
  { value: "date-asc", label: "Date (ancien d'abord)" },
  { value: "category", label: "Catégorie" },
];

// Espace personnel : structure volontairement simple — pas de dossiers, pas
// de recherche full-text, juste une liste triable filtrée par catégorie.
export function PersoSpace({ themePreference, onChooseTheme, onLogout }) {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState("date-desc");
  const [version, setVersion] = useState(0);
  const [viewerDoc, setViewerDoc] = useState(null);
  const [uploading, setUploading] = useState(false);

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    setLoading(true);
    api
      .listDocuments(SPACE, { category: category || undefined })
      .then((res) => setDocuments(res.documents))
      .finally(() => setLoading(false));
  }, [category, version]);

  const sorted = [...documents].sort((a, b) => {
    if (sort === "category") return a.category.localeCompare(b.category);
    const diff = new Date(a.uploadedAt) - new Date(b.uploadedAt);
    return sort === "date-asc" ? diff : -diff;
  });

  const handleDelete = async (doc) => {
    if (!window.confirm(`Supprimer définitivement « ${doc.filename} » ?`)) return;
    await api.deleteDocument(doc.space, doc.id);
    setViewerDoc(null);
    bump();
  };

  return (
    <div className="perso-shell">
      <header className="perso-shell__head">
        <div>
          <button type="button" className="sidebar__space" onClick={() => navigate("/")}>
            Espace Personnel <span className="sidebar__space-change">Changer</span>
          </button>
          <h1 className="perso-shell__title">Documents personnels</h1>
        </div>
        <div className="perso-shell__actions">
          <ThemeSwitch preference={themePreference} onChoose={onChooseTheme} />
          <button className="btn btn--primary" onClick={() => setUploading(true)}>
            + Ajouter un document
          </button>
          <button className="btn" onClick={onLogout}>
            Verrouiller
          </button>
        </div>
      </header>

      <div className="perso-shell__filters">
        <label className="field">
          <span className="field__label">Catégorie</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field__label">Trier par</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <DocumentGrid documents={sorted} loading={loading} onOpen={setViewerDoc} onDelete={handleDelete} />

      {uploading && (
        <UploadPanel
          space={SPACE}
          onClose={() => setUploading(false)}
          onUploaded={() => {
            setUploading(false);
            bump();
          }}
        />
      )}
      {viewerDoc && (
        <Viewer
          doc={viewerDoc}
          onClose={() => setViewerDoc(null)}
          onDelete={handleDelete}
          onChanged={bump}
        />
      )}
    </div>
  );
}
