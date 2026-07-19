import { useEffect, useState } from "react";
import { api } from "../api.js";
import { formatSize } from "./DocumentCard.jsx";
import { IconFolder, IconSnow } from "./Icons.jsx";
import { Viewer } from "./Viewer.jsx";
import { useBackClose } from "../hooks/useBackClose.js";

// Explorateur des dossiers de l'application, à 3 niveaux : racine (marques
// + non classés) -> marque ouverte (ses modèles + ses documents directs) ->
// modèle ouvert (ses documents) -> choix de destination d'upload. Si
// onPickDoc est fourni, un document existant peut aussi être sélectionné
// (rangé dans la destination courante, à n'importe quel niveau).
export function FolderBrowser({ space, folders = [], selectedId, onSelect, onClose, onPickDoc }) {
  const [query, setQuery] = useState("");
  const [openBrand, setOpenBrand] = useState(null); // null | { id, name } (id "" = non classés)
  const [openModel, setOpenModel] = useState(null); // null | { id, name }
  const [brandDetail, setBrandDetail] = useState(null); // { childFolders, documents }
  const [docs, setDocs] = useState(null); // null = chargement
  const [previewDoc, setPreviewDoc] = useState(null);

  useBackClose(onClose);

  // Détail de la marque ouverte (ses modèles + ses documents directs).
  useEffect(() => {
    if (!openBrand || !openBrand.id) return;
    setBrandDetail(null);
    api
      .folderDetail(space, openBrand.id)
      .then(setBrandDetail)
      .catch(() => setBrandDetail({ childFolders: [], documents: [] }));
  }, [space, openBrand]);

  // Documents du niveau le plus profond ouvert : modèle, marque sans
  // modèle sélectionné, ou non classés globaux.
  useEffect(() => {
    if (openModel) {
      setDocs(null);
      api
        .folderDetail(space, openModel.id)
        .then((res) => setDocs(res.documents))
        .catch(() => setDocs([]));
    } else if (openBrand && !openBrand.id) {
      setDocs(null);
      api
        .listDocuments(space, { folder: "none" })
        .then((res) => setDocs(res.documents))
        .catch(() => setDocs([]));
    } else {
      setDocs(null);
    }
  }, [space, openBrand, openModel]);

  const q = query.trim().toLowerCase();
  const showUnfiled = !q || "non classé".includes(q);

  const enterBrand = (id, name) => {
    setQuery("");
    setOpenBrand({ id, name });
    setOpenModel(null);
  };
  const enterModel = (f) => {
    setQuery("");
    setOpenModel({ id: f.id, name: f.name });
  };
  const backToRoot = () => {
    setQuery("");
    setOpenBrand(null);
    setOpenModel(null);
  };
  const backToBrand = () => {
    setQuery("");
    setOpenModel(null);
  };
  const choose = (id, name) => {
    onSelect(id, name);
    onClose();
  };

  // Niveau courant affiché : racine, marque, ou modèle.
  const level = openModel ? "model" : openBrand ? "brand" : "root";

  const visibleFolders =
    level === "root" ? (q ? folders.filter((f) => f.name.includes(q)) : folders) : [];
  const visibleChildFolders =
    level === "brand" && brandDetail
      ? q
        ? brandDetail.childFolders.filter((f) => f.name.includes(q))
        : brandDetail.childFolders
      : [];
  const brandOwnDocs = level === "brand" && brandDetail ? brandDetail.documents : null;
  const visibleDocs = docs && (q ? docs.filter((d) => d.filename.toLowerCase().includes(q)) : docs);

  // Peut-on choisir un document existant à ce niveau (jamais s'il y est déjà) ?
  const currentId = openModel ? openModel.id : openBrand ? openBrand.id : undefined;
  const canPickInList = onPickDoc && currentId !== undefined && currentId !== selectedId;

  let title = "Choisir un dossier";
  if (level === "model") title = openModel.name;
  else if (level === "brand") title = openBrand.name;

  const back = level === "model" ? backToBrand : level === "brand" ? backToRoot : null;

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
          {back ? (
            <div className="folder-browser__crumb">
              <button
                type="button"
                className="folder-page__back"
                onClick={back}
                aria-label="Retour"
              >
                ←
              </button>
              <h2 className={level === "brand" && !openBrand.id ? "folder-browser__title--unfiled" : ""}>
                {title}
              </h2>
            </div>
          ) : (
            <h2>{title}</h2>
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
          placeholder={level === "root" ? "Rechercher un dossier…" : "Rechercher…"}
          aria-label={level === "root" ? "Rechercher un dossier" : "Rechercher"}
        />

        {level === "root" && (
          <div className="folder-picker folder-browser__list" role="list" aria-label="Dossiers">
            {showUnfiled && (
              <button
                type="button"
                className={`folder-picker__item ${selectedId === "" ? "is-selected" : ""}`}
                onClick={() => enterBrand("", "Non classé")}
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
                onClick={() => enterBrand(f.id, f.name)}
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

        {level === "brand" && openBrand.id && (
          <>
            {!brandDetail && <p className="folder-browser__empty">Chargement…</p>}
            {brandDetail && (
              <>
                {visibleChildFolders.length > 0 && (
                  <div
                    className="folder-picker folder-browser__list"
                    role="list"
                    aria-label="Modèles"
                  >
                    {visibleChildFolders.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className={`folder-picker__item ${selectedId === f.id ? "is-selected" : ""}`}
                        onClick={() => enterModel(f)}
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
                  </div>
                )}
                <div className="folder-picker folder-browser__list" role="list" aria-label="Documents">
                  {brandOwnDocs.length === 0 && visibleChildFolders.length === 0 && (
                    <p className="folder-browser__empty">Dossier vide.</p>
                  )}
                  {brandOwnDocs
                    .filter((d) => !q || d.filename.toLowerCase().includes(q))
                    .map((d) => (
                      <div key={d.id} className="folder-browser__doc">
                        <button
                          type="button"
                          className="folder-browser__doc-open"
                          onClick={() => setPreviewDoc(d)}
                        >
                          <span className="folder-browser__doc-name">{d.filename}</span>
                          <span className="folder-picker__count">{formatSize(d.size)}</span>
                        </button>
                        {onPickDoc && openBrand.id !== selectedId && (
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
              </>
            )}
            <button type="button" className="btn btn--primary" onClick={() => choose(openBrand.id, openBrand.name)}>
              Ranger ici : {openBrand.name}
            </button>
          </>
        )}

        {level === "model" && (
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
                  {canPickInList && (
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
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => choose(openModel.id, openModel.name)}
            >
              Ranger ici : {openModel.name}
            </button>
          </>
        )}

        {level === "brand" && !openBrand.id && (
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
                  {canPickInList && (
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
            <button type="button" className="btn btn--primary" onClick={() => choose("", "Non classé")}>
              Laisser non classé
            </button>
          </>
        )}
      </div>

      {previewDoc && (
        <Viewer
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
          action={
            onPickDoc && currentId !== selectedId
              ? { label: "Choisir ce document", onClick: () => onPickDoc(previewDoc) }
              : undefined
          }
        />
      )}
    </div>
  );
}
