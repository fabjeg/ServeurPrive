import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { api } from "../api.js";
import { formatSize } from "./DocumentCard.jsx";
import { IconFolder, IconSnow } from "./Icons.jsx";
import { FolderBrowser } from "./FolderBrowser.jsx";
import { ScanReview } from "./ScanReview.jsx";
import { useBackClose } from "../hooks/useBackClose.js";

const OWNER_PREFIX = "documents/owner";

function stamp() {
  return new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
}

// Assemble les pages scannées en un seul PDF A4 (chargé à la demande).
async function buildScanPdf(pages) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const pageW = 210;
  const pageH = 297;
  const margin = 6;
  pages.forEach((page, i) => {
    if (i > 0) pdf.addPage();
    const ratio = Math.min((pageW - 2 * margin) / page.width, (pageH - 2 * margin) / page.height);
    const w = page.width * ratio;
    const h = page.height * ratio;
    pdf.addImage(page.dataUrl, "JPEG", (pageW - w) / 2, (pageH - h) / 2, w, h);
  });
  const blob = pdf.output("blob");
  return new File([blob], `scan-${stamp()}.pdf`, { type: "application/pdf" });
}

export function UploadPanel({ folders = [], initialFolderId, onClose, onUploaded }) {
  const [files, setFiles] = useState([]);
  const [scanPages, setScanPages] = useState([]);
  const [reviewFile, setReviewFile] = useState(null);
  const [folderId, setFolderId] = useState(initialFolderId || "");
  const [browsingFolders, setBrowsingFolders] = useState(false);
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [progress, setProgress] = useState(null); // { label, percent }
  const [analysis, setAnalysis] = useState(null); // null | [{ filename, detected?, reason? }]
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const cameraRef = useRef(null);

  useBackClose(onClose);

  const addFiles = (list) => setFiles((prev) => [...prev, ...Array.from(list)]);
  const openCamera = () => cameraRef.current?.click();

  const hasContent = files.length > 0 || scanPages.length > 0;
  const selectedFolder = folders.find((f) => f.id === folderId);

  // Sélection d'un document existant dans l'explorateur : on le range dans
  // le dossier de destination courant (pas de nouvel upload).
  const pickExisting = async (doc) => {
    try {
      await api.updateDocument(doc.id, { folderId: folderId || "" });
      onUploaded();
    } catch (err) {
      setBrowsingFolders(false);
      setError(err.message || "Impossible de déplacer le document.");
    }
  };

  const uploadOne = async (file, meta) => {
    // Upload direct client → Blob privé (jeton signé par /api/upload après
    // vérification de session) : jamais via une fonction serverless.
    const blob = await upload(`${OWNER_PREFIX}/${file.name}`, file, {
      access: "private",
      handleUploadUrl: "/api/upload",
      clientPayload: JSON.stringify(meta),
      onUploadProgress: ({ percentage }) =>
        setProgress({ label: file.name, percent: Math.round(percentage) }),
    });
    const { document } = await api.registerDocument({
      ...meta,
      blobPath: blob.pathname,
      blobUrl: blob.url,
    });
    return document;
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!hasContent || progress) return;
    setError("");
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    const cat = category.trim().toLowerCase() || "divers";

    try {
      const queue = [...files];
      if (scanPages.length) {
        setProgress({ label: "Assemblage du scan…", percent: 0 });
        queue.push(await buildScanPdf(scanPages));
      }
      const uploaded = [];
      for (const file of queue) {
        uploaded.push(
          await uploadOne(file, {
            filename: file.name,
            mimetype: file.type || "application/octet-stream",
            category: cat,
            tags: tagList,
            size: file.size,
            folderId: folderId || undefined,
          })
        );
      }

      // Extraction automatique des informations clés (PDF uniquement) :
      // modèle → dossier, type → catégorie, version → tag. Un échec d'analyse
      // n'annule jamais l'upload — le document est déjà enregistré.
      const pdfs = uploaded.filter((d) => d.mimetype === "application/pdf");
      if (pdfs.length) {
        const results = [];
        for (const doc of pdfs) {
          setProgress({ label: `Analyse de ${doc.filename}…`, percent: 100 });
          try {
            const r = await api.analyzeDocument(doc.id);
            results.push({
              filename: doc.filename,
              detected: r.analyzed ? r.detected : null,
              reason: r.analyzed ? null : r.reason,
            });
          } catch {
            results.push({ filename: doc.filename, detected: null, reason: "Analyse impossible." });
          }
        }
        setProgress(null);
        setAnalysis(results);
      } else {
        onUploaded();
      }
    } catch (err) {
      setError(err.message || "Échec de l'upload.");
      setProgress(null);
    }
  };

  // Écran de synthèse post-analyse : ce que l'app a détecté et rangé.
  if (analysis) {
    return (
      <div className="overlay" role="dialog" aria-modal="true" aria-label="Analyse des documents">
        <div className="upload-panel">
          <div className="upload-panel__head">
            <h2>Informations détectées</h2>
            <button type="button" className="overlay__close" onClick={onUploaded} aria-label="Fermer">
              ✕
            </button>
          </div>
          <ul className="upload-panel__analysis">
            {analysis.map((r) => (
              <li key={r.filename}>
                <p className="upload-panel__analysis-file">{r.filename}</p>
                {r.detected ? (
                  <dl className="upload-panel__analysis-grid">
                    <dt>Modèle</dt>
                    <dd>{r.detected.model || "—"}</dd>
                    <dt>Type</dt>
                    <dd>{r.detected.category || "—"}</dd>
                    <dt>Version</dt>
                    <dd>{r.detected.version || "—"}</dd>
                    {r.detected.tags?.length > 0 && (
                      <>
                        <dt>Tags</dt>
                        <dd>{r.detected.tags.join(", ")}</dd>
                      </>
                    )}
                  </dl>
                ) : (
                  <p className="upload-panel__analysis-miss">
                    Non analysé : {r.reason || "raison inconnue"}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="upload-panel__hint">
            Les documents avec un modèle détecté ont été rangés dans le dossier correspondant.
          </p>
          <button type="button" className="btn btn--primary" onClick={onUploaded}>
            Terminer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Ajouter des documents">
      <form className="upload-panel" onSubmit={submit}>
        <div className="upload-panel__head">
          <h2>Ajouter des documents</h2>
          <button type="button" className="overlay__close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <div className="upload-panel__folders">
          <p className="field__label">Dossier de destination</p>
          <button
            type="button"
            className="folder-field"
            onClick={() => setBrowsingFolders(true)}
          >
            <span className={`folder-field__icon ${selectedFolder ? "" : "folder-field__icon--unfiled"}`}>
              {selectedFolder ? <IconSnow /> : <IconFolder />}
            </span>
            <span className={`folder-field__name ${selectedFolder ? "" : "folder-field__name--unfiled"}`}>
              {selectedFolder ? selectedFolder.name : "Non classé"}
            </span>
            <span className="folder-field__action">Parcourir</span>
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

        <button type="button" className="btn upload-panel__camera" onClick={openCamera}>
          📷 {scanPages.length ? "Scanner la page suivante" : "Scanner un document"}
        </button>
        {/* capture="environment" : ouvre directement la caméra arrière sur mobile */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            if (e.target.files[0]) setReviewFile(e.target.files[0]);
            e.target.value = "";
          }}
        />

        {scanPages.length > 0 && (
          <div className="upload-panel__scan-strip">
            {scanPages.map((p, i) => (
              <div key={i} className="upload-panel__scan-thumb">
                <img src={p.dataUrl} alt={`Page ${i + 1}`} />
                <button
                  type="button"
                  aria-label={`Retirer la page ${i + 1}`}
                  onClick={() => setScanPages((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
            <p className="upload-panel__scan-note">
              {scanPages.length} page{scanPages.length > 1 ? "s" : ""} → un seul PDF
            </p>
          </div>
        )}

        {files.length > 0 && (
          <ul className="upload-panel__files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span>{f.name}</span>
                <span className="upload-panel__size">{formatSize(f.size)}</span>
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

        <button className="btn btn--primary" type="submit" disabled={!hasContent || !!progress}>
          {progress ? `Envoi… ${progress.percent}%` : "Envoyer"}
        </button>
      </form>

      {browsingFolders && (
        <FolderBrowser
          folders={folders}
          selectedId={folderId}
          onSelect={setFolderId}
          onClose={() => setBrowsingFolders(false)}
          onPickDoc={pickExisting}
        />
      )}

      {reviewFile && (
        <ScanReview
          file={reviewFile}
          onValidate={(page) => {
            setScanPages((prev) => [...prev, page]);
            setReviewFile(null);
          }}
          onRetake={() => {
            setReviewFile(null);
            openCamera();
          }}
          onCancel={() => setReviewFile(null)}
        />
      )}
    </div>
  );
}
