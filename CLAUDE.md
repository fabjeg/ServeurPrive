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

Streamable HTTP stateless (un serveur par POST). Six tools :
- `list_documents`, `search_documents`, `get_document_content`
  (texte des PDF extrait via pdf-parse v2, classe `PDFParse`)
- `add_document` : base64 ≤ **3 Mo** décodés (transite par la fonction,
  express.json limité à 4.5mb dans `server/app.js`), liste blanche MIME
  (pdf, png/jpeg/webp/gif, text/*, json), `source_url` + `description`
  optionnels, `source: "claude"` en base (`"web"` pour l'interface)
- `update_document` : métadonnées seulement (le blob n'est jamais déplacé,
  le nom affiché vient de `filename` via Content-Disposition du proxy)
- `delete_document` : exige `confirmed: true` et une confirmation explicite
  de l'utilisateur dans la conversation — jamais à l'initiative de l'IA

Convention métadonnées : catégories/tags en minuscules, style
« xarios 600 » / « schema electrique ».

## Commandes

```bash
npm install && npm --prefix client install   # depuis la racine UNIQUEMENT
node --env-file=.env server/local.js         # API locale :3000
npm run dev:client                           # Vite :5173 (proxy /api)
node --env-file=.env scripts/test-mcp-write.mjs [baseUrl]  # e2e MCP (14 checks)
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
