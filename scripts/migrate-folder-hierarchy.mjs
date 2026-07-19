// Migration ponctuelle : introduit la hiérarchie marque -> modèle.
// - Crée (ou récupère) le dossier de premier niveau "carrier".
// - "thermo king" reste un dossier de premier niveau tel quel (aucun
//   changement : ses documents restent rattachés directement à la marque).
// - Fusionne "carrier xarios 200" et "carrier xiaros 200" (coquille du même
//   modèle) en UN SEUL dossier enfant "xarios 200" sous "carrier" : on
//   garde "carrier xarios 200" (renommé "xarios 200", reparenté sous
//   "carrier"), on réattribue les documents de "carrier xiaros 200" dessus,
//   puis on supprime "carrier xiaros 200" devenu vide.
// - Resynchronise les index Folder (ancien index unique {ownerId,space,name}
//   -> nouveau {ownerId,space,parentId,name}).
//
// Usage : node --env-file=.env scripts/migrate-folder-hierarchy.mjs
//
// Idempotent : peut être relancé sans erreur ni doublon (chaque étape
// vérifie l'état déjà migré avant d'agir).
//
// Touche la base Atlas partagée dev/prod (même MONGODB_URI) — exécuter une
// seule fois, en connaissance de cause.
import mongoose from "mongoose";
import { env } from "../server/lib/env.js";
import { Document } from "../server/models/Document.js";
import { Folder } from "../server/models/Folder.js";

const OWNER_ID = "owner";
const SPACE = "pro";

async function main() {
  // autoIndex: false — on gère la resynchronisation d'index nous-mêmes, à
  // la fin, une fois les documents en place (l'ancien index unique
  // {ownerId,space,name} doit disparaître avant que le nouveau
  // {ownerId,space,parentId,name} ne soit créé).
  await mongoose.connect(env.mongodbUri, { autoIndex: false });
  console.log("Connecté à MongoDB.");

  // 1. Dossier "carrier" (marque, premier niveau) — créé s'il n'existe pas.
  let carrier = await Folder.findOne({ ownerId: OWNER_ID, space: SPACE, parentId: null, name: "carrier" });
  if (!carrier) {
    carrier = await Folder.create({ ownerId: OWNER_ID, space: SPACE, parentId: null, name: "carrier", description: "" });
    console.log("Dossier « carrier » créé :", carrier._id.toString());
  } else {
    console.log("Dossier « carrier » déjà présent :", carrier._id.toString());
  }

  // 2. "thermo king" reste tel quel — aucune action requise, juste un log
  //    pour visibilité/vérification manuelle.
  const thermoKing = await Folder.findOne({ ownerId: OWNER_ID, space: SPACE, name: "thermo king" });
  if (thermoKing) {
    console.log(
      `« thermo king » inchangé (parentId=${thermoKing.parentId ? thermoKing.parentId.toString() : "null"}) — ` +
        "ses documents restent rattachés directement à la marque."
    );
  } else {
    console.log("« thermo king » introuvable — rien à faire pour cette marque (déjà migré ou absent).");
  }

  // 3. Fusion "carrier xarios 200" + "carrier xiaros 200" -> "xarios 200"
  //    (enfant de carrier).
  const keep = await Folder.findOne({ ownerId: OWNER_ID, space: SPACE, name: "carrier xarios 200" });
  const dupe = await Folder.findOne({ ownerId: OWNER_ID, space: SPACE, name: "carrier xiaros 200" });

  // Idempotence : si "keep" a déjà été renommé/reparenté (relance du script
  // après un premier passage réussi), on le retrouve directement sous son
  // nouveau nom/parent et on saute l'étape.
  const alreadyMigrated = await Folder.findOne({
    ownerId: OWNER_ID,
    space: SPACE,
    parentId: carrier._id,
    name: "xarios 200",
  });

  let xarios200 = alreadyMigrated;

  if (!xarios200 && keep) {
    if (dupe) {
      const reassigned = await Document.updateMany(
        { ownerId: OWNER_ID, space: SPACE, folderId: dupe._id },
        { $set: { folderId: keep._id } }
      );
      console.log(`Documents réassignés de « carrier xiaros 200 » vers « carrier xarios 200 » : ${reassigned.modifiedCount}`);
    }
    keep.name = "xarios 200";
    keep.parentId = carrier._id;
    await keep.save();
    xarios200 = keep;
    console.log("« carrier xarios 200 » renommé « xarios 200 » et reparenté sous « carrier ».");

    if (dupe) {
      await Folder.deleteOne({ _id: dupe._id });
      console.log("Dossier dupliqué « carrier xiaros 200 » supprimé.");
    }
  } else if (xarios200) {
    console.log("« xarios 200 » déjà migré (parentId = carrier) — rien à faire.");
    // Idempotence supplémentaire : si un "carrier xiaros 200" traîne encore
    // (relance partielle interrompue avant la suppression), on finit le
    // travail sans dupliquer de réassignation.
    const leftoverDupe = await Folder.findOne({ ownerId: OWNER_ID, space: SPACE, name: "carrier xiaros 200" });
    if (leftoverDupe) {
      const reassigned = await Document.updateMany(
        { ownerId: OWNER_ID, space: SPACE, folderId: leftoverDupe._id },
        { $set: { folderId: xarios200._id } }
      );
      console.log(`(rattrapage) documents réassignés depuis le doublon résiduel : ${reassigned.modifiedCount}`);
      await Folder.deleteOne({ _id: leftoverDupe._id });
      console.log("(rattrapage) doublon résiduel supprimé.");
    }
  } else {
    console.log("Ni « carrier xarios 200 » ni « xarios 200 » (déjà migré) trouvés — rien à faire pour ce modèle.");
  }

  // 4. Resynchronisation des index Folder (ancien index unique
  //    {ownerId,space,name} -> nouveau {ownerId,space,parentId,name}).
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
