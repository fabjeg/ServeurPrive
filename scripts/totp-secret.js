// Génère un secret TOTP (2FA) et l'URL otpauth à scanner dans Google Authenticator,
// 1Password, Aegis, etc. Usage : npm run totp-secret
import { authenticator } from "otplib";

const secret = authenticator.generateSecret(32);
const email = process.env.AUTH_EMAIL || "moi@frigo";
const otpauth = authenticator.keyuri(email, "Frigo", secret);

console.log("\nTOTP_SECRET à copier dans vos variables d'environnement :\n");
console.log(secret);
console.log("\nURL otpauth à importer dans votre application d'authentification :\n");
console.log(otpauth);
console.log("\n(Vous pouvez générer un QR code à partir de cette URL, par exemple sur votre téléphone.)");
