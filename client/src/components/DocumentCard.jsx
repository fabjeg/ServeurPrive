import { api } from "../api.js";
import { IconAlert, IconDoc, IconImage } from "./Icons.jsx";

export function formatSize(bytes) {
  if (!bytes) return "— Ko";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function kindLabel(mimetype) {
  if (mimetype.startsWith("image/")) return "IMAGE";
  if (mimetype === "application/pdf") return "PDF";
  if (mimetype.startsWith("text/")) return "TEXTE";
  return "FICHIER";
}

function kindIcon(mimetype) {
  if (mimetype.startsWith("image/")) return IconImage;
  if (mimetype === "application/pdf" || mimetype.startsWith("text/")) return IconDoc;
  return IconAlert;
}

// Tuile document : pastille d'icône, nom, métadonnées en tampon mono,
// actions sur la tranche droite.
export function DocumentCard({ doc, onOpen, onDelete }) {
  const Kind = kindIcon(doc.mimetype);

  return (
    <li className="doc-card">
      <button className="doc-card__body" onClick={() => onOpen(doc)}>
        <span className="doc-card__icon">
          <Kind />
        </span>
        <span className="doc-card__text">
          <span className="doc-card__name">{doc.filename}</span>
          <span className="doc-card__stamp">
            {kindLabel(doc.mimetype)} · {formatDate(doc.uploadedAt)} · {formatSize(doc.size)}
          </span>
          <span className="doc-card__meta">
            <span className="doc-card__category">{doc.category}</span>
            {doc.tags.map((t) => (
              <span key={t} className="doc-card__tag">
                #{t}
              </span>
            ))}
          </span>
        </span>
      </button>
      <div className="doc-card__actions">
        <a className="doc-card__action" href={api.downloadUrl(doc.space, doc.id)} title="Télécharger">
          ↓
        </a>
        <button
          className="doc-card__action doc-card__action--danger"
          onClick={() => onDelete(doc)}
          title="Supprimer"
        >
          ✕
        </button>
      </div>
    </li>
  );
}
