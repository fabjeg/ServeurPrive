// OCR local (Tesseract.js) pour les photos scannées — donne à la fois le
// texte brut (entrée d'analyzeDocumentText, voir services/documents.js) et
// les bounding boxes par mot nécessaires à la couche texte invisible du PDF
// final (scanPdf.js). Choisi plutôt que la vision Gemini : positions de mots
// fiables (pixel-level) là où un LLM vision dérive sur les schémas denses, et
// aucun coût de quota Gemini (déjà tendu, voir lib/llm.js) par photo scannée.
import { createWorker } from "tesseract.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const LANG_PATH = path.dirname(fileURLToPath(new URL("../ocr-data/fra.traineddata.gz", import.meta.url)));
// Filtre les mots trop peu fiables (bruit de fond, artefacts) plutôt que de
// les faire tous atterrir dans la couche texte invisible.
const MIN_CONFIDENCE = 30;

let workerPromise;
function getWorker() {
  // Un seul worker réutilisé entre pages/appels d'une même instance chaude —
  // cachePath: "/tmp" évite de retélécharger quoi que ce soit au cold start
  // suivant tant que l'instance reste vivante.
  if (!workerPromise) {
    workerPromise = createWorker("fra", 1, { langPath: LANG_PATH, cachePath: "/tmp" });
  }
  return workerPromise;
}

// buffer : image JPEG/PNG brute (une page du scan). Renvoie le texte complet
// de la page et la liste des mots avec leur position en pixels de l'image
// d'origine (bbox Tesseract), telle quelle — sans conversion : scanPdf.js
// dimensionne la page PDF directement sur ces pixels.
export async function ocrImage(buffer) {
  const worker = await getWorker();
  const { data } = await worker.recognize(buffer);
  const words = (data.words || [])
    .filter((w) => w.confidence >= MIN_CONFIDENCE && w.text.trim())
    .map((w) => ({
      text: w.text,
      x0: w.bbox.x0,
      y0: w.bbox.y0,
      x1: w.bbox.x1,
      y1: w.bbox.y1,
    }));
  return { text: (data.text || "").trim(), words };
}
