import { api } from "../api.js";
import { formatDate, formatSize } from "./DocumentCard.jsx";

// Viewer multi-format : s'adapte au mimetype. Toutes les sources pointent vers
// la route proxy authentifiée — jamais d'URL Blob directe.
export function Viewer({ doc, onClose, onDelete }) {
  const fileUrl = api.fileUrl(doc.id);
  const isImage = doc.mimetype.startsWith("image/");
  const isPdf = doc.mimetype === "application/pdf";
  const isText = doc.mimetype.startsWith("text/");

  return (
    <div className="overlay overlay--viewer" role="dialog" aria-modal="true" aria-label={doc.filename}>
      <div className="viewer">
        <header className="viewer__bar">
          <div className="viewer__info">
            <p className="viewer__name">{doc.filename}</p>
            <p className="viewer__stamp">
              {doc.category} · {formatDate(doc.uploadedAt)} · {formatSize(doc.size)}
            </p>
          </div>
          <div className="viewer__actions">
            <a className="btn" href={api.downloadUrl(doc.id)}>
              Télécharger
            </a>
            <button className="btn btn--danger" onClick={() => onDelete(doc)}>
              Supprimer
            </button>
            <button className="overlay__close" onClick={onClose} aria-label="Fermer">
              ✕
            </button>
          </div>
        </header>

        <div className="viewer__stage">
          {isImage && <img src={fileUrl} alt={doc.filename} />}
          {isPdf && <iframe src={fileUrl} title={doc.filename} />}
          {isText && <iframe src={fileUrl} title={doc.filename} className="viewer__text" />}
          {!isImage && !isPdf && !isText && (
            <div className="viewer__fallback">
              <p>Pas de prévisualisation pour ce format ({doc.mimetype}).</p>
              <a className="btn btn--primary" href={api.downloadUrl(doc.id)}>
                Télécharger le fichier
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
