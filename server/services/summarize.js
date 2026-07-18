// Résumé automatique des documents à l'upload (web et MCP) — toujours
// best-effort : un échec (quota Gemini, PDF illisible, réseau) ne doit jamais
// remonter à l'appelant ni faire échouer l'upload. Voir generateSummary().
import { extractContent } from "./extractContent.js";
import { connectDb } from "../lib/db.js";
import { askLLM } from "../lib/llm.js";
import { Document } from "../models/Document.js";

const PROMPT_INSTRUCTION =
  "Résume ce document en 2-3 phrases, contexte : maintenance/réparation de chambres froides professionnelles.";
// Le contenu extrait peut aller jusqu'à 60 000 caractères (extractContent) ;
// on le raccourcit pour garder le prompt Gemini raisonnable.
const MAX_PROMPT_CHARS = 12000;

async function setStatus(docId, fields) {
  await connectDb();
  await Document.findByIdAndUpdate(docId, fields).catch(() => {});
}

export async function generateSummary(doc) {
  try {
    const extracted = await extractContent(doc);

    if (extracted.kind === "unsupported") {
      await setStatus(doc._id, { summaryStatus: "skipped" });
      return;
    }

    let content;
    let image;
    if (extracted.kind === "pdf" || extracted.kind === "text") {
      const text = extracted.text.slice(0, MAX_PROMPT_CHARS);
      content = `${PROMPT_INSTRUCTION}\n\nNom du fichier : ${doc.filename}\n\n${text}`;
    } else if (extracted.kind === "image") {
      content = `${PROMPT_INSTRUCTION}\n\nNom du fichier : ${doc.filename}`;
      image = { mimeType: extracted.mimeType, data: extracted.base64 };
    } else {
      // too_large, unreachable, pdf_no_text, pdf_unreadable : rien d'exploitable.
      throw new Error(`Contenu non exploitable pour le résumé (${extracted.kind}).`);
    }

    const summary = await askLLM([{ role: "user", content, image }]);
    await setStatus(doc._id, { summary: summary.trim(), summaryStatus: "done" });
  } catch (err) {
    console.error(`Résumé automatique échoué pour le document ${doc._id} :`, err.message || err);
    await setStatus(doc._id, { summaryStatus: "failed" });
  }
}
