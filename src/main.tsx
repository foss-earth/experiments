import "@foss-earth/ui/theme.css";
import "@foss-earth/ui/windowing.css";
import "./experiments.css";
import { markBrowserAppReady, reportBrowserAppFailure } from "@foss-earth/ui/browser";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { createExperimentHost } from "./host.ts";

const overlay = document.querySelector<HTMLElement>("#experiment-overlay");
const canvas = document.querySelector<HTMLCanvasElement>("#view");
if (!overlay || !canvas) throw new Error("The experiments page is missing its canvas.");

try {
  const { host } = await createExperimentHost(canvas);
  createRoot(overlay).render(<App host={host} />);
  markBrowserAppReady(document);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(reason);
  reportBrowserAppFailure(document, reason);
  throw error;
}
