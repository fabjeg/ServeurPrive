import { api } from "../api.js";

// Élément signature : la fiche de congélation. Bande de catégorie sur la
// tranche, métadonnées tamponnées en mono. Les teintes de bande restent
// dans la gamme froide (bleu → pétrole), jamais de nouvel accent chaud.
function categoryHue(category) {
  let hash = 0;
  for (const ch of category) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return 185 + (hash % 55); // 185–240 : cyans et bleus froids
}

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

export function DocumentCard({ doc, onOpen, onDelete }) {
  const hue = categoryHue(doc.category);

  return (
    <li className="doc-card" style={{ "--strip-hue": hue }}>
      <span className="doc-card__strip" aria-hidden="true" />
      <button className="doc-card__body" onClick={() => onOpen(doc)}>
        <p className="doc-card__stamp">
          {kindLabel(doc.mimetype)} · {formatDate(doc.uploadedAt)} · {formatSize(doc.size)}
        </p>
        <p className="doc-card__name">{doc.filename}</p>
        <p className="doc-card__meta">
          <span className="doc-card__category">{doc.category}</span>
          {doc.tags.map((t) => (
            <span key={t} className="doc-card__tag">
              #{t}
            </span>
          ))}
        </p>
      </button>
      <div className="doc-card__actions">
        <a className="doc-card__action" href={api.downloadUrl(doc.id)} title="Télécharger">
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
