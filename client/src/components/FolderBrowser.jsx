import { useEffect, useState } from "react";
import { api } from "../api.js";
import { formatSize } from "./DocumentCard.jsx";
import { IconFolder, IconSnow } from "./Icons.jsx";
import { Viewer } from "./Viewer.jsx";
import { useBackClose } from "../hooks/useBackClose.js";

// Explorateur des dossiers de l'application : niveau racine (recherche +
// liste des dossiers), puis navigation dans un dossier pour voir ses
// documents avant de le choisir comme destination d'upload. Si onPickDoc est
// fourni, un document existant peut aussi être sélectionné (rangé dans la
// destination courante).
export function FolderBrowser({ space, folders = [], selectedId, onSelect, onClose, onPickDoc }) {
  const [query, setQuery] = useState("");
  // null = racine ; { id, name } = dossier ouvert (id "" = non classés).
  const [open, setOpen] = useState(null);
  const [docs, setDocs] = useState(null); // null = chargement
  const [previewDoc, setPreviewDoc] = useState(null);

  useBackClose(onClose);

  // Documents du dossier ouvert (ou des non-classés).
  useEffect(() => {
    if (!open) return;
    setDocs(null);
    const load = open.id
      ? api.folderDetail(space, open.id).then((res) => res.documents)
      : api.listDocuments(space, { folder: "none" }).then((res) => res.documents);
    load.then(setDocs).catch(() => setDocs([]));
  }, [space, open]);

  const q = query.trim().toLowerCase();
  const visibleFolders = q ? folders.filter((f) => f.name.includes(q)) : folders;
  const showUnfiled = !q || "non classé".includes(q);
  const visibleDocs = docs && (q ? docs.filter((d) => d.filename.toLowerCase().includes(q)) : docs);

  const enter = (id, name) => {
    setQuery("");
    setOpen({ id, name });
  };
  const backToRoot = () => {
    setQuery("");
    setOpen(null);
  };
  const choose = () => {
    onSelect(open.id);
    onClose();
  };
  // Sélection d'un document existant, sauf s'il est déjà dans la destination.
  const canPick = onPickDoc && open && open.id !== selectedId;

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Choisir un dossier"
      onClick={onClose}
    >
      <div className="folder-browser" onClick={(e) => e.stopPropagation()}>
        <div className="folder-browser__head">
          {open ? (
            <div className="folder-browser__crumb">
              <button
                type="button"
                className="folder-page__back"
                onClick={backToRoot}
                aria-label="Retour à la liste des dossiers"
              >
                ←
              </button>
              <h2 className={open.id ? "" : "folder-browser__title--unfiled"}>{open.name}</h2>
            </div>
          ) : (
            <h2>Choisir un dossier</h2>
          )}
          <button type="button" className="overlay__close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <input
          type="search"
          className="folder-browser__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={open ? "Rechercher un document…" : "Rechercher un dossier…"}
          aria-label={open ? "Rechercher un document" : "Rechercher un dossier"}
        />

        {!open && (
          <div className="folder-picker folder-browser__list" role="list" aria-label="Dossiers">
            {showUnfiled && (
              <button
                type="button"
                className={`folder-picker__item ${selectedId === "" ? "is-selected" : ""}`}
                onClick={() => enter("", "Non classé")}
              >
                <span className="folder-picker__icon folder-picker__icon--unfiled">
                  <IconFolder />
                </span>
                <span className="folder-picker__name folder-picker__name--unfiled">Non classé</span>
              </button>
            )}
            {visibleFolders.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`folder-picker__item ${selectedId === f.id ? "is-selected" : ""}`}
                onClick={() => enter(f.id, f.name)}
              >
                <span className="folder-picker__icon">
                  <IconSnow />
                </span>
                <span className="folder-picker__name">{f.name}</span>
                <span className="folder-picker__count">
                  {f.documentCount} doc{f.documentCount > 1 ? "s" : ""}
                </span>
              </button>
            ))}
            {!showUnfiled && visibleFolders.length === 0 && (
              <p className="folder-browser__empty">Aucun dossier ne correspond.</p>
            )}
          </div>
        )}

        {open && (
          <>
            <div className="folder-picker folder-browser__list" role="list" aria-label="Documents">
              {!visibleDocs && <p className="folder-browser__empty">Chargement…</p>}
              {visibleDocs && visibleDocs.length === 0 && (
                <p className="folder-browser__empty">
                  {q ? "Aucun document ne correspond." : "Dossier vide."}
                </p>
              )}
              {visibleDocs?.map((d) => (
                <div key={d.id} className="folder-browser__doc">
                  <button
                    type="button"
                    className="folder-browser__doc-open"
                    onClick={() => setPreviewDoc(d)}
                  >
                    <span className="folder-browser__doc-name">{d.filename}</span>
                    <span className="folder-picker__count">{formatSize(d.size)}</span>
                  </button>
                  {canPick && (
                    <button
                      type="button"
                      className="folder-browser__doc-pick"
                      onClick={() => onPickDoc(d)}
                    >
                      Choisir
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button type="button" className="btn btn--primary" onClick={choose}>
              {open.id ? `Ranger ici : ${open.name}` : "Laisser non classé"}
            </button>
          </>
        )}
      </div>

      {previewDoc && (
        <Viewer
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
          action={canPick ? { label: "Choisir ce document", onClick: () => onPickDoc(previewDoc) } : undefined}
        />
      )}
    </div>
  );
}
