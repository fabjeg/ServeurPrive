import { useState } from "react";
import { api } from "../api.js";
import { useBackClose } from "../hooks/useBackClose.js";

// Création / édition d'une intervention fréquente d'un dossier.
// Les étapes se saisissent une par ligne.
export function InterventionForm({ space, folderId, intervention, onClose, onSaved }) {
  const [title, setTitle] = useState(intervention?.title || "");
  const [note, setNote] = useState(intervention?.note || "");
  const [duration, setDuration] = useState(
    intervention?.durationMinutes ? String(intervention.durationMinutes) : ""
  );
  const [steps, setSteps] = useState((intervention?.steps || []).join("\n"));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useBackClose(onClose);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        title: title.trim(),
        note: note.trim(),
        durationMinutes: Number(duration) || 0,
        steps: steps.split("\n").map((s) => s.trim()).filter(Boolean),
      };
      const res = intervention
        ? await api.updateIntervention(folderId, intervention.id, body)
        : await api.createIntervention(space, folderId, body);
      onSaved(res.intervention);
    } catch (err) {
      setError(err.message || "Échec de l'enregistrement.");
      setBusy(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Intervention">
      <form className="panel-form" onSubmit={submit}>
        <div className="panel-form__head">
          <h2>{intervention ? "Modifier l'intervention" : "Nouvelle intervention"}</h2>
          <button type="button" className="overlay__close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <label className="field">
          <span className="field__label">Titre</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Remplacement sonde évaporateur"
            autoFocus
            required
          />
        </label>

        <div className="panel-form__row">
          <label className="field">
            <span className="field__label">Note courte</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Accès direct depuis la cabine"
            />
          </label>
          <label className="field panel-form__duration">
            <span className="field__label">Durée (min)</span>
            <input
              type="number"
              min="0"
              max="6000"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="12"
            />
          </label>
        </div>

        <label className="field">
          <span className="field__label">Étapes (une par ligne)</span>
          <textarea
            rows={6}
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
            placeholder={"Couper l'alimentation\nDéposer le capot\n…"}
          />
        </label>

        {error && <p className="panel-form__error">{error}</p>}

        <button className="btn btn--primary" type="submit" disabled={!title.trim() || busy}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </form>
    </div>
  );
}
