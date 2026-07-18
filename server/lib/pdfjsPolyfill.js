// Polyfills requis par pdfjs-dist (dépendance de pdf-parse) en environnement
// Node serverless (Vercel), même pour la simple extraction de texte
// (getText()) — voir le détail de chaque problème ci-dessous. Doit être
// importé avant toute route pouvant charger pdf-parse (voir server/app.js).
import { WorkerMessageHandler } from "pdfjs-dist/legacy/build/pdf.worker.mjs";

// 1) DOMMatrix — le module canvas.js de pdfjs fait `new DOMMatrix()` au
// chargement, avant même qu'on touche au rendu qu'on n'utilise jamais.
// pdfjs tente de charger `@napi-rs/canvas` (binaire natif compilé par
// plateforme) pour fournir ce global en environnement Node. En local ça
// fonctionne (binaire Windows présent), mais sur Vercel (Linux serverless)
// le binaire natif n'est pas chargé — le require() dynamique et
// conditionnel de @napi-rs/canvas n'est pas détecté par le traceur de
// fichiers de Vercel, qui l'exclut du bundle — et pdfjs plante au
// chargement avec `ReferenceError: DOMMatrix is not defined`.
//
// On ne fait jamais de rendu de page, donc un stub qui ne fait rien suffit :
// les vraies opérations matricielles (multiplySelf, invertSelf, etc.) ne
// sont exercées que par les chemins de code de rendu canvas, jamais par
// getText(). Testé de bout en bout sur un PDF réel avec le binaire natif
// explicitement simulé absent.
if (!globalThis.DOMMatrix) {
  class DOMMatrixStub {
    constructor() {}
    multiplySelf() {
      return this;
    }
    preMultiplySelf() {
      return this;
    }
    invertSelf() {
      return this;
    }
    translateSelf() {
      return this;
    }
    scaleSelf() {
      return this;
    }
    translate() {
      return this;
    }
    scale() {
      return this;
    }
  }
  globalThis.DOMMatrix = DOMMatrixStub;
}

// 2) Worker pdf.js — en l'absence d'un vrai Web Worker, pdfjs charge un
// « fake worker » en mémoire via `import(GlobalWorkerOptions.workerSrc)`
// (chemin de fichier résolu dynamiquement, "./pdf.worker.mjs" par défaut).
// Ce chemin dynamique n'est pas non plus détecté par le traceur de fichiers
// de Vercel : le fichier n'est jamais inclus dans le bundle serverless, et
// pdfjs échoue avec « Cannot find module '.../pdf.worker.mjs' ».
//
// pdfjs vérifie d'abord `globalThis.pdfjsWorker?.WorkerMessageHandler`
// avant de tenter ce chargement dynamique (voir PDFWorker._setupFakeWorkerGlobal
// dans pdfjs-dist) : en l'exposant nous-mêmes via un import STATIQUE (donc
// bien détecté et embarqué par le traceur), on court-circuite complètement
// le chargement dynamique défaillant.
globalThis.pdfjsWorker = { WorkerMessageHandler };
