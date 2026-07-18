// Migration ponctuelle : backfill `space: "pro"` sur les documents/dossiers
// créés avant l'introduction du cloisonnement pro/perso, puis resynchronise
// les index de Document/Folder avec leur nouvelle définition de schéma
// (index texte filename+tags -> +extractedText ; index unique dossier
// {ownerId,name} -> {ownerId,space,name}).
//
// Usage : node --env-file=.env scripts/migrate-space.js
//
// Touche la base Atlas partagée entre le dev local et la prod (même
// MONGODB_URI) — à exécuter une seule fois, en connaissance de cause.
import mongoose from "mongoose";
import { env } from "../server/lib/env.js";
import { Document } from "../server/models/Document.js";
import { Folder } from "../server/models/Folder.js";

async function main() {
  // autoIndex: false — pas de synchronisation automatique en arrière-plan
  // pendant qu'on gère l'index texte à la main plus bas (un seul index texte
  // possible par collection Mongo : l'ancien doit disparaître avant que le
  // nouveau, de forme différente, puisse être créé).
  await mongoose.connect(env.mongodbUri, { autoIndex: false });
  console.log("Connecté à MongoDB.");

  const docsResult = await Document.updateMany(
    { space: { $exists: false } },
    { $set: { space: "pro" } }
  );
  console.log(`Documents migrés (space: "pro") : ${docsResult.modifiedCount}`);

  const foldersResult = await Folder.updateMany(
    { space: { $exists: false } },
    { $set: { space: "pro" } }
  );
  console.log(`Dossiers migrés (space: "pro") : ${foldersResult.modifiedCount}`);

  // syncIndexes() compare les index déclarés dans le schéma avec ceux
  // réellement présents en base : supprime ceux qui ne correspondent plus
  // (ancien index texte, ancien index unique dossier) et crée les nouveaux.
  console.log("Resynchronisation des index Document…");
  const docIndexChanges = await Document.syncIndexes();
  console.log("Index Document modifiés :", docIndexChanges);

  console.log("Resynchronisation des index Folder…");
  const folderIndexChanges = await Folder.syncIndexes();
  console.log("Index Folder modifiés :", folderIndexChanges);

  console.log("Migration terminée.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Échec de la migration :", err);
  process.exit(1);
});
