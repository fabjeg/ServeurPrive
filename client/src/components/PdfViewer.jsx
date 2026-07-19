import { useCallback, useEffect, useRef, useState } from "react";
import { IconChevron, IconMinus, IconPlus } from "./Icons.jsx";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

// Rendu PDF dans l'application via pdf.js : contrairement à une iframe, le
// document s'affiche partout (mobile compris) sans navigation hors de l'app.
// pdfjs-dist est chargé dynamiquement pour rester hors du bundle principal.
//
// Les pages sont rendues une seule fois à une résolution "base" (largeur du
// conteneur × devicePixelRatio) ; le zoom n'est ensuite qu'un redimensionnement
// CSS des canvas déjà rendus — pas de re-rendu pdf.js à chaque cran de zoom.
// Au-delà d'environ 2x, l'image perd en netteté (bitmap agrandi) : compromis
// accepté pour rester fluide sur un pinch-zoom mobile.
export function PdfViewer({ url, downloadUrl, initialPage }) {
  const containerRef = useRef(null);
  const pagesRef = useRef([]); // [{ wrapper, canvas, baseWidth, baseHeight }]
  const pinchRef = useRef(null); // { startDist, startZoom } pendant un pinch tactile
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let loadingTask = null;
    setZoom(1);
    setCurrentPage(1);
    pagesRef.current = [];

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

        // withCredentials : le proxy exige le cookie de session.
        loadingTask = pdfjs.getDocument({ url, withCredentials: true });
        const pdfDoc = await loadingTask.promise;
        if (cancelled) return;

        const container = containerRef.current;
        container.innerHTML = "";
        pagesRef.current = [];
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetWidth = Math.min(container.clientWidth - 16, 900);

        for (let i = 1; i <= pdfDoc.numPages; i++) {
          if (cancelled) return;
          const page = await pdfDoc.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = (targetWidth / base.width) * dpr;
          const viewport = page.getViewport({ scale });

          const wrapper = document.createElement("div");
          wrapper.className = "pdf-view__page";
          wrapper.dataset.pageNumber = String(i);

          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const baseWidth = viewport.width / dpr;
          const baseHeight = viewport.height / dpr;
          canvas.style.width = `${baseWidth}px`;
          canvas.style.height = `${baseHeight}px`;
          wrapper.appendChild(canvas);
          container.appendChild(wrapper);
          pagesRef.current.push({ wrapper, canvas, baseWidth, baseHeight });

          await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
          if (i === 1) setStatus("ready");
        }
        if (!cancelled) {
          setNumPages(pdfDoc.numPages);
          setStatus("ready");
        }
      } catch (err) {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      // destroy() vit sur la tâche de chargement (pas sur le document) et ne
      // doit jamais faire échouer le démontage React → écran blanc sinon.
      try {
        Promise.resolve(loadingTask?.destroy()).catch(() => {});
      } catch {
        // rien : le document est déjà libéré
      }
    };
  }, [url]);

  // Applique le zoom courant aux canvas déjà rendus (pas de re-rendu pdf.js).
  useEffect(() => {
    for (const p of pagesRef.current) {
      p.canvas.style.width = `${p.baseWidth * zoom}px`;
      p.canvas.style.height = `${p.baseHeight * zoom}px`;
    }
  }, [zoom, numPages]);

  // Suivi de la page visible pendant le défilement, pour l'indicateur "X / N".
  useEffect(() => {
    const container = containerRef.current;
    if (!container || status !== "ready") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setCurrentPage(Number(visible.target.dataset.pageNumber));
      },
      { root: container, threshold: [0.5] }
    );
    for (const p of pagesRef.current) observer.observe(p.wrapper);
    return () => observer.disconnect();
  }, [status, numPages]);

  const goToPage = useCallback((n) => {
    const target = pagesRef.current[n - 1];
    target?.wrapper.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Saut initial vers une page précise (lien envoyé par l'assistant) : attend
  // que TOUTES les pages soient rendues (numPages n'est posé qu'à la toute
  // fin du chargement), pas juste que le statut passe à "ready" (qui arrive
  // dès la première page).
  useEffect(() => {
    if (numPages > 0 && initialPage > 1) {
      goToPage(Math.min(initialPage, numPages));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numPages, url]);

  const zoomBy = (delta) => setZoom((z) => clampZoom(Math.round((z + delta) * 100) / 100));
  const resetZoom = () => setZoom(1);

  // Pinch tactile (mobile) : distance entre les deux doigts → facteur de zoom.
  const onTouchStart = (e) => {
    if (e.touches.length !== 2) return;
    const [a, b] = e.touches;
    const startDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    pinchRef.current = { startDist, startZoom: zoom };
  };
  const onTouchMove = (e) => {
    if (e.touches.length !== 2 || !pinchRef.current) return;
    e.preventDefault();
    const [a, b] = e.touches;
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const { startDist, startZoom } = pinchRef.current;
    setZoom(clampZoom(startZoom * (dist / startDist)));
  };
  const onTouchEnd = (e) => {
    if (e.touches.length < 2) pinchRef.current = null;
  };

  // Ctrl+molette (pinch trackpad desktop) : zoom sans faire défiler la page.
  const onWheel = (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  };

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
      <div
        className={`pdf-view__pages ${zoom !== 1 ? "is-zoomed" : ""}`}
        ref={containerRef}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onWheel={onWheel}
      />
      {status === "ready" && numPages > 0 && (
        <div className="pdf-view__toolbar" onClick={(e) => e.stopPropagation()}>
          <div className="pdf-view__pagenav">
            <button
              type="button"
              className="pdf-view__tool"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage <= 1}
              aria-label="Page précédente"
            >
              <IconChevron style={{ transform: "rotate(180deg)" }} />
            </button>
            <span className="pdf-view__page-count">
              {currentPage} / {numPages}
            </span>
            <button
              type="button"
              className="pdf-view__tool"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage >= numPages}
              aria-label="Page suivante"
            >
              <IconChevron />
            </button>
          </div>
          <div className="pdf-view__zoomnav">
            <button
              type="button"
              className="pdf-view__tool"
              onClick={() => zoomBy(-ZOOM_STEP)}
              disabled={zoom <= ZOOM_MIN}
              aria-label="Zoom arrière"
            >
              <IconMinus />
            </button>
            <button
              type="button"
              className="pdf-view__zoom-value"
              onClick={resetZoom}
              title="Réinitialiser le zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="pdf-view__tool"
              onClick={() => zoomBy(ZOOM_STEP)}
              disabled={zoom >= ZOOM_MAX}
              aria-label="Zoom avant"
            >
              <IconPlus />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
