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
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('react/jsx-runtime') || id.includes('react-dom')) return 'react-vendor';
            if (id.includes('react') || id.includes('@radix-ui') || id.includes('lucide-react')) return 'react-vendor';
            if (id.includes('@supabase/supabase-js') || id.includes('cross-fetch')) return 'supabase-vendor';
            if (id.includes('tanstack')) return 'query-vendor';
            if (id.includes('html2canvas') || id.includes('jspdf') || id.includes('dompurify')) return 'pdf-vendor';
            if (id.includes('node_modules/')) return 'vendor';
          }
          return undefined;
        },
      },
    },
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
