import { useEffect, useState } from "react";
import { api } from "../api.js";
import { formatDate, formatSize } from "./DocumentCard.jsx";
import { PdfViewer } from "./PdfViewer.jsx";
import { IconChevron, IconCollapse, IconExpand } from "./Icons.jsx";
import { useBackClose } from "../hooks/useBackClose.js";

// Viewer multi-format : s'adapte au mimetype. Toutes les sources pointent vers
// la route proxy authentifiée — jamais d'URL Blob directe.
export function Viewer({ doc, onClose, onDelete, action }) {
  const fileUrl = api.fileUrl(doc.space, doc.id);
  const isImage = doc.mimetype.startsWith("image/");
  const isPdf = doc.mimetype === "application/pdf";
  const isText = doc.mimetype.startsWith("text/");
  const canRead = isImage || isPdf;

  const [reading, setReading] = useState(false);
  // Repliée par défaut : la barre d'infos/actions n'apparaît qu'à la demande
  // (bouton flottant, ou tap sur l'image/le PDF) — priorité au document.
  // Se réinitialise à chaque changement de document.
  const [barHidden, setBarHidden] = useState(true);
  useEffect(() => setBarHidden(true), [doc.id]);

  useBackClose(onClose);

  // La bascule plein écran s'applique à toute la page (pas juste au viewer) :
  // ainsi le chat flottant, qui vit hors de ce composant, reste dans le même
  // sous-arbre affiché et donc toujours cliquable — jamais coupé par l'API
  // Fullscreen, qui masque tout ce qui est hors de l'élément demandé.
  useEffect(() => {
    const onChange = () => setReading(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleReading = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Fullscreen indisponible (iOS Safari, permission…) : on garde quand
      // même le mode lecture condensé ci-dessous, juste sans masquer la
      // barre d'adresse du navigateur.
      setReading((r) => !r);
    }
  };

  return (
    <div className="overlay overlay--viewer" role="dialog" aria-modal="true" aria-label={doc.filename}>
      <div className={`viewer ${reading ? "viewer--reading" : ""} ${barHidden ? "viewer--bar-hidden" : ""}`}>
        <header className="viewer__bar">
          <div className="viewer__info">
            <p className="viewer__name">{doc.filename}</p>
            <p className="viewer__stamp">
              {doc.category} · {formatDate(doc.uploadedAt)} · {formatSize(doc.size)}
            </p>
          </div>
          <div className="viewer__actions">
            {canRead && (
              <button
                type="button"
                className="btn"
                onClick={toggleReading}
                aria-pressed={reading}
                title={reading ? "Quitter le mode lecture" : "Mode lecture plein écran"}
              >
                {reading ? <IconCollapse /> : <IconExpand />}
              </button>
            )}
            {action && (
              <button className="btn btn--primary" onClick={action.onClick}>
                {action.label}
              </button>
            )}
            <a className="btn" href={api.downloadUrl(doc.space, doc.id)}>
              Télécharger
            </a>
            {onDelete && (
              <button className="btn btn--danger" onClick={() => onDelete(doc)}>
                Supprimer
              </button>
            )}
            <button className="overlay__close" onClick={onClose} aria-label="Fermer">
              ✕
            </button>
          </div>
        </header>

        {barHidden && (
          <button
            type="button"
            className="viewer__reveal"
            onClick={() => setBarHidden(false)}
            aria-label="Afficher les informations du document"
          >
            <IconChevron style={{ transform: "rotate(90deg)" }} />
          </button>
        )}

        <div
          className="viewer__stage"
          onClick={canRead ? () => setBarHidden((h) => !h) : undefined}
        >
          {isImage && <img src={fileUrl} alt={doc.filename} />}
          {isPdf && <PdfViewer url={fileUrl} downloadUrl={api.downloadUrl(doc.space, doc.id)} />}
          {isText && <iframe src={fileUrl} title={doc.filename} className="viewer__text" />}
          {!isImage && !isPdf && !isText && (
            <div className="viewer__fallback">
              <p>Pas de prévisualisation pour ce format ({doc.mimetype}).</p>
              <a className="btn btn--primary" href={api.downloadUrl(doc.space, doc.id)}>
                Télécharger le fichier
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
