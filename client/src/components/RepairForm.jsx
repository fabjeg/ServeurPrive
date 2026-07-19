import { useState } from "react";
import { api } from "../api.js";
import { useBackClose } from "../hooks/useBackClose.js";

// Création / édition d'un cas de dépannage. Même gabarit panel-form que
// FolderForm.jsx/SpecSheetForm.jsx. `folderOptions` : liste plate
// { id, label } (marques + modèles) construite par RepairsPage.
export function RepairForm({ space, repair, folderOptions, onClose, onSaved, onDelete }) {
  const [folderId, setFolderId] = useState(repair?.folderId || "");
  const [symptom, setSymptom] = useState(repair?.symptom || "");
  const [diagnosis, setDiagnosis] = useState(repair?.diagnosis || "");
  const [solution, setSolution] = useState(repair?.solution || "");
  const [faultCodes, setFaultCodes] = useState((repair?.faultCodes || []).join(", "));
  const [partsUsed, setPartsUsed] = useState((repair?.partsUsed || []).join(", "));
  const [resolved, setResolved] = useState(repair ? repair.resolved : true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useBackClose(onClose);

  const splitList = (s) =>
    s
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

  const submit = async (e) => {
    e.preventDefault();
    if (!symptom.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        folderId: folderId || null,
        symptom: symptom.trim(),
        diagnosis: diagnosis.trim(),
        solution: solution.trim(),
        faultCodes: splitList(faultCodes),
        partsUsed: splitList(partsUsed),
        resolved,
      };
      const res = repair
        ? await api.updateRepair(space, repair.id, body)
        : await api.createRepair(space, body);
      onSaved(res.repair);
    } catch (err) {
      setError(err.message || "Échec de l'enregistrement.");
      setBusy(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Dépannage">
      <form className="panel-form" onSubmit={submit}>
        <div className="panel-form__head">
          <h2>{repair ? "Modifier le dépannage" : "Nouveau dépannage"}</h2>
          <button type="button" className="overlay__close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <label className="field">
          <span className="field__label">Modèle concerné (optionnel)</span>
          <select value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">— Non rattaché —</option>
            {folderOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Symptôme</span>
          <input
            type="text"
            value={symptom}
            onChange={(e) => setSymptom(e.target.value)}
            placeholder="Ne démarre pas, code défaut A12…"
            autoFocus
            required
          />
        </label>

        <label className="field">
          <span className="field__label">Diagnostic (optionnel)</span>
          <textarea
            rows={3}
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            placeholder="Cause identifiée"
          />
        </label>

        <label className="field">
          <span className="field__label">Solution (optionnelle)</span>
          <textarea
            rows={3}
            value={solution}
            onChange={(e) => setSolution(e.target.value)}
            placeholder="Réparation effectuée"
          />
        </label>

        <label className="field">
          <span className="field__label">Codes défauts (séparés par des virgules)</span>
          <input
            type="text"
            value={faultCodes}
            onChange={(e) => setFaultCodes(e.target.value)}
            placeholder="A01, A12"
          />
        </label>

        <label className="field">
          <span className="field__label">Pièces utilisées (séparées par des virgules)</span>
          <input
            type="text"
            value={partsUsed}
            onChange={(e) => setPartsUsed(e.target.value)}
            placeholder="Relais démarrage, fusible 15A"
          />
        </label>

        <label className="field field--checkbox">
          <input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} />
          <span>Panne résolue</span>
        </label>

        {error && <p className="panel-form__error">{error}</p>}

        <div className="repair-form__actions">
          <button className="btn btn--primary" type="submit" disabled={!symptom.trim() || busy}>
            {busy ? "Enregistrement…" : repair ? "Enregistrer" : "Créer le dépannage"}
          </button>
          {onDelete && (
            <button type="button" className="btn btn--danger" onClick={onDelete}>
              Supprimer
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
