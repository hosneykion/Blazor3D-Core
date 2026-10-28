import Viewer3D from "./Viewer/Viewer3D";

let viewer3d;

const resizeObserver = new ResizeObserver((entries) => {
  // The module supports one active viewer; ignore notifications for any stale
  // container that may have been observed before teardown.
  if (viewer3d && entries.some(entry => entry.target === viewer3d.container)) {
    viewer3d.onResize();
  }
});

// DOM removal is observable even if Blazor's server circuit cannot run JS.
// If your app has a stable, narrower root, observe that instead of body.
const removalObserver = new MutationObserver(() => {
  if (viewer3d && (!viewer3d.container?.isConnected ||
      !viewer3d.renderer?.domElement?.isConnected)) {
    viewer3d.dispose();
  }
});

function onViewerDisposed(instance) {
  if (viewer3d !== instance) return;
  resizeObserver.disconnect();
  removalObserver.disconnect();
  viewer3d = null;
}

export function loadViewer(json) {
  const options = JSON.parse(json);
  const containerId = options.viewerSettings.containerId;
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn("Container not found!");
    return;
  }

  // The upstream module supports one active viewer. Release the previous
  // instance before assigning another, including when container IDs repeat.
  viewer3d?.dispose();

  viewer3d = new Viewer3D(options, container, onViewerDisposed);
  resizeObserver.observe(container);
  removalObserver.observe(document.body, { childList: true, subtree: true });
}

// Called by the Blazor component during disposal. The container ID prevents a
// late disposal call from tearing down a newer viewer instance.
export function disposeViewer(containerId) {
  if (viewer3d?.options?.viewerSettings?.containerId === containerId) {
    viewer3d.dispose();
  }
}

export function updateScene(json) {
  const sceneOptions = JSON.parse(json);
  viewer3d.updateScene(sceneOptions);
}

export function removeByUuid(guid) {
  return viewer3d.removeByUuid(guid);
}

export function selectByUuid(guid) {
  return viewer3d.selectByUuid(guid);
}

export function clearScene() {
  viewer3d.clearScene();
}

export function import3DModel(json) {
  const settings = JSON.parse(json);
  return JSON.stringify(viewer3d.import3DModel(settings));
}

export function importSprite(json) {
  const settings = JSON.parse(json);
  return JSON.stringify(viewer3d.importSprite(settings));
}

export function setCameraPosition(position, lookAt) {
  viewer3d.setCameraPosition(position, lookAt);
}

export function updateCamera(json) {
  const options = JSON.parse(json);
  viewer3d.updateCamera(options);
}

export function showCurrentCameraInfo() {
  viewer3d.showCurrentCameraInfo();
}

export function updateOrbitControls(json){
  const options = JSON.parse(json);
  viewer3d.updateOrbitControls(options);
}

export function getSceneItemByGuid(guid) {
  const item = viewer3d.getSceneItemByGuid(guid);
  return JSON.stringify(item);
}
