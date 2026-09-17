import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import read from "./api/read.js";
import tariff from "./api/tariff.js";

export default defineConfig(({ mode }) => {
  // ponytail: run the same API handlers locally; no second backend or SDK.
  const root = fileURLToPath(new URL(".", import.meta.url));
  const env = loadEnv(mode, root, "");
  process.env.GEMINI_API_KEY ||= env.GEMINI_API_KEY;
  process.env.GEMINI_MODEL ||= env.GEMINI_MODEL;
  const localApi = (server) => {
    server.middlewares.use("/api/read", read);
    server.middlewares.use("/api/tariff", tariff);
  };
  return {
    plugins: [react(), { name: "local-api", configureServer: localApi, configurePreviewServer: localApi }],
    root,
    server: { port: 5188, strictPort: true },
    preview: { port: 4188, strictPort: true },
  };
});
