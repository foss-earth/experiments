/**
 * Serves the upscale study from the research checkout on this dev server:
 * the harness, ORT, models, stored frames, and the published GPU picture.
 * Measurement runs still use their own CDP server and do not listen here.
 */
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Plugin } from "vite";

const benchmarkRoot = fileURLToPath(new URL("../../research/scripts/benchmarks/ai-framegen-upscale/", import.meta.url));
const workRoot = fileURLToPath(new URL("../../research/build/benchmarks/ai-framegen-upscale/work/", import.meta.url));

interface StudyRoute {
  prefix: string;
  directory?: string;
  nested?: boolean;
  extensions: string[];
  files?: string[];
  mapped?: Record<string, string>;
}

interface ResolvedRoute {
  status: number;
  file?: string;
  contentType?: string;
  reason?: string;
}

interface StudyModules {
  ORIGIN: string;
  ISOLATION_HEADERS: { name: string; value: string }[];
  harnessRoutes(options: { models: string; references: string; ortDist: string; harness: string }): StudyRoute[];
  resolveRoute(routes: StudyRoute[], url: string): ResolvedRoute;
  encodeRgbPng(rgba: Uint8Array, width: number, height: number): Buffer;
}

const headers = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Cache-Control": "no-store",
};
const MAX_FRAME_BYTES = 32 * 1024 * 1024;
const profiles = new Set(["720p", "1080p", "small"]);
const cases = new Set(["natural", "synthetic"]);
const sourcePath = /^\/demo\/source\/(Original|Half-resolution)$/;

function studyPrefixes(pathname: string): boolean {
  return pathname.startsWith("/harness/") || pathname.startsWith("/ort/") || pathname.startsWith("/models/")
    || pathname.startsWith("/references/") || pathname.startsWith("/demo/");
}

function frameName(pathname: string): string | null {
  if (!pathname.startsWith("/demo/")) return null;
  let leaf = pathname.slice("/demo/".length);
  if (!leaf || leaf.includes("/") || leaf.startsWith("source")) return null;
  try { leaf = decodeURIComponent(leaf); } catch { return null; }
  if (!/^[\w][\w .'-]*$/.test(leaf) || leaf.length > 80) return null;
  return leaf;
}

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_FRAME_BYTES) {
        reject(new Error("frame is larger than 32 MiB"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function sourcePng(study: StudyModules, name: string, profile: string | null, caseName: string | null, cache: Map<string, Buffer>): Promise<Buffer> {
  if (!profile || !caseName || !profiles.has(profile) || !cases.has(caseName)) throw new Error("profile or case is not one this preview serves");
  const key = `${name}\0${profile}\0${caseName}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const root = path.resolve(workRoot, "references");
  const dir = path.resolve(root, "rt4ksr-x2", profile, caseName);
  if (dir !== root && !dir.startsWith(`${root}${path.sep}`)) throw new Error("case is outside the references");
  const meta = JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8")) as {
    inputs?: { file?: string; width?: number; height?: number }[];
    output?: { expected8?: string; valid?: { width?: number; height?: number } };
  };
  const input = meta.inputs?.[0];
  const output = meta.output;
  const chosen = name === "Original"
    ? { file: output?.expected8, width: output?.valid?.width, height: output?.valid?.height }
    : { file: input?.file, width: input?.width, height: input?.height };
  if (typeof chosen.file !== "string" || !/^[\w.-]+$/.test(chosen.file)) throw new Error("reference file is not named");
  const file = path.resolve(dir, chosen.file);
  if (!file.startsWith(`${dir}${path.sep}`)) throw new Error("reference file is outside the case");
  const rgba = await readFile(file);
  const width = chosen.width;
  const height = chosen.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width === undefined || height === undefined || rgba.length !== width * height * 4) {
    throw new Error("reference size does not match its pixels");
  }
  const png = study.encodeRgbPng(rgba, width, height);
  cache.set(key, png);
  return png;
}

function send(response: ServerResponse, status: number, body: string | Buffer, type: string): void {
  const bytes = typeof body === "string" ? Buffer.from(body) : body;
  response.writeHead(status, { ...headers, "Content-Type": type, "Content-Length": bytes.length });
  response.end(bytes);
}

export function studyPlugin(): Plugin {
  return {
    name: "experiments-study",
    configureServer(server) {
      const frames = new Map<string, Buffer>();
      const sources = new Map<string, Buffer>();
      let loading: Promise<{ study: StudyModules; routes: StudyRoute[] }> | null = null;
      const ready = (): Promise<{ study: StudyModules; routes: StudyRoute[] }> => {
        loading ??= (async () => {
          const serve = await import(pathToFileURL(path.join(benchmarkRoot, "lib/serve.mjs")).href) as Omit<StudyModules, "encodeRgbPng">;
          const png = await import(pathToFileURL(path.join(benchmarkRoot, "lib/rgbPng.mjs")).href) as Pick<StudyModules, "encodeRgbPng">;
          const pins = JSON.parse(await readFile(path.join(benchmarkRoot, "browser-dependencies.json"), "utf8")) as { package: { name: string; version: string } };
          const ortDist = path.join(workRoot, "ort-web", `${pins.package.name}-${pins.package.version}`, "package", "dist");
          const study = { ...serve, encodeRgbPng: png.encodeRgbPng };
          const routes = [
            { prefix: "/harness/", directory: path.join(benchmarkRoot, "harness"), nested: true, extensions: [".mjs"] },
            ...study.harnessRoutes({
              models: path.join(workRoot, "models"),
              references: path.join(workRoot, "references"),
              ortDist,
              harness: path.join(benchmarkRoot, "harness"),
            }).filter(route => route.prefix !== "/"),
          ];
          return { study, routes };
        })();
        return loading;
      };
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (!studyPrefixes(url.pathname)) { next(); return; }
        void ready().then(loaded => dispatch(loaded.study, loaded.routes, frames, sources, request, response, url)).catch(error => {
          if (response.headersSent) return;
          send(response, 500, error instanceof Error ? error.message : String(error), "text/plain; charset=utf-8");
        });
      });
    },
  };
}

async function dispatch(
  study: StudyModules,
  routes: StudyRoute[],
  frames: Map<string, Buffer>,
  sources: Map<string, Buffer>,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const { pathname } = url;
  const source = sourcePath.exec(pathname);
  if (source && request.method === "GET") {
    try {
      const png = await sourcePng(study, source[1] ?? "", url.searchParams.get("profile"), url.searchParams.get("case"), sources);
      send(response, 200, png, "image/png");
    } catch (error) {
      send(response, 404, error instanceof Error ? error.message : String(error), "text/plain; charset=utf-8");
    }
    return;
  }
  const name = frameName(pathname);
  const run = url.searchParams.get("run");
  const storedAs = name && run && /^[A-Za-z0-9-]+$/.test(run) ? `${name}\0${run}` : name;
  if (name && storedAs && request.method === "POST") {
    const width = Number(url.searchParams.get("width"));
    const height = Number(url.searchParams.get("height"));
    const rgba = await readBody(request);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || rgba.length !== width * height * 4) {
      send(response, 400, "width, height and tightly packed RGBA do not agree", "text/plain; charset=utf-8");
      return;
    }
    frames.set(storedAs, study.encodeRgbPng(rgba, width, height));
    response.writeHead(204, headers);
    response.end();
    return;
  }
  if (name && storedAs && request.method === "GET") {
    const png = frames.get(storedAs);
    if (!png) {
      send(response, 404, "that frame has not been published", "text/plain; charset=utf-8");
      return;
    }
    send(response, 200, png, "image/png");
    return;
  }
  if (pathname.startsWith("/demo/")) {
    send(response, 404, "not found", "text/plain; charset=utf-8");
    return;
  }
  const resolved = study.resolveRoute(routes, `${study.ORIGIN}${pathname}`);
  if (resolved.status !== 200 || !resolved.file || !resolved.contentType) {
    send(response, 404, resolved.reason || "not found", "text/plain; charset=utf-8");
    return;
  }
  const body = await readFile(resolved.file);
  send(response, 200, body, resolved.contentType);
}
