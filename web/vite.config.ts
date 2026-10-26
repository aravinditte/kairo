/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// SPA fallback for dev/preview is handled by Vite history fallback.
// For static hosts, public/_redirects (Netlify/Cloudflare Pages) rewrites
// all paths to /index.html; the nginx image uses try_files in Dockerfile docs.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
      "/v1": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-flow": ["@xyflow/react"],
          "vendor-charts": ["recharts"],
          "vendor-query": ["@tanstack/react-query"],
        },
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts", "tests/**/*.test.ts"] },
});
