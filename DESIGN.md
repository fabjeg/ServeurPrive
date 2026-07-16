# Frigo — Plan de design

## Concept

**Frigo** est une chambre froide documentaire : un coffre personnel pour des documents
professionnels qu'on consulte rarement mais qu'on ne doit jamais perdre. Le design
s'inspire de l'inventaire en chaîne du froid — étiquettes de congélation, tampons
d'inventaire, bandes de température — plutôt que d'un dashboard générique.

## Élément signature (le seul risque visuel)

La **fiche de congélation** : chaque document est une étiquette d'inventaire —
bande de catégorie colorée sur la tranche gauche de la carte, métadonnées tamponnées
en monospace (`REF`, date `JJ.MM.AAAA`, poids en Ko/Mo), nom du fichier en évidence.
Tout le reste de l'interface reste sobre et au service de la lisibilité.

## Couleurs : tokens par rôle, deux thèmes

Les composants ne consomment **que** des custom properties (`var(--bg)`,
`var(--surface)`, `var(--text)`, `var(--accent)`, …) définies dans
`client/src/styles/themes/_light.scss` et `_dark.scss`. Les 5 valeurs nommées
restent la source SCSS des thèmes (`abstracts/_variables.scss`) :

| Nom        | Hex       | Usage |
|------------|-----------|-------|
| `givre`    | `#EEF3F7` | Fond (clair), texte (sombre) |
| `banquise` | `#FFFFFF` | Surfaces claires, `--paper` (fond des documents) |
| `encre`    | `#14303C` | Texte (clair), surfaces (sombre) |
| `glacier`  | `#2E7CA8` | Actions primaires, liens, focus |
| `balise`   | `#C2410C` | Réservé aux actions destructives (suppression) |

**Thème clair** : fond givre, surfaces banquise, texte encre, accent glacier.
**Thème sombre** : déclinaison pétrole de la même identité — fond `#0E1F27`,
surfaces `#14303C`, texte givre, glacier éclairci `#64A9D1` et balise éclaircie
`#EF7D4F` pour tenir le contraste AA (vérifié par calcul WCAG dans les deux
thèmes). Pas de noir pur, pas de nouvel accent. Le Viewer/Scan reste la zone la
plus sombre de l'écran dans les deux thèmes (`--surface-inverse`).

Les bandes de catégorie déclinent des teintes froides (jamais de nouvel accent
chaud). On évite explicitement les trois looks génériques (crème/terracotta,
near-black/acide, broadsheet).

## Sélecteur « Apparence »

Contrôle segmenté **Clair / Sombre / Auto** dans la sidebar (radiogroup
accessible, flèches clavier). « Auto » suit `prefers-color-scheme` en direct.
Persistance `localStorage` (`frigo:theme`, absence de clé = Auto). Un script
inline dans `index.html` pose `data-theme` sur `<html>` avant le premier paint
(aucun flash), et `<meta name="theme-color">` suit le thème effectif
(`#2E7CA8` clair / `#0E1F27` sombre) pour la PWA.

## Typographies

- **Poppins** (400/500/600, self-hosted via `@fontsource`) — tout le texte :
  logotype, titres, corps, formulaires, navigation. Poppins étant plus large et
  géométrique : body `line-height: 1.55`, titres `letter-spacing: -0.01em`,
  graisse maximale 600.
- **IBM Plex Mono** — les "tampons" : métadonnées, tags, références, dates.
  C'est ce contraste mono/géométrique qui porte l'identité d'inventaire.

Échelle typographique en tokens (`--fs-xs` 0.6875rem → `--fs-2xl` 2.5rem,
`abstracts/_tokens.scss`) : aucune taille en dur dans les composants.

## Layout

- **Rail gauche** : les *compartiments* (catégories) + compteurs, sélecteur
  Apparence, accès upload.
- **En-tête** : recherche type "manifeste" (champ large, mono pour la saisie),
  filtres par date.
- **Zone principale** : grille de fiches de congélation, tri par date d'entrée.
- **Viewer** : panneau plein écran sobre, fond `--surface-inverse`, document
  centré sur fond `--paper`.

## Justification par l'usage

Usage réel : retrouver vite un document précis parmi peu de catégories, le
prévisualiser, le télécharger. Donc : densité moyenne (cartes scannables, pas de
table dense), métadonnées en mono pour le balayage visuel, une seule couleur
d'action, et la fantaisie typographique cantonnée aux moments sans enjeu
(login, états vides). `prefers-reduced-motion` désactive la seule transition
décorative (survol des cartes).
