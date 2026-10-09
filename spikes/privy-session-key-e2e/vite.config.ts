import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Loopback only, fixed port, because the Privy dashboard allows exactly http://localhost:5173.
    host: "localhost",
    port: 5173,
    strictPort: true,
    // Same-origin access to the Bun server, so it needs no CORS. changeOrigin rewrites Host only; Origin is kept.
    proxy: { "/api": { target: "http://127.0.0.1:8788", changeOrigin: true } },
  },
});
