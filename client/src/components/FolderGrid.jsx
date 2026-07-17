import { IconChevron, IconFolder, IconSnow, IconWrench } from "./Icons.jsx";

function FolderCard({ folder, onOpen }) {
  return (
    <li>
      <button className="folder-card" onClick={() => onOpen(folder)}>
        <span className="folder-card__icon">
          <IconSnow />
        </span>
        <span className="folder-card__body">
          <span className="folder-card__title-row">
            <span className="folder-card__name">{folder.name}</span>
            <span className="folder-card__badge">
              {folder.documentCount} doc{folder.documentCount > 1 ? "s" : ""}
            </span>
          </span>
          <span className="folder-card__desc">
            {folder.description || "Référentiel unique du modèle"}
          </span>
          {folder.interventionCount > 0 && (
            <span className="folder-card__meta">
              <IconWrench /> {folder.interventionCount} intervention
              {folder.interventionCount > 1 ? "s" : ""}
            </span>
          )}
        </span>
        <span className="folder-card__chevron">
          <IconChevron />
        </span>
      </button>
    </li>
  );
}

export function FolderGrid({ folders, unfiledCount, loading, onOpen, onOpenUnfiled, onCreate }) {
  if (loading && !folders.length) {
    return <p className="grid-empty">Ouverture du compartiment…</p>;
  }
  return (
    <section>
      <div className="folder-grid__head">
        <h2 className="folder-grid__title">Modèles de frigo</h2>
        <button className="btn" onClick={onCreate}>
          + Nouveau dossier
        </button>
      </div>
      {!folders.length && !unfiledCount ? (
        <div className="grid-empty">
          <p className="grid-empty__title">Compartiment vide</p>
          <p>Créer un dossier par modèle (ex. « carrier xarios 200 ») pour y ranger ses docs.</p>
        </div>
      ) : (
        <ul className="folder-grid">
          {folders.map((f) => (
            <FolderCard key={f.id} folder={f} onOpen={onOpen} />
          ))}
          {unfiledCount > 0 && (
            <li>
              <button className="folder-card folder-card--unfiled" onClick={onOpenUnfiled}>
                <span className="folder-card__icon">
                  <IconFolder />
                </span>
                <span className="folder-card__body">
                  <span className="folder-card__title-row">
                    <span className="folder-card__name">Non classés</span>
                    <span className="folder-card__badge">
                      {unfiledCount} doc{unfiledCount > 1 ? "s" : ""}
                    </span>
                  </span>
                  <span className="folder-card__desc">Documents sans dossier</span>
                </span>
                <span className="folder-card__chevron">
                  <IconChevron />
                </span>
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
