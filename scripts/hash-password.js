// Génère le hash bcrypt à placer dans AUTH_PASSWORD_HASH.
// Usage : npm run hash-password -- "mon-mot-de-passe"
import bcrypt from "bcryptjs";

const password = process.argv[2];
if (!password) {
  console.error('Usage : npm run hash-password -- "mon-mot-de-passe"');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 12);
console.log("\nAUTH_PASSWORD_HASH à copier dans vos variables d'environnement :\n");
console.log(hash);
console.log(
  "\nAttention sur Vercel : coller la valeur telle quelle dans le dashboard (les $ ne sont pas interprétés)."
);
