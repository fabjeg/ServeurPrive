import { useEffect, useRef, useState } from "react";

// Rendu PDF dans l'application via pdf.js : contrairement à une iframe, le
// document s'affiche partout (mobile compris) sans navigation hors de l'app.
// pdfjs-dist est chargé dynamiquement pour rester hors du bundle principal.
export function PdfViewer({ url, downloadUrl }) {
  const containerRef = useRef(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error

  useEffect(() => {
    let cancelled = false;
    let pdfDoc = null;

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

        // withCredentials : le proxy exige le cookie de session.
        pdfDoc = await pdfjs.getDocument({ url, withCredentials: true }).promise;
        if (cancelled) return;

        const container = containerRef.current;
        container.innerHTML = "";
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetWidth = Math.min(container.clientWidth - 16, 900);

        for (let i = 1; i <= pdfDoc.numPages; i++) {
          if (cancelled) return;
          const page = await pdfDoc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = (targetWidth / base.width) * dpr;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = `${viewport.width / dpr}px`;
          container.appendChild(canvas);

          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
          if (i === 1) setStatus("ready");
        }
        setStatus("ready");
      } catch (err) {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      pdfDoc?.destroy();
    };
  }, [url]);

  return (
    <div className="pdf-view">
      {status === "loading" && <p className="pdf-view__status">Décongélation du document…</p>}
      {status === "error" && (
        <div className="pdf-view__status">
          <p>Impossible d'afficher ce PDF dans l'application.</p>
          <a className="btn btn--primary" href={downloadUrl}>
            Télécharger le fichier
          </a>
        </div>
      )}
      <div className="pdf-view__pages" ref={containerRef} />
    </div>
  );
}
