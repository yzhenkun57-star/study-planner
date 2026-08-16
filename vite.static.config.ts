import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  root: resolve(projectRoot, "static"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: resolve(projectRoot, "gh-pages-dist"),
    emptyOutDir: true,
  },
});
