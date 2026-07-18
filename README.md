# Frigo ❄️ — chambre froide documentaire

Application privée mono-utilisateur pour stocker et consulter des documents
professionnels (PDF, images, plans…), avec connecteur MCP pour Claude.
**Rien n'est accessible sans authentification** — c'est l'exigence n°1.

Plan de design : voir [DESIGN.md](DESIGN.md).

## Architecture

```
frigo/
├── api/index.js          # Point d'entrée serverless Vercel (toutes les routes /api/*)
├── server/
│   ├── app.js            # Application Express
│   ├── lib/              # env, connexion Mongo (cache cold start), auth JWT + TOTP
│   ├── models/           # Schéma Mongo `documents` (métadonnées uniquement)
│   ├── routes/           # auth, upload (jetons), documents (listing, proxy, suppression)
│   ├── mcp/              # Serveur MCP (SDK officiel, Streamable HTTP, Bearer)
│   └── local.js          # Serveur API local (alternative à `vercel dev`)
├── client/               # React + Vite, SCSS 7-1 (src/styles/)
├── scripts/              # hash-password, totp-secret
└── vercel.json
```

### Règles de sécurité appliquées partout

1. **Aucun fichier ne transite par une fonction serverless** (limite 4,5 Mo) :
   l'upload va directement du navigateur vers Vercel Blob, avec un jeton signé
   par `/api/upload` **après** vérification de la session.
2. **Toutes les routes documentaires exigent la session** — listing,
   consultation et téléchargement compris (`server/routes/documents.js`).
3. **Jamais d'URL Blob côté client.** Les blobs sont privés
   (`access: 'private'`) ; la consultation passe par le proxy
   `GET /api/documents/:id/file` qui vérifie la session, récupère le blob via
   `BLOB_READ_WRITE_TOKEN` côté serveur, et streame la réponse.
4. Les réponses documentaires portent `Cache-Control: private, no-store`.
5. Le serveur MCP exige un jeton Bearer dédié (`MCP_ACCESS_TOKEN`).

## Mise en route

### 1. Prérequis

- Node.js ≥ 20, compte Vercel (CLI : `npm i -g vercel`), cluster MongoDB Atlas.

### 2. Installation

```bash
npm install
npm --prefix client install
```

### 3. Variables d'environnement

Copier `.env.example` vers `.env` et remplir :

```bash
npm run hash-password -- "votre-mot-de-passe"   # → AUTH_PASSWORD_HASH
npm run totp-secret                              # → TOTP_SECRET (2FA, recommandé)
```

- `MONGODB_URI` : chaîne de connexion Atlas (créer une base `frigo`).
- `BLOB_READ_WRITE_TOKEN` : fourni par Vercel quand un store Blob est lié au
  projet (Storage → Create → Blob). En local : `vercel env pull .env`.
- `JWT_SECRET`, `MCP_ACCESS_TOKEN` : longues valeurs aléatoires
  (`openssl rand -hex 32` ou équivalent).
- `GEMINI_API_KEY` : clé pour le chatbot documentaire, le résumé auto et
  l'analyse auto à l'upload (`server/lib/llm-chat.js`, `server/lib/llm.js`) —
  gratuite, sans carte bancaire requise :
  https://aistudio.google.com/apikey (bouton *Create API key*).

  Modèle utilisé : `gemini-3.1-flash-lite`, figé volontairement (voir le
  commentaire dans `server/lib/llm.js`) — un alias `-latest` a déjà changé de
  modèle sous le capot et cassé le chat (quota épuisé sur l'un,
  dépréciation sur l'autre). À mettre à jour manuellement, dans un commit
  dédié, si besoin de changer de modèle.

### 4. Développement local (Windows / VS Code)

Deux terminaux :

```bash
# Terminal 1 — API (vercel dev charge .env et émule les fonctions)
vercel dev --listen 3000

# Terminal 2 — Frontend (proxy /api → :3000)
npm run dev:client
```

Ouvrir http://localhost:5173. Alternative sans CLI Vercel :
`node --env-file=.env server/local.js` à la place du terminal 1.

> Note dev local : le callback `onUploadCompleted` de Vercel Blob ne peut pas
> joindre localhost ; le client confirme donc explicitement chaque upload via
> `POST /api/documents` (l'upsert par `blobPath` déduplique en production).

### 5. Déploiement

```bash
vercel            # lier le projet
# Dashboard Vercel : Storage → lier un store Blob (crée BLOB_READ_WRITE_TOKEN)
# Settings → Environment Variables : ajouter toutes les variables de .env.example
vercel --prod
```

`vercel.json` route `/api/*` vers la fonction Express et sert le build Vite
(`client/dist`) pour le reste.

## Connecter Claude (serveur MCP)

Le serveur MCP est exposé sur `https://votre-app.vercel.app/api/mcp`
(transport Streamable HTTP, stateless) avec trois tools :

| Tool | Description |
|------|-------------|
| `list_documents` | Liste avec filtres optionnels `category` / `tag` / `limit` |
| `search_documents` | Recherche par nom, tag ou catégorie |
| `get_document_content` | Contenu d'un document par ID (texte intégral, **texte extrait des PDF**, image inline, ou métadonnées pour les autres binaires) |
| `add_document` | Dépose un document (base64, ≤ 3 Mo, types MIME en liste blanche ; `source_url` et `description` optionnels pour la traçabilité) |
| `update_document` | Modifie nom, catégorie, tags et/ou description d'un document |
| `delete_document` | Supprime définitivement un document (confirmation utilisateur obligatoire) |

Les documents déposés par Claude portent `source: "claude"` en base (les
uploads web portent `source: "web"`).

Deux modes d'authentification :

- **Bearer** (`Authorization: Bearer <MCP_ACCESS_TOKEN>`) — pour Claude Code
  (`claude mcp add --transport http frigo <url> --header "Authorization: Bearer …"`) et les appels API.
- **Jeton dans l'URL** — `https://votre-app.vercel.app/api/mcp/<MCP_ACCESS_TOKEN>` —
  pour claude.ai/Claude Desktop, qui ne permettent pas de header statique sur un
  connecteur personnalisé. L'URL contient le secret : ne la partagez jamais.

### Enregistrement comme connecteur personnalisé

1. Déployer, puis vérifier :
   ```bash
   curl -X POST https://votre-app.vercel.app/api/mcp \
     -H "Authorization: Bearer VOTRE_MCP_ACCESS_TOKEN" \
     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
   ```
   (Sans le bon Bearer → 401, c'est voulu.)
2. **claude.ai** : Paramètres → Connecteurs → *Ajouter un connecteur personnalisé* →
   URL `https://votre-app.vercel.app/api/mcp`. Dans les options avancées,
   renseigner le jeton Bearer (`MCP_ACCESS_TOKEN`).
3. **Claude Desktop** : même chemin via Paramètres → Connecteurs (les connecteurs
   distants se synchronisent avec votre compte claude.ai).
4. Demander à Claude : *« Liste mes documents dans Frigo »* ou
   *« Résume le contrat X »*.

## API

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/auth/login` | `{ email, password, totp? }` → cookie de session |
| POST | `/api/auth/logout` | Détruit la session |
| GET | `/api/auth/me` | Session courante (401 sinon) |
| POST | `/api/upload` | Génère un jeton d'upload Blob (session requise) |
| GET | `/api/documents` | Listing — filtres `category`, `tag`, `q`, `from`, `to` |
| GET | `/api/documents/categories` | Catégories + compteurs |
| POST | `/api/documents` | Enregistre les métadonnées post-upload |
| GET | `/api/documents/:id` | Métadonnées d'un document |
| GET | `/api/documents/:id/file` | **Proxy authentifié** — stream du blob (`?download=1` pour forcer le téléchargement) |
| DELETE | `/api/documents/:id` | Supprime blob + métadonnées |
| POST | `/api/mcp` | Serveur MCP (Bearer `MCP_ACCESS_TOKEN`) |
