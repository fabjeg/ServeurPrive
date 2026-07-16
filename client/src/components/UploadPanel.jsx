import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { api } from "../api.js";
import { formatSize } from "./DocumentCard.jsx";

const OWNER_PREFIX = "documents/owner";

export function UploadPanel({ onClose, onUploaded }) {
  const [files, setFiles] = useState([]);
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [progress, setProgress] = useState(null); // { index, percent }
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const cameraRef = useRef(null);

  const addFiles = (list) => setFiles((prev) => [...prev, ...Array.from(list)]);

  // Les photos prises à la volée arrivent souvent nommées "image.jpg" :
  // on les renomme avec un horodatage pour les retrouver dans l'inventaire.
  const addScans = (list) => {
    const scans = Array.from(list).map((file) => {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      const ext = (file.name.match(/\.\w+$/) || [".jpg"])[0];
      return new File([file], `scan-${stamp}${ext}`, { type: file.type });
    });
    setFiles((prev) => [...prev, ...scans]);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!files.length) return;
    setError("");
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress({ index: i, percent: 0 });
        const meta = {
          filename: file.name,
          mimetype: file.type || "application/octet-stream",
          category: category.trim().toLowerCase() || "divers",
          tags: tagList,
          size: file.size,
        };
        // Upload direct client → Blob (jeton signé par /api/upload après
        // vérification de session) : le fichier ne transite jamais par une
        // fonction serverless (limite 4,5 Mo).
        const blob = await upload(`${OWNER_PREFIX}/${file.name}`, file, {
          access: "private",
          handleUploadUrl: "/api/upload",
          clientPayload: JSON.stringify(meta),
          onUploadProgress: ({ percentage }) =>
            setProgress({ index: i, percent: Math.round(percentage) }),
        });
        // Confirmation explicite : enregistre les métadonnées en Mongo
        // (le callback onUploadCompleted ne joint pas localhost ; l'upsert
        // serveur déduplique en production).
        await api.registerDocument({ ...meta, blobPath: blob.pathname, blobUrl: blob.url });
      }
      onUploaded();
    } catch (err) {
      setError(err.message || "Échec de l'upload.");
      setProgress(null);
    }
  };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Mettre au froid">
      <form className="upload-panel" onSubmit={submit}>
        <div className="upload-panel__head">
          <h2>Mettre au froid</h2>
          <button type="button" className="overlay__close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <div
          className="upload-panel__drop"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <p>Déposer des fichiers ici, ou cliquer pour parcourir</p>
          <p className="upload-panel__hint">PDF, images, plans — tout format accepté</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => addFiles(e.target.files)}
          />
        </div>

        <button
          type="button"
          className="btn upload-panel__camera"
          onClick={() => cameraRef.current?.click()}
        >
          📷 Scanner avec l'appareil photo
        </button>
        {/* capture="environment" : ouvre directement la caméra arrière sur mobile */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            addScans(e.target.files);
            e.target.value = ""; // permet de scanner plusieurs pages d'affilée
          }}
        />

        {files.length > 0 && (
          <ul className="upload-panel__files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span>{f.name}</span>
                <span className="upload-panel__size">
                  {progress && progress.index === i
                    ? `${progress.percent}%`
                    : formatSize(f.size)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="upload-panel__fields">
          <label className="field">
            <span className="field__label">Catégorie</span>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="factures, contrats, plans…"
            />
          </label>
          <label className="field">
            <span className="field__label">Tags (séparés par des virgules)</span>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="2026, client-x"
            />
          </label>
        </div>

        {error && <p className="upload-panel__error">{error}</p>}

        <button className="btn btn--primary" type="submit" disabled={!files.length || !!progress}>
          {progress ? `Congélation… ${progress.percent}%` : "Congeler"}
        </button>
      </form>
    </div>
  );
}
