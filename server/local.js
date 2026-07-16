// Serveur local de développement (alternative à `vercel dev`).
// Attention : les callbacks onUploadCompleted de Vercel Blob ne peuvent pas
// atteindre localhost — la confirmation explicite du client prend le relais.
import { app } from "./app.js";

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Frigo API locale : http://localhost:${port}/api/health`);
});
