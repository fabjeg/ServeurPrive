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

## Palette (5 valeurs nommées)

| Nom        | Hex       | Usage |
|------------|-----------|-------|
| `givre`    | `#EEF3F7` | Fond de l'application |
| `banquise` | `#FFFFFF` | Surfaces, cartes, panneaux |
| `encre`    | `#14303C` | Texte, encre pétrole profonde |
| `glacier`  | `#2E7CA8` | Actions primaires, liens, focus |
| `balise`   | `#C2410C` | Réservé aux actions destructives (suppression) |

Les bandes de catégorie déclinent `glacier` et `encre` en teintes froides
(jamais de nouvel accent chaud). Thème clair et froid assumé — on évite
explicitement les trois looks génériques (crème/terracotta, near-black/acide,
broadsheet).

## Typographies

- **Bricolage Grotesque** — affichage, avec retenue : logotype, titre de page,
  écran de login, états vides. Jamais dans les listes.
- **IBM Plex Sans** — texte courant, formulaires, navigation.
- **IBM Plex Mono** — les "tampons" : métadonnées, tags, références, dates.

Chargées via `@fontsource` (pas de CDN).

## Layout

- **Rail gauche** : les *compartiments* (catégories) + compteurs, accès upload.
- **En-tête** : recherche type "manifeste" (champ large, mono pour la saisie),
  filtres par date.
- **Zone principale** : grille de fiches de congélation, tri par date d'entrée.
- **Viewer** : panneau plein écran sobre, fond `encre`, document centré.

## Justification par l'usage

Usage réel : retrouver vite un document précis parmi peu de catégories, le
prévisualiser, le télécharger. Donc : densité moyenne (cartes scannables, pas de
table dense), métadonnées en mono pour le balayage visuel, une seule couleur
d'action, et la fantaisie typographique cantonnée aux moments sans enjeu
(login, états vides).
