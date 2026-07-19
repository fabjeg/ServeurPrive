# Frigo — notes pour Claude Code

Coffre documentaire privé mono-utilisateur (PDF, images, plans), construit le
2026-07-16 depuis une spec française. **Règle n°1 : rien n'est accessible sans
authentification.** Jamais de secret dans ce fichier ni dans le repo.

## État actuel (2026-07-16)

- **Production** : https://frigo-swart.vercel.app (projet Vercel `frigo`,
  store Blob privé `frigo-documents`, Atlas allowlist 0.0.0.0/0)
- **Repo** : https://github.com/fabjeg/ServeurPrive (branche `main`,
  `push.autoSetupRemote` actif). Pas d'auto-deploy GitHub→Vercel :
  déployer à la main avec `vercel --prod --yes` depuis la racine.
- PWA installée sur le téléphone de l'utilisateur ; TOTP 2FA activé ;
  connecteur MCP enregistré sur claude.ai (jeton dans l'URL).

## Stack et architecture

- **Frontend** : React + Vite + SCSS 7-1 (pas de Tailwind), `client/`.
  Design « chambre froide » (DESIGN.md) : cartes étiquettes congélateur,
  palette givre/banquise/encre/glacier/balise, Bricolage Grotesque + IBM Plex.
- **Backend** : Express en une seule fonction Vercel (`api/index.js` →
  `server/app.js`). `vercel.json` route `/api/*` et `/.well-known/*` vers la
  fonction, le reste vers le build Vite (fallback SPA).
- **Stockage** : Vercel Blob **privé** (@vercel/blob v2) pour les fichiers,
  MongoDB Atlas pour les métadonnées seulement (`server/models/Document.js`).
- **Scan photo → PDF searchable** : une photo prise via l'appareil
  (`ScanReview.jsx`) n'est plus assemblée en PDF-image côté client. Chaque
  page est uploadée individuellement (`scanPage: true` dans le
  `clientPayload`, ignoré par `onUploadCompleted` — voir `server/routes/
  upload.js`), puis `POST /api/documents/scan` crée le document
  (`ocrStatus: "pending"`, blob de la 1ʳᵉ page en placeholder) et répond
  immédiatement. En arrière-plan (`processScanDocument`, fire-and-forget via
  `waitUntil`, `server/services/documents.js`) : OCR Tesseract.js par page
  (`server/services/ocr.js`, langue française bundlée dans
  `server/ocr-data/`, jamais de fetch réseau) → assemblage en un seul PDF
  multi-pages avec `pdf-lib` (`server/services/scanPdf.js`, image visible +
  texte invisible `opacity: 0` positionné sur les bbox Tesseract) → le texte
  OCR sert directement d'entrée à `analyzeDocumentText` (pas de second appel
  d'extraction sur le PDF généré) → `ocrStatus: "done"`. Le client
  (`UploadPanel.jsx`) poll `GET /api/documents/:id` toutes les 2s tant que
  `ocrStatus === "pending"`.
- **Auth** : JWT cookie + TOTP optionnel, utilisateur unique défini par env.
  Supprimer la variable `TOTP_SECRET` sur Vercel désactive la 2FA
  (récupération en cas de perte de l'authenticator).

## Règles de sécurité (à ne jamais casser)

1. Les uploads web vont **directement** navigateur → Blob via jeton signé par
   `/api/upload` (les fonctions serverless plafonnent à 4,5 Mo).
2. Jamais d'URL Blob côté client : consultation via le proxy authentifié
   `GET /api/documents/:id/file` (Cache-Control: private, no-store).
3. Le serveur MCP exige `MCP_ACCESS_TOKEN` (Bearer OU jeton dans l'URL
   `/api/mcp/<token>` pour claude.ai). L'URL contient le secret : ne jamais
   la partager ni la committer.
4. `.env`, `.vercel`, `totp-qr.png` sont gitignorés — les garder ainsi.

## Serveur MCP (`server/mcp/index.js`)

Streamable HTTP stateless (un serveur par POST). Dix tools :
- `list_documents` (filtre `folder` par nom), `search_documents`,
  `get_document_content` (texte des PDF extrait via pdf-parse v2, classe `PDFParse`)
- `add_document` : base64 ≤ **3 Mo** décodés (transite par la fonction,
  express.json limité à 4.5mb dans `server/app.js`), liste blanche MIME
  (pdf, png/jpeg/webp/gif, text/*, json), `folder` (dossier créé au besoin),
  `source_url` + `description` optionnels, `source: "claude"` en base
- `update_document` : métadonnées seulement (le blob n'est jamais déplacé,
  le nom affiché vient de `filename` via Content-Disposition du proxy) ;
  `folder: ""` détache du dossier
- `list_folders`, `get_folder` : dossiers = hiérarchie 2 niveaux, marque
  (ex. « carrier », parentId null) → modèle (ex. « xarios 200 », parentId =
  id de la marque) ; une marque peut aussi porter des documents directement
  rattachés (équivalent d'un « non classé » scopé à cette marque).
  `add_document`/`update_document` résolvent un libellé plat façon
  « carrier xarios 600 » par préfixe de marque existante (voir
  `resolveFolderLabel` dans `server/mcp/index.js`) — pas de nouveau
  paramètre côté schéma MCP.
- `delete_document`, `delete_folder` : exigent `confirmed: true` et une
  confirmation explicite de l'utilisateur dans la conversation — jamais à
  l'initiative de l'IA. `delete_folder` conserve les documents (détachés,
  non classés) et supprime aussi les modèles enfants d'une marque.
- `update_model_specs` : fiche technique d'un modèle (réfrigérant, huile,
  compresseur, charge, fusibles, pressions HP/BP, codes défauts —
  `Folder.specs`, `server/models/Folder.js`). Merge champ par champ (un
  champ omis n'écrase pas l'existant) ; `fault_codes` remplace la liste
  entière. Pas de `confirmed` requis (additif/correctif, jamais destructeur)
  — à n'utiliser qu'après avoir lu un document donnant l'info de façon
  fiable, jamais une valeur inventée.

Convention métadonnées : catégories/tags/dossiers en minuscules, style
« carrier xarios 200 » / « schema electrique » (capitalisation en CSS).

L'assistant web (`server/routes/chat.js`, bouton IA de l'appli) est
lecture seule sur les documents mais peut lui aussi appeler
`update_model_specs` (même logique de fusion) — seule capacité d'écriture
qu'il possède.

## Commandes

```bash
npm install && npm --prefix client install   # depuis la racine UNIQUEMENT
node --env-file=.env server/local.js         # API locale :3000
npm run dev:client                           # Vite :5173 (proxy /api)
node --env-file=.env scripts/test-mcp-write.mjs [baseUrl]  # e2e MCP (23 checks)
vercel --prod --yes                          # déploiement production
```

Après un déploiement, relancer les tests e2e contre
`https://frigo-swart.vercel.app` pour valider.

## Pièges connus

- **cwd qui traîne dans `client/`** : un `vercel` lancé de là a déjà créé un
  projet parasite ; un `npm --prefix client install` depuis la racine a déjà
  auto-ajouté `"frigo": "file:.."` aux deps du client. Toujours vérifier le cwd.
- **EADDRINUSE :3000** : un vieux serveur local d'une session précédente peut
  tourner encore — `Get-NetTCPConnection -LocalPort 3000` puis `Stop-Process`.
- **Cache navigateur** après déploiement : le bundle précédent peut être servi,
  hard reload (ctrl+shift+r) avant de conclure qu'un fix ne marche pas.
- **pdfjs-dist** : `destroy()` vit sur la *loadingTask*, pas sur le document ;
  une exception dans un cleanup d'effet React fait un écran blanc total.
- **CSS flex** : un enfant flex ne scrolle pas sans `min-height: 0`.
- En dev local, le callback `onUploadCompleted` de Blob ne joint pas
  localhost : le client confirme chaque upload via `POST /api/documents`
  (upsert par `blobPath` déduplique en prod).
- `/tmp` sous Windows résout vers `C:\tmp` — utiliser le scratchpad.
- **`pdf-lib` `embedJpg` et le pool de Buffer Node** : `JpegEmbedder` lit le
  SOI via `new DataView(imageData.buffer)` sans tenir compte d'un
  `byteOffset` non nul — un petit `Buffer` alloué via le pool interne de Node
  (fréquent) plante avec `SOI not found in JPEG` alors que les octets sont
  corrects. Toujours passer une copie à offset 0 (`new Uint8Array(buffer)`)
  à `embedJpg`, jamais le Buffer brut — voir `server/services/scanPdf.js`.
- **Profondeur des dossiers plafonnée à 1** (marque → modèle) : imposée
  uniquement dans `server/services/folders.js` (`assertValidParent`), pas
  dans le schéma Mongoose — toute nouvelle fonction qui crée/modifie un
  dossier doit passer par ce garde-fou, sinon rien n'empêche une profondeur
  illimitée en base.
- **Résolution MCP par préfixe de marque** (`add_document`/`update_document`,
  libellé `folder` façon « carrier xarios 600 ») : si le libellé ne
  correspond à aucune marque existante par préfixe exact, le comportement de
  repli crée un dossier plat de premier niveau (comme avant la hiérarchie) —
  ne fonctionne donc pas pour une toute nouvelle marque qui n'a pas encore
  été créée via l'interface web. Limite acceptée. Idem, `findFolderByName`
  cherche maintenant sur tous les niveaux : deux modèles homonymes sous deux
  marques différentes sont ambigus par nom (app mono-utilisateur, limite
  acceptée).
