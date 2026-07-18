// Polyfill minimal pour DOMMatrix, requis par pdfjs-dist (dépendance de
// pdf-parse) même pour la simple extraction de texte (getText()) : le module
// canvas.js de pdfjs fait `new DOMMatrix()` au chargement, avant même qu'on
// touche au rendu qu'on n'utilise jamais.
//
// pdfjs-dist tente de charger `@napi-rs/canvas` (binaire natif compilé par
// plateforme) pour fournir ce global en environnement Node. En local ça
// fonctionne (binaire Windows présent), mais sur Vercel (Linux serverless)
// le binaire natif n'est pas chargé — probablement exclu du bundle par le
// traceur de fichiers de Vercel, qui ne suit pas les `require()` dynamiques
// et conditionnels de @napi-rs/canvas — et pdfjs plante au chargement avec
// `ReferenceError: DOMMatrix is not defined`.
//
// On ne fait jamais de rendu de page (seulement extraction de texte), donc
// un stub qui ne fait rien suffit : les vraies opérations matricielles
// (multiplySelf, invertSelf, etc.) ne sont exercées que par les chemins de
// code de rendu canvas, jamais par getText(). Testé de bout en bout sur un
// PDF réel avec le binaire natif explicitement simulé absent (voir la
// vérification faite lors de l'ajout de ce fichier).
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
