import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  build: {
    // Let Vite/Rollup determine safe chunk boundaries. The previous manual
    // grouping created a circular React/React Query vendor dependency in
    // production, leaving the public storefront with a blank screen.
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    {
      name: "circular-warn",
      onwarn(warning: any, defaultHandler: any) {
        if (warning.code === "CIRCULAR_DEPENDENCY") {
          console.error("[CIRCULAR DEPENDENCY]", warning.ids.join(" -> "))
          return
        }
        defaultHandler(warning)
      },
    },
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
