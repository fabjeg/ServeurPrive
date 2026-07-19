import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { DocumentGrid } from "./DocumentGrid.jsx";
import { FolderCard } from "./FolderGrid.jsx";
import { FolderForm } from "./FolderForm.jsx";
import { SpecSheetForm } from "./SpecSheetForm.jsx";
import { useBackClose } from "../hooks/useBackClose.js";
import { categoryIcon, IconChevron } from "./Icons.jsx";

const SPEC_FIELDS = [
  { key: "refrigerant", label: "Réfrigérant" },
  { key: "oil", label: "Huile" },
  { key: "compressor", label: "Compresseur" },
  { key: "charge", label: "Charge" },
  { key: "fuses", label: "Fusibles" },
  { key: "pressureHp", label: "Pression HP" },
  { key: "pressureBp", label: "Pression BP" },
];

// "Documents clés" : au plus un lien par type, le plus récent, parmi les
// documents déjà classés du modèle — filtre d'affichage uniquement, pas de
// nouvelle relation en base (voir server/models/Folder.js).
const KEY_DOC_MATCHERS = [
  { key: "schema", label: "Schéma électrique", match: (c) => c.includes("schema electrique") },
  { key: "ecu", label: "Connecteur ECU", match: (c) => c.includes("connecteur ecu") },
  { key: "plaque", label: "Plaque signalétique", match: (c) => c.includes("plaque") },
];

function findKeyDocuments(documents) {
  return KEY_DOC_MATCHERS.map(({ key, label, match }) => ({
    key,
    label,
    doc: documents.find((d) => match(d.category)),
  })).filter((k) => k.doc);
}

function StatTile({ icon: Icon, label, value }) {
  return (
    <li className="stat-tile">
      <span className="stat-tile__icon">
        <Icon />
      </span>
      <span className="stat-tile__label">{label}</span>
      <span className="stat-tile__value">{value}</span>
    </li>
  );
}

// Groupe les modèles d'une marque par ligne de produit (Xarios, Vector,
// Neos, Supra, Zephyr, V, T… — stockée dans la description du dossier
// modèle) — les modèles sans description tombent dans un groupe "Autres"
// affiché en dernier.
function groupByCategory(childFolders) {
  const groups = new Map();
  for (const f of childFolders) {
    const key = f.description || "Autres";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const entries = [...groups.entries()];
  entries.sort((a, b) => (a[0] === "Autres" ? 1 : b[0] === "Autres" ? -1 : a[0].localeCompare(b[0])));
  return entries;
}

function VehicleCategoryGroup({ category, models, open, onToggle, onOpenChild }) {
  return (
    <li className="vehicle-group">
      <button
        type="button"
        className="vehicle-group__head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="vehicle-group__title">{category}</span>
        <span className="vehicle-group__count">
          {models.length} modèle{models.length > 1 ? "s" : ""}
        </span>
        <span className={`vehicle-group__chevron ${open ? "is-open" : ""}`}>
          <IconChevron />
        </span>
      </button>
      {open && (
        <ul className="folder-grid vehicle-group__models">
          {models.map((f) => (
            <FolderCard key={f.id} folder={f} onOpen={onOpenChild} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FolderPage({
  space,
  folderId,
  version,
  onBack,
  onOpenDoc,
  onDeleteDoc,
  onAddPdf,
  onOpenChild,
  onChanged,
}) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [editingFolder, setEditingFolder] = useState(false);
  const [editingSpecs, setEditingSpecs] = useState(false);
  const [creatingChild, setCreatingChild] = useState(false);
  const [descOpen, setDescOpen] = useState(false);
  const [openCategories, setOpenCategories] = useState(() => new Set());
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef(null);

  useBackClose(onBack);

  const load = useCallback(() => {
    api
      .folderDetail(space, folderId)
      .then(setDetail)
      .catch((err) => setError(err.message || "Dossier inaccessible."));
  }, [space, folderId]);

  useEffect(load, [load, version]);

  const handleLogoFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingLogo(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
        reader.readAsDataURL(file);
      });
      await api.uploadFolderLogo(space, folderId, {
        data: dataUrl.split(",")[1],
        mimetype: file.type,
      });
      load();
      onChanged();
    } catch (err) {
      window.alert(err.message || "Envoi du logo impossible.");
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleLogoRemove = async () => {
    await api.deleteFolderLogo(space, folderId);
    load();
    onChanged();
  };

  const handleDeleteFolder = async () => {
    const { folder, childFolders, stats } = detail;
    const warning =
      `Supprimer le dossier « ${folder.name} » ?\n` +
      (childFolders.length
        ? `Ses ${childFolders.length} modèle(s) seront aussi supprimés. `
        : "") +
      (stats.documentCount || childFolders.length
        ? "Les documents seront conservés (non classés)."
        : "");
    if (!window.confirm(warning)) return;
    await api.deleteFolder(space, folder.id);
    onChanged();
    onBack();
  };

  if (error) {
    return (
      <div className="grid-empty">
        <p className="grid-empty__title">Dossier inaccessible</p>
        <p>{error}</p>
        <button className="btn" onClick={onBack}>
          ← Retour aux dossiers
        </button>
      </div>
    );
  }
  if (!detail) return <p className="grid-empty">Ouverture du dossier…</p>;

  const { folder, childFolders, documents, stats } = detail;
  const isBrand = !folder.parentId;

  return (
    <section className="folder-page">
      <header className="folder-page__head">
        <button className="folder-page__back" onClick={onBack} aria-label="Retour aux dossiers">
          ←
        </button>
        {isBrand && folder.hasLogo ? (
          <div className="folder-page__brand-logo-wrap">
            <img
              className="folder-page__brand-logo"
              src={api.folderLogoUrl(space, folder.id)}
              alt={folder.name}
            />
            <span className="folder-page__badge">
              {stats.documentCount} doc{stats.documentCount > 1 ? "s" : ""} lié
              {stats.documentCount > 1 ? "s" : ""}
            </span>
          </div>
        ) : (
          <div className="folder-page__title-row">
            <h1 className="folder-page__title">{folder.name}</h1>
            <span className="folder-page__badge">
              {stats.documentCount} doc{stats.documentCount > 1 ? "s" : ""} lié
              {stats.documentCount > 1 ? "s" : ""}
            </span>
          </div>
        )}
        {folder.description && (
          <div className={`folder-page__desc-wrap ${descOpen ? "is-open" : ""}`}>
            <p className="folder-page__desc">{folder.description}</p>
            {folder.description.length > 80 && (
              <button
                type="button"
                className="folder-page__desc-toggle"
                onClick={() => setDescOpen((o) => !o)}
              >
                {descOpen ? "Réduire" : "Voir plus"}
              </button>
            )}
          </div>
        )}
        <div className="folder-page__actions">
          <button className="btn btn--primary" onClick={() => onAddPdf(folder)}>
            + Ajouter un document
          </button>
          {isBrand && (
            <button className="btn" onClick={() => setCreatingChild(true)}>
              + Nouveau modèle
            </button>
          )}
          {isBrand && (
            <>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                hidden
                onChange={handleLogoFile}
              />
              <button
                className="btn"
                onClick={() => logoInputRef.current?.click()}
                disabled={uploadingLogo}
              >
                {uploadingLogo ? "Envoi…" : folder.hasLogo ? "Changer le logo" : "+ Logo"}
              </button>
              {folder.hasLogo && (
                <button className="btn" onClick={handleLogoRemove}>
                  Retirer le logo
                </button>
              )}
            </>
          )}
          <button className="btn" onClick={() => setEditingFolder(true)}>
            Modifier
          </button>
          <button className="btn btn--danger" onClick={handleDeleteFolder}>
            Supprimer
          </button>
        </div>
      </header>

      {stats.categories.length > 0 && (
        <ul className="stat-grid">
          {stats.categories.slice(0, 3).map((c) => (
            <StatTile key={c.name} icon={categoryIcon(c.name)} label={c.name} value={c.count} />
          ))}
        </ul>
      )}

      {!isBrand && (
        <section className="folder-page__section">
          <div className="folder-page__section-head">
            <h2 className="folder-page__section-title">Fiche technique</h2>
            <button type="button" className="btn" onClick={() => setEditingSpecs(true)}>
              Modifier la fiche
            </button>
          </div>
          <dl className="spec-sheet">
            {SPEC_FIELDS.map((f) => (
              <div className="spec-sheet__row" key={f.key}>
                <dt>{f.label}</dt>
                <dd>{folder.specs?.[f.key] || "—"}</dd>
              </div>
            ))}
          </dl>
          {folder.specs?.faultCodes?.length > 0 && (
            <div className="spec-sheet__codes">
              <span className="spec-sheet__codes-label">Codes défauts</span>
              <ul className="spec-sheet__code-list">
                {folder.specs.faultCodes.map((code) => (
                  <li key={code} className="spec-sheet__code">
                    {code}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {findKeyDocuments(documents).length > 0 && (
            <div className="spec-sheet__keydocs">
              <span className="spec-sheet__codes-label">Documents clés</span>
              <ul className="spec-sheet__keydoc-list">
                {findKeyDocuments(documents).map(({ key, label, doc }) => (
                  <li key={key}>
                    <button type="button" className="spec-sheet__keydoc" onClick={() => onOpenDoc(doc)}>
                      {label} <span className="spec-sheet__keydoc-name">{doc.filename}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {isBrand && childFolders.length > 0 && (
        <section className="folder-page__section">
          <div className="folder-page__section-head">
            <h2 className="folder-page__section-title">Modèles</h2>
          </div>
          <ul className="vehicle-group-list">
            {groupByCategory(childFolders).map(([category, models]) => (
              <VehicleCategoryGroup
                key={category}
                category={category}
                models={models}
                open={openCategories.has(category)}
                onToggle={() =>
                  setOpenCategories((prev) => {
                    const next = new Set(prev);
                    next.has(category) ? next.delete(category) : next.add(category);
                    return next;
                  })
                }
                onOpenChild={onOpenChild}
              />
            ))}
          </ul>
        </section>
      )}

      {(!isBrand || documents.length > 0) && (
        <section className="folder-page__section">
          <div className="folder-page__section-head">
            <h2 className="folder-page__section-title">
              {isBrand ? "Non classés (cette marque)" : "Documents"}
            </h2>
          </div>
          <DocumentGrid
            documents={documents}
            loading={false}
            onOpen={onOpenDoc}
            onDelete={onDeleteDoc}
          />
        </section>
      )}

      {creatingChild && (
        <FolderForm
          space={space}
          parentId={folder.id}
          onClose={() => setCreatingChild(false)}
          onSaved={() => {
            setCreatingChild(false);
            onChanged();
          }}
        />
      )}
      {editingFolder && (
        <FolderForm
          space={space}
          folder={folder}
          onClose={() => setEditingFolder(false)}
          onSaved={() => {
            setEditingFolder(false);
            onChanged();
          }}
        />
      )}
      {editingSpecs && (
        <SpecSheetForm
          folder={folder}
          onClose={() => setEditingSpecs(false)}
          onSaved={() => {
            setEditingSpecs(false);
            onChanged();
          }}
        />
      )}
    </section>
  );
}
