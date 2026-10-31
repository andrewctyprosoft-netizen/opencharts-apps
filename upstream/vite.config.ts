import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// OpenCharts Mobile patch: `vite --mode mobile` (npm run dev in ../android) also serves the
// Android bridge (bridge.js, the /__oc/net proxy), so the phone app runs in a browser.
export default defineConfig(async ({ mode }) => ({
  // GitHub Pages serves a project site from /<repo>/, so the demo workflow sets
  // BASE_PATH. Local builds and self-hosting stay at the domain root.
  base: process.env.BASE_PATH ?? "/",
  plugins: [
    react(),
    ...(mode === "mobile" ? [(await import("../android/dev/tools/vite-mobile-dev.mjs")).mobileDev()] : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@propsim/types": path.resolve(__dirname, "./src/vendor/types.ts"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/react-router") ||
              id.includes("/@radix-ui/") ||
              id.includes("/@tanstack/") ||
              id.includes("/zustand/") ||
              id.includes("/scheduler/")
            ) {
              return "vendor-react";
            }
            if (id.includes("/lucide-react/")) {
              return "vendor-icons";
            }
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
}));
