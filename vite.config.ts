import { defaultClientConditions, defaultServerConditions } from "vite";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { localSource } from "../app/vite/localSource.ts";
import { babylonShaderChunks } from "@foss-earth/renderer/vite";
import { browserRecovery } from "@foss-earth/ui/vite";
import { studyPlugin } from "./vite/study.ts";

const root = fileURLToPath(new URL(".", import.meta.url));
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

export default defineConfig({
  resolve: {
    alias: [{ find: "@image-tabs", replacement: fileURLToPath(new URL("../app/src/imageTabs", import.meta.url)) }],
    dedupe: ["@babylonjs/core", "react", "react-dom"],
    conditions: ["source", ...defaultClientConditions],
    preserveSymlinks: true,
  },
  ssr: { resolve: { conditions: ["source", ...defaultServerConditions] } },
  server: {
    headers: isolation,
    watch: { ignored: ["**/build/**"] },
  },
  plugins: [
    studyPlugin(),
    browserRecovery({ appId: "experiments" }),
    localSource({ root }),
    react(),
    babylonShaderChunks(),
  ],
});
