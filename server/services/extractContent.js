// Extraction de contenu partagée (PDF, texte, image) — utilisée par le résumé
// automatique (summarize.js) et le tool MCP get_document_content
// (server/mcp/index.js). Logique déplacée depuis mcp/index.js pour éviter
// la duplication entre les deux consommateurs.
import { fetchBlobResponse } from "./documents.js";

export const TEXT_MIMETYPES = /^(text\/|application\/(json|xml|javascript|x-yaml|csv))/;
export const IMAGE_MIMETYPES = /^image\/(png|jpeg|gif|webp)$/;
export const MAX_INLINE_BYTES = 4 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024; // extraction texte seulement, jamais inline
export const MAX_TEXT_CHARS = 60000;

// Résultat uniformisé, discriminé par `kind` :
// - "unsupported"    mimetype hors PDF / texte / image
// - "too_large"      dépasse la limite inline pour ce type
// - "unreachable"    blob inaccessible dans le stockage
// - "pdf"            { pages, truncated, text }
// - "pdf_no_text"    { pages } — scan sans couche texte, non extractible
// - "pdf_unreadable" PDF illisible (échec du parsing)
// - "text"           { text }
// - "image"          { base64, mimeType }
export async function extractContent(doc) {
  const isPdf = doc.mimetype === "application/pdf";
  const isText = TEXT_MIMETYPES.test(doc.mimetype);
  const isImage = IMAGE_MIMETYPES.test(doc.mimetype);

  if (!isPdf && !isText && !isImage) return { kind: "unsupported" };

  const maxBytes = isPdf ? MAX_PDF_BYTES : MAX_INLINE_BYTES;
  if (doc.size > maxBytes) return { kind: "too_large" };

  const blobRes = await fetchBlobResponse(doc);
  if (!blobRes.ok) return { kind: "unreachable" };

  if (isPdf) {
    const { PDFParse } = await import("pdf-parse");
    const buf = new Uint8Array(await blobRes.arrayBuffer());
    let parser;
    try {
      parser = new PDFParse({ data: buf });
      const parsed = await parser.getText();
      const text = (parsed.text || "").trim();
      if (!text) return { kind: "pdf_no_text", pages: parsed.total };
      const truncated = text.length > MAX_TEXT_CHARS;
      return {
        kind: "pdf",
        pages: parsed.total,
        truncated,
        text: truncated ? text.slice(0, MAX_TEXT_CHARS) : text,
      };
    } catch (err) {
      console.error("Extraction PDF échouée :", err?.message || err);
      return { kind: "pdf_unreadable" };
    } finally {
      await parser?.destroy().catch(() => {});
    }
  }

  if (isText) {
    const text = await blobRes.text();
    return { kind: "text", text };
  }

  const buf = Buffer.from(await blobRes.arrayBuffer());
  return { kind: "image", base64: buf.toString("base64"), mimeType: doc.mimetype };
}
