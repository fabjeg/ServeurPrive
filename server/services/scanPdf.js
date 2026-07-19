// Assemble les pages d'un scan en un PDF "searchable" : l'image d'origine en
// couche visible, le texte OCR (services/ocr.js) en couche invisible
// superposée au-dessus (opacity: 0 — même principe que le rendu "Tr 3" des
// PDF scannés classiques). La page PDF est dimensionnée directement sur les
// pixels de l'image (mediaBox = largeur/hauteur de l'image) : les bbox
// Tesseract s'y reportent sans conversion DPI, donc sans risque de
// désalignement entre le texte invisible et l'image visible.
import { PDFDocument, StandardFonts } from "pdf-lib";

// pages : [{ buffer, words, text }] — words/text viennent de ocrImage()
// (services/ocr.js), dans l'ordre des pages du scan. La page PDF est
// dimensionnée sur les pixels réels de l'image embarquée (jpg.width/height,
// fournis par pdf-lib) — mêmes pixels que ceux vus par Tesseract, donc les
// bbox se reportent 1:1 sans conversion DPI.
export async function buildSearchablePdf(pages) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const p of pages) {
    // pdf-lib lit le SOI JPEG via `imageData.buffer` sans tenir compte d'un
    // éventuel byteOffset (Buffer issu du pool interne de Node, tranche d'un
    // buffer plus grand…) — copie défensive dans un Uint8Array à offset 0.
    const jpg = await pdfDoc.embedJpg(new Uint8Array(p.buffer));
    const { width, height } = jpg;
    const page = pdfDoc.addPage([width, height]);
    page.drawImage(jpg, { x: 0, y: 0, width, height });

    for (const word of p.words) {
      const size = Math.max(1, word.y1 - word.y0);
      try {
        page.drawText(word.text, {
          x: word.x0,
          y: height - word.y1,
          size,
          font,
          opacity: 0,
        });
      } catch {
        // Caractère non encodable en WinAnsi (ex. symbole OCR bruité) —
        // un mot manquant dans la couche invisible ne compromet ni le rendu
        // visible ni la lisibilité du reste du document.
      }
    }
  }

  return Buffer.from(await pdfDoc.save());
}
