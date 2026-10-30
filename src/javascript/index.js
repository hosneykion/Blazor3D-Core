import Viewer3D from "./Viewer/Viewer3D";

const viewers = new Map();

export function loadViewer(instanceId, json) {
  const options = JSON.parse(json);
  const container = document.getElementById(options.viewerSettings.containerId);
  if (!container) throw new Error("Blazor3D container not found.");

  // A reused DOM id does not imply a reused viewer lifetime.
  for (const [id, entry] of viewers) {
    if (
      id === instanceId ||
      entry.viewer.container === container ||
      entry.viewer.options?.viewerSettings.containerId ===
        options.viewerSettings.containerId
    ) {
      entry.viewer.dispose();
    }
  }

  let resizeObserver;
  let removalObserver;
  let viewer;
  const onDisposed = (instance) => {
    resizeObserver?.disconnect();
    removalObserver?.disconnect();
    if (viewers.get(instanceId)?.viewer === instance)
      viewers.delete(instanceId);
  };
  viewer = new Viewer3D(options, container, onDisposed, instanceId);
  if (viewer.disposed) return;
  resizeObserver = new ResizeObserver(() => viewer.onResize());
  removalObserver = new MutationObserver(() => {
    if (!container.isConnected || !viewer.renderer?.domElement?.isConnected)
      viewer.dispose();
  });
  viewers.set(instanceId, { viewer });
  resizeObserver.observe(container);
  removalObserver.observe(document.body, { childList: true, subtree: true });
}

export function disposeViewer(instanceId) {
  viewers.get(instanceId)?.viewer.dispose();
}

export function pauseViewer(instanceId) {
  getViewer(instanceId)?.pause();
}

export function resumeViewer(instanceId) {
  getViewer(instanceId)?.resume();
}

function getViewer(instanceId) {
  return viewers.get(instanceId)?.viewer;
}

export function updateScene(id, json) {
  const viewer = getViewer(id);
  if (viewer) viewer.updateScene(JSON.parse(json));
}
export function removeByUuid(id, guid) {
  return getViewer(id)?.removeByUuid(guid) ?? false;
}
export function selectByUuid(id, guid) {
  return getViewer(id)?.selectByUuid(guid) ?? false;
}
export function clearScene(id) {
  getViewer(id)?.clearScene();
}
export function import3DModel(id, json) {
  const viewer = getViewer(id);
  if (viewer) viewer.import3DModel(JSON.parse(json));
}
export function importSprite(id, json) {
  const viewer = getViewer(id);
  if (viewer) viewer.importSprite(JSON.parse(json));
}
export function setCameraPosition(id, position, lookAt) {
  getViewer(id)?.setCameraPosition(position, lookAt);
}
export function updateCamera(id, json) {
  const viewer = getViewer(id);
  if (viewer) viewer.updateCamera(JSON.parse(json));
}
export function showCurrentCameraInfo(id) {
  getViewer(id)?.showCurrentCameraInfo();
}
export function updateOrbitControls(id, json) {
  const viewer = getViewer(id);
  if (viewer) viewer.updateOrbitControls(JSON.parse(json));
}
export function getSceneItemByGuid(id, guid) {
  const viewer = getViewer(id);
  return viewer ? JSON.stringify(viewer.getSceneItemByGuid(guid)) : "";
}

// Numbers only: diagnostics must not retain scenes, canvases or GPU resources.
export function getDiagnostics() {
  return {
    activeViewers: viewers.size,
    viewers: Array.from(viewers, ([instanceId, { viewer }]) => ({
      instanceId,
      sceneChildren: viewer.scene?.children.length ?? 0,
      geometries: viewer.renderer?.info.memory.geometries ?? 0,
      textures: viewer.renderer?.info.memory.textures ?? 0,
      pendingText: viewer.textLoads?.pendingCount ?? 0,
    })),
  };
}
