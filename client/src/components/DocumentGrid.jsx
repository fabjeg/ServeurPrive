import { DocumentCard } from "./DocumentCard.jsx";

export function DocumentGrid({ documents, loading, onOpen, onDelete }) {
  if (loading && !documents.length) {
    return <p className="grid-empty">Ouverture du compartiment…</p>;
  }
  if (!documents.length) {
    return (
      <div className="grid-empty">
        <p className="grid-empty__title">Compartiment vide</p>
        <p>Rien au froid ici pour l'instant.</p>
      </div>
    );
  }
  return (
    <ul className="doc-grid">
      {documents.map((doc) => (
        <DocumentCard key={doc.id} doc={doc} onOpen={onOpen} onDelete={onDelete} />
      ))}
    </ul>
  );
}
