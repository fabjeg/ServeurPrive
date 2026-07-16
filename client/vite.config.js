import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En dev, l'API tourne via `vercel dev` (ou `node server/local.js`) sur :3000.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
