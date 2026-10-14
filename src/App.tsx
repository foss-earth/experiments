import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { WindowOverlay, type WindowOverlayHandle } from "@foss-earth/ui/react";
import { browserOverlayGeometry, browserOverlayLayout } from "@foss-earth/ui/browser";
import type { WindowSlotId } from "@foss-earth/ui/windowing";
import { IMAGE_SURFACE_KEYS, type ImageSurfaceHost } from "@image-tabs/imageSurfaceHost";
import { imageTabDefinitions, isImageInstanceTab, OPEN_IMAGE_TAB } from "@image-tabs/imageDocuments";
import { useImageDocuments, useImageView } from "@image-tabs/useImageTabs";
import { ExperimentTab } from "./ExperimentTab.tsx";
import { useRun } from "./useRun.ts";
import { frameOfTab, frameUrl, type CaseName, type FrameId, type FrameTabId, type Profile } from "./frames.ts";
import { openImageOnSide } from "./openImage.ts";

type TabId = "experiment" | FrameTabId | `image:${string}`;

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function focusedSlot(snapshot: { focusedSide: string | null } | null): WindowSlotId {
  return snapshot?.focusedSide === "secondary" ? "secondary" : "primary";
}

export function App({ host }: { host: ImageSurfaceHost }) {
  const documents = useImageDocuments(host);
  const view = useImageView(host);
  const [profile, setProfile] = useState<Profile>("720p");
  const [caseName, setCaseName] = useState<CaseName>("natural");
  const [openError, setOpenError] = useState<string | null>(null);
  const run = useRun();
  const overlayApi = useRef<WindowOverlayHandle<TabId> | null>(null);
  const storage = useState(memoryStorage)[0];
  const [bound, setBound] = useState(false);
  const picture = useRef({ profile, caseName, job: run.job });
  const opening = useRef(new Set<string>());
  const openPictureRef = useRef<(frame: FrameId, slot: WindowSlotId) => Promise<void>>(async () => {});
  useEffect(() => {
    picture.current = { profile, caseName, job: run.job };
    openPictureRef.current = openPicture;
  });

  const tabs = useMemo(() => {
    const images = imageTabDefinitions(documents).flatMap(tab => (
      tab.id === OPEN_IMAGE_TAB || !isImageInstanceTab(tab.id) ? [] : [{ id: tab.id, label: tab.label }]
    ));
    return [
      { id: "experiment" as const, label: "Experiment" },
      { id: "frame:original" as const, label: "Original" },
      { id: "frame:half" as const, label: "Half-resolution" },
      { id: "frame:output" as const, label: "WebGPU output", available: run.job !== null },
      ...images,
    ];
  }, [documents, run.job]);

  useLayoutEffect(() => {
    const world = document.querySelector<HTMLElement>("#experiment-world");
    if (!world) return;
    world.tabIndex = 0;
    world.dataset.takesKeys = IMAGE_SURFACE_KEYS;
    return host.attachSurface(world);
  }, [host]);

  useLayoutEffect(() => {
    const handle = overlayApi.current;
    if (!handle) return;
    const off = host.bindWorkspace({
      workspace: handle.workspace,
      openTabInSlot: (tabId, slotId) => overlayApi.current?.openTabInSlot(tabId as TabId, slotId),
    });
    handle.openTabInSlot("experiment", "primary");
    setBound(true);
    return () => { setBound(false); off(); };
  }, [host]);

  async function openPicture(frame: FrameId, slot: WindowSlotId): Promise<void> {
    const url = frameUrl(frame, picture.current.profile, picture.current.caseName, picture.current.job);
    if (!url) {
      setOpenError("WebGPU output can be opened after a run.");
      return;
    }
    const tabId = await openImageOnSide(host, url, slot);
    if (!tabId) setOpenError(host.getView().opening.error ?? "That picture could not be opened.");
    else setOpenError(null);
  }

  useEffect(() => {
    if (!bound) return;
    const handle = overlayApi.current;
    if (!handle) return;
    const convert = (): void => {
      const snapshot = handle.workspace.getSnapshot();
      for (const slot of ["primary", "secondary"] as const) {
        for (const tabId of snapshot[slot].tabs) {
          const frame = frameOfTab(tabId);
          if (!frame) continue;
          const key = `${tabId}:${slot}`;
          if (opening.current.has(key)) continue;
          opening.current.add(key);
          void openPictureRef.current(frame, slot).finally(() => {
            overlayApi.current?.closeTab(tabId);
            opening.current.delete(key);
          });
        }
      }
    };
    convert();
    return handle.workspace.subscribe(convert);
  }, [bound, host]);

  const [left, right] = view.sides.length === 2 ? view.sides : [null, null];
  const single = view.sides.length === 1 ? view.sides[0] : null;
  const status = openError ?? view.incompatibleReason ?? view.sides.find(side => side.error)?.error ?? run.status;

  return <>
    <div className="experiment-hud" aria-hidden={view.presentation === "none"}>
      {left && right ? <>
        <div className="experiment-hud__wipe" style={{ left: `${view.wipe * 100}%` }}>
          <div className="experiment-hud__handle" role="slider" tabIndex={0}
            aria-label={`Wipe between ${left.title} and ${right.title}`}
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(view.wipe * 100)}
            onPointerDown={event => {
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={event => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const bounds = event.currentTarget.parentElement?.parentElement?.getBoundingClientRect();
              if (!bounds || bounds.width <= 0) return;
              host.setWipe((event.clientX - bounds.left) / bounds.width);
            }} />
        </div>
        <p className="experiment-hud__label experiment-hud__label--left">{left.title}</p>
        <p className="experiment-hud__label experiment-hud__label--right">{right.title}</p>
      </> : null}
      {single ? <p className="experiment-hud__label experiment-hud__label--left">{single.title}</p> : null}
    </div>
    <WindowOverlay<TabId>
      tabDefinitions={tabs}
      renderTabContent={tabId => {
        if (tabId === "experiment") {
          return <ExperimentTab
            profile={profile} caseName={caseName} outputReady={run.job !== null} status={status} busy={run.busy}
            onProfile={setProfile} onCase={setCaseName}
            onRun={() => run.run(profile, caseName)}
            onOpen={frame => void openPicture(frame, focusedSlot(overlayApi.current?.workspace.getSnapshot() ?? null))}
          />;
        }
        if (isImageInstanceTab(tabId)) {
          const document = host.registry.documentOf(tabId);
          const title = document?.title ?? "Image";
          const size = document ? `${document.width} × ${document.height}` : "";
          return <p className="experiment-note">{title}{size ? ` · ${size}` : ""}. This picture is on the view behind the windows.</p>;
        }
        return <p className="experiment-note">Opening this picture on the view.</p>;
      }}
      context={{ active: false, ready: true, baseOnlyTabs: new Set(), contextOnlyTabs: new Set(), entryTabId: "experiment" }}
      restorableTabs={new Set(["experiment"])}
      storage={storage}
      geometry={browserOverlayGeometry(window, () => null)}
      logSize={{ getWidth: () => null, subscribe: () => () => {} }}
      layoutPort={browserOverlayLayout(document.documentElement)}
      overlayApiRef={overlayApi}
    />
  </>;
}
