import { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import { DocumentGrid } from "./DocumentGrid.jsx";
import { InterventionForm } from "./InterventionForm.jsx";
import { FolderForm } from "./FolderForm.jsx";
import { useBackClose } from "../hooks/useBackClose.js";
import { categoryIcon, IconChevron, IconClock, IconWrench } from "./Icons.jsx";

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

function InterventionRow({ intervention, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const hasDetails = intervention.steps.length > 0;

  return (
    <li className="intervention">
      <button
        className="intervention__main"
        onClick={() => hasDetails && setOpen((o) => !o)}
        aria-expanded={hasDetails ? open : undefined}
      >
        <span className="intervention__icon">
          <IconWrench />
        </span>
        <span className="intervention__body">
          <span className="intervention__title">{intervention.title}</span>
          <span className="intervention__note">
            {[
              intervention.note,
              intervention.steps.length
                ? `${intervention.steps.length} étape${intervention.steps.length > 1 ? "s" : ""}`
                : "",
            ]
              .filter(Boolean)
              .join(" • ") || "Procédure"}
          </span>
        </span>
        {intervention.durationMinutes > 0 && (
          <span className="intervention__duration">
            <IconClock /> {intervention.durationMinutes} min
          </span>
        )}
        {hasDetails && (
          <span className={`intervention__chevron ${open ? "is-open" : ""}`}>
            <IconChevron />
          </span>
        )}
      </button>
      {open && (
        <div className="intervention__details">
          <ol className="intervention__steps">
            {intervention.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          <div className="intervention__actions">
            <button className="btn" onClick={() => onEdit(intervention)}>
              Modifier
            </button>
            <button className="btn btn--danger" onClick={() => onDelete(intervention)}>
              Supprimer
            </button>
          </div>
        </div>
      )}
      {!hasDetails && (
        <div className="intervention__quick-actions">
          <button className="intervention__edit" onClick={() => onEdit(intervention)}>
            Modifier
          </button>
        </div>
      )}
    </li>
  );
}

export function FolderPage({ space, folderId, version, onBack, onOpenDoc, onDeleteDoc, onAddPdf, onChanged }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [interventionForm, setInterventionForm] = useState(null); // null | {} | { intervention }
  const [editingFolder, setEditingFolder] = useState(false);

  useBackClose(onBack);

  const load = useCallback(() => {
    api
      .folderDetail(space, folderId)
      .then(setDetail)
      .catch((err) => setError(err.message || "Dossier inaccessible."));
  }, [space, folderId]);

  useEffect(load, [load, version]);

  const handleDeleteFolder = async () => {
    const { folder, stats } = detail;
    const warning =
      `Supprimer le dossier « ${folder.name} » ?\n` +
      (stats.documentCount
        ? `Les ${stats.documentCount} document(s) seront conservés (non classés), `
        : "") +
      "ses interventions seront supprimées.";
    if (!window.confirm(warning)) return;
    await api.deleteFolder(space, folder.id);
    onChanged();
    onBack();
  };

  const handleDeleteIntervention = async (intervention) => {
    if (!window.confirm(`Supprimer l'intervention « ${intervention.title} » ?`)) return;
    await api.deleteIntervention(folderId, intervention.id);
    onChanged();
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

  const { folder, documents, interventions, stats } = detail;

  return (
    <section className="folder-page">
      <header className="folder-page__head">
        <button className="folder-page__back" onClick={onBack} aria-label="Retour aux dossiers">
          ←
        </button>
        <div className="folder-page__title-row">
          <h1 className="folder-page__title">{folder.name}</h1>
          <span className="folder-page__badge">
            {stats.documentCount} doc{stats.documentCount > 1 ? "s" : ""} lié
            {stats.documentCount > 1 ? "s" : ""}
          </span>
        </div>
        {folder.description && <p className="folder-page__desc">{folder.description}</p>}
        <div className="folder-page__actions">
          <button className="btn btn--primary" onClick={() => onAddPdf(folder)}>
            + Ajouter un document
          </button>
          <button className="btn" onClick={() => setEditingFolder(true)}>
            Modifier
          </button>
          <button className="btn btn--danger" onClick={handleDeleteFolder}>
            Supprimer
          </button>
        </div>
      </header>

      {(stats.categories.length > 0 || stats.avgDurationMinutes) && (
        <ul className="stat-grid">
          {stats.categories.slice(0, 3).map((c) => (
            <StatTile key={c.name} icon={categoryIcon(c.name)} label={c.name} value={c.count} />
          ))}
          {stats.avgDurationMinutes && (
            <StatTile icon={IconClock} label="Temps moy." value={`${stats.avgDurationMinutes} min`} />
          )}
        </ul>
      )}

      <section className="folder-page__section">
        <div className="folder-page__section-head">
          <h2 className="folder-page__section-title">
            <IconWrench /> Interventions fréquentes
          </h2>
          <button className="btn" onClick={() => setInterventionForm({})}>
            + Ajouter
          </button>
        </div>
        {interventions.length ? (
          <ul className="intervention-list">
            {interventions.map((i) => (
              <InterventionRow
                key={i.id}
                intervention={i}
                onEdit={(intervention) => setInterventionForm({ intervention })}
                onDelete={handleDeleteIntervention}
              />
            ))}
          </ul>
        ) : (
          <p className="folder-page__empty">
            Aucune intervention notée — ajouter les procédures qui reviennent souvent sur ce modèle.
          </p>
        )}
      </section>

      <section className="folder-page__section">
        <div className="folder-page__section-head">
          <h2 className="folder-page__section-title">Documents</h2>
        </div>
        <DocumentGrid
          documents={documents}
          loading={false}
          onOpen={onOpenDoc}
          onDelete={onDeleteDoc}
        />
      </section>

      {interventionForm && (
        <InterventionForm
          space={space}
          folderId={folder.id}
          intervention={interventionForm.intervention}
          onClose={() => setInterventionForm(null)}
          onSaved={() => {
            setInterventionForm(null);
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
    </section>
  );
}
