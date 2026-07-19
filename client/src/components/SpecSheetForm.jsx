import { useState } from "react";
import { api } from "../api.js";
import { useBackClose } from "../hooks/useBackClose.js";

// Édition de la fiche technique d'un modèle (réfrigérant, huile,
// compresseur, charge, fusibles, pressions HP/BP, codes défauts) — champs
// texte libres, sans validation d'unité (voir server/models/Folder.js).
// Même gabarit panel-form que FolderForm.jsx.
const FIELDS = [
  { key: "refrigerant", label: "Réfrigérant", placeholder: "R404A" },
  { key: "oil", label: "Huile", placeholder: "POE 68" },
  { key: "compressor", label: "Compresseur", placeholder: "Denso 10PA17C" },
  { key: "charge", label: "Charge", placeholder: "2.4 kg" },
  { key: "fuses", label: "Fusibles", placeholder: "15 A" },
  { key: "pressureHp", label: "Pression HP", placeholder: "18 bar" },
  { key: "pressureBp", label: "Pression BP", placeholder: "2 bar" },
];

export function SpecSheetForm({ folder, onClose, onSaved }) {
  const specs = folder.specs || {};
  const [values, setValues] = useState(() =>
    Object.fromEntries(FIELDS.map((f) => [f.key, specs[f.key] || ""]))
  );
  const [faultCodes, setFaultCodes] = useState((specs.faultCodes || []).join(", "));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useBackClose(onClose);

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        specs: {
          ...Object.fromEntries(FIELDS.map((f) => [f.key, values[f.key].trim()])),
          faultCodes: faultCodes
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
        },
      };
      const res = await api.updateFolder(folder.space, folder.id, body);
      onSaved(res.folder);
    } catch (err) {
      setError(err.message || "Échec de l'enregistrement.");
      setBusy(false);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Fiche technique">
      <form className="panel-form" onSubmit={submit}>
        <div className="panel-form__head">
          <h2>Fiche technique — {folder.name}</h2>
          <button type="button" className="overlay__close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        {FIELDS.map((f) => (
          <label className="field" key={f.key}>
            <span className="field__label">{f.label}</span>
            <input
              type="text"
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder={f.placeholder}
            />
          </label>
        ))}

        <label className="field">
          <span className="field__label">Codes défauts (séparés par des virgules)</span>
          <input
            type="text"
            value={faultCodes}
            onChange={(e) => setFaultCodes(e.target.value)}
            placeholder="A01, A12, A34"
          />
        </label>

        {error && <p className="panel-form__error">{error}</p>}

        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>
      </form>
    </div>
  );
}
