import { useCallback, useEffect, useRef, useState } from "react";
import { useBackClose } from "../hooks/useBackClose.js";

const MAX_SIDE = 2200;

async function loadBitmap(file) {
  // from-image : respecte l'orientation EXIF des photos de téléphone.
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fallback ci-dessous */
    }
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// "Mode document" : niveaux de gris + étirement de contraste par percentiles.
// Le fond papier devient blanc, le texte ressort — l'effet scanner classique.
function documentFilter(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    px[i] = g;
    hist[g]++;
  }
  const total = px.length / 4;
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= total * 0.02) {
      lo = v;
      break;
    }
  }
  acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= total * 0.05) {
      hi = v;
      break;
    }
  }
  const range = Math.max(1, hi - lo);
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const n = Math.min(1, Math.max(0, (v - lo) / range));
    lut[v] = 255 * Math.pow(n, 0.9);
  }
  for (let i = 0; i < px.length; i += 4) {
    const g = lut[px[i]];
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(data, 0, 0);
}

export function ScanReview({ file, onValidate, onRetake, onCancel }) {
  const canvasRef = useRef(null);
  const baseRef = useRef(null); // canvas couleur non tourné
  const [rotation, setRotation] = useState(0);
  const [mode, setMode] = useState("document"); // document | couleur
  const [ready, setReady] = useState(false);

  useBackClose(onCancel);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const bmp = await loadBitmap(file);
      if (cancelled) return;
      const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
      const base = document.createElement("canvas");
      base.width = Math.round(bmp.width * scale);
      base.height = Math.round(bmp.height * scale);
      base.getContext("2d").drawImage(bmp, 0, 0, base.width, base.height);
      baseRef.current = base;
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [file]);

  const render = useCallback(() => {
    const base = baseRef.current;
    const canvas = canvasRef.current;
    if (!base || !canvas) return;
    const quarter = rotation % 180 !== 0;
    canvas.width = quarter ? base.height : base.width;
    canvas.height = quarter ? base.width : base.height;
    const ctx = canvas.getContext("2d");
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.drawImage(base, -base.width / 2, -base.height / 2);
    ctx.restore();
    if (mode === "document") documentFilter(ctx, canvas.width, canvas.height);
  }, [rotation, mode]);

  useEffect(() => {
    if (ready) render();
  }, [ready, render]);

  const validate = () => {
    const canvas = canvasRef.current;
    onValidate({
      dataUrl: canvas.toDataURL("image/jpeg", 0.85),
      width: canvas.width,
      height: canvas.height,
    });
  };

  return (
    <div className="overlay overlay--scan" role="dialog" aria-modal="true" aria-label="Vérifier le scan">
      <div className="scan-review">
        <div className="scan-review__stage">
          {!ready && <p className="scan-review__loading">Préparation…</p>}
          <canvas ref={canvasRef} />
        </div>
        <div className="scan-review__tools">
          <button type="button" className="btn" onClick={() => setRotation((r) => (r + 90) % 360)}>
            ↻ Pivoter
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setMode((m) => (m === "document" ? "couleur" : "document"))}
          >
            {mode === "document" ? "Voir en couleur" : "Mode document"}
          </button>
        </div>
        <div className="scan-review__actions">
          <button type="button" className="btn" onClick={onRetake}>
            Reprendre
          </button>
          <button type="button" className="btn btn--primary" onClick={validate} disabled={!ready}>
            Ajouter la page
          </button>
        </div>
        <button type="button" className="scan-review__cancel" onClick={onCancel}>
          Annuler le scan
        </button>
      </div>
    </div>
  );
}
