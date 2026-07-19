import { api } from "../api.js";
import { IconChevron, IconFolder, IconSnow } from "./Icons.jsx";

export function FolderCard({ folder, onOpen }) {
  return (
    <li>
      <button className="folder-card" onClick={() => onOpen(folder)}>
        <span className="folder-card__icon">
          {folder.hasLogo ? (
            <img src={api.folderLogoUrl(folder.space, folder.id)} alt="" />
          ) : (
            <IconSnow />
          )}
        </span>
        <span className="folder-card__body">
          <span className="folder-card__title-row">
            <span className="folder-card__name">{folder.name}</span>
            <span className="folder-card__badge">
              {folder.documentCount} doc{folder.documentCount > 1 ? "s" : ""}
            </span>
          </span>
          <span className="folder-card__desc">
            {folder.description || "Dossier de documents"}
          </span>
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
    return <p className="grid-empty">Chargement…</p>;
  }
  return (
    <section>
      <div className="folder-grid__head">
        <h2 className="folder-grid__title">Marques</h2>
        <button className="btn" onClick={onCreate}>
          + Nouvelle marque
        </button>
      </div>
      {!folders.length && !unfiledCount ? (
        <div className="grid-empty">
          <p className="grid-empty__title">Aucune marque</p>
          <p>Créer une marque (ex. « carrier ») pour y ranger ses modèles.</p>
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
