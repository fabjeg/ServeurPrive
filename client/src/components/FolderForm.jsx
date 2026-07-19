import { useState } from "react";
import { api } from "../api.js";
import { useBackClose } from "../hooks/useBackClose.js";

// Création / édition d'un dossier (marque ou modèle de frigo). Nom en
// minuscules, même convention que les catégories — la capitalisation est
// faite en CSS. `parentId` : présent uniquement à la création d'un modèle
// sous une marque (plomberie invisible, pas de champ dans le formulaire —
// le contexte de création le rend déjà explicite pour l'utilisateur).
export function FolderForm({ space, folder, parentId, onClose, onSaved }) {
  const [name, setName] = useState(folder?.name || "");
  const [description, setDescription] = useState(folder?.description || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isModel = Boolean(parentId || folder?.parentId);

  useBackClose(onClose);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = { name: name.trim().toLowerCase(), description: description.trim(), parentId };
      const res = folder
        ? await api.updateFolder(folder.space, folder.id, body)
        : await api.createFolder(space, body);
      onSaved(res.folder);
    } catch (err) {
      setError(err.message || "Échec de l'enregistrement.");
      setBusy(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Dossier">
      <form className="panel-form" onSubmit={submit}>
        <div className="panel-form__head">
          <h2>{folder ? "Modifier le dossier" : isModel ? "Nouveau modèle" : "Nouvelle marque"}</h2>
          <button type="button" className="overlay__close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <label className="field">
          <span className="field__label">{isModel ? "Modèle" : "Marque"}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={isModel ? "xarios 200" : "carrier"}
            autoFocus
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Description (optionnelle)</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Référentiel unique du modèle"
          />
        </label>

        {error && <p className="panel-form__error">{error}</p>}

        <button className="btn btn--primary" type="submit" disabled={!name.trim() || busy}>
          {busy ? "Enregistrement…" : folder ? "Enregistrer" : "Créer le dossier"}
        </button>
      </form>
    </div>
  );
}
