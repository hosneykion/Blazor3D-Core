import TextLoadScope from "../Utils/TextLoadScope";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import Loaders from "./Loaders";
import Exporters from "./Exporters"; //todo
import TextBuilder from "../Builders/TextBuilder";
import SceneBuilder from "../Builders/SceneBuilder";
import CameraBuilder from "../Builders/CameraBuilder";
import Transforms from "../Utils/Transforms";
import { ViewHelper } from "three/examples/jsm/helpers/ViewHelper";
import disposeOwnedResources, {
  disposeResourcesNotIn,
  disposeTextures,
} from "../Utils/DisposeOwnedResources";

class Viewer3D {
  thetaX = 0;
  thetaY = 0;
  thetaZ = 0;
  mouse = new THREE.Vector2();
  raycaster = new THREE.Raycaster();

  INTERSECTED = null;
  clock = null;

  constructor(options, container, onDisposed = null, instanceId = null) {
    this.disposed = false;
    this.paused = false;
    this.instanceId = instanceId ?? options.viewerSettings.containerId;
    this.textLoads = new TextLoadScope();
    this.animationFrameId = null;
    this.sceneGeneration = 0;
    this.onDisposed = onDisposed;
    this.options = options;
    this.container = container;
    this.clock = new THREE.Clock();

    this.scene = new THREE.Scene();
    this.setScene();

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.options.viewerSettings.webGLRendererSettings.antialias,
      premultipliedAlpha:
        this.options.viewerSettings.webGLRendererSettings.premultipliedAlpha,
      alpha: this.options.viewerSettings.webGLRendererSettings.alpha,
    });

    if (this.options.viewerSettings.showViewHelper) {
      this.renderer.autoClear = false;
    }

    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";

    this.renderer.domElement.onclick = (event) => {
      if (this.disposed) return;
      if (this.options.viewerSettings.canSelect == true) {
        this.selectObject(event);
      }
      if (
        this.options.camera.animateRotationSettings
          .stopAnimationOnOrbitControlMove == true
      ) {
        this.options.camera.animateRotationSettings.animateRotation = false;
      }
    };

    this.container.appendChild(this.renderer.domElement);

    this.setCamera();
    this.setOrbitControls();
    this.onResize();

    this.animateFrame = this.animateFrame.bind(this);
    this.animateFrame();
  }

  animateFrame() {
    this.animationFrameId = null;
    if (this.disposed || this.paused) return;
    if (
      !this.container?.isConnected ||
      !this.renderer?.domElement?.isConnected
    ) {
      this.dispose();
      return;
    }

    try {
      this.controls?.update();
      this.render();
    } catch (error) {
      console.error(
        "Blazor3D render loop failed; disposing the viewer.",
        error,
      );
      this.dispose();
      return;
    }

    if (!this.disposed && !this.paused) {
      this.animationFrameId = requestAnimationFrame(this.animateFrame);
    }
  }

  pause() {
    if (this.disposed || this.paused) return;
    this.paused = true;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.clock?.stop();
  }

  resume() {
    if (this.disposed || !this.paused) return;
    this.paused = false;
    this.clock?.start();
    this.onResize();
    this.animateFrame();
  }

  render() {
    if (this.disposed) return;
    this.rotateCamera();
    this.animateObjects();

    if (this.options.viewerSettings.showViewHelper && this.viewHelper) {
      this.renderer.clear();
    }

    this.renderer.render(this.scene, this.camera);

    if (this.options.viewerSettings.showViewHelper && this.viewHelper) {
      this.viewHelper.render(this.renderer);
    }
  }

  onResize() {
    if (this.disposed || !this.container || !this.renderer || !this.camera) {
      return;
    }

    const width = this.container.offsetWidth;
    const height = this.container.offsetHeight;

    // The viewer may be hidden
    if (width <= 0 || height <= 0) {
      return;
    }

    const aspect = width / height;

    if (!Number.isFinite(aspect) || aspect <= 0) {
      return;
    }

    this.camera.aspect = aspect;

    if (this.camera.isOrthographicCamera && this.options?.camera) {
      this.camera.left = this.options.camera.left * aspect;
      this.camera.right = this.options.camera.right * aspect;
    }

    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  setScene() {
    if (this.options.scene.backGroundColor) {
      this.scene.background = new THREE.Color(
        this.options.scene.backGroundColor,
      );
    }

    this.scene.uuid = this.options.scene.uuid;
    const pendingHelpers = [];

    this.options.scene.children.forEach((childOptions) => {
      if (childOptions.type == "Text") {
        TextBuilder.BuildText(childOptions, this.scene, this.textLoads);
      } else {
        var child = SceneBuilder.BuildChild(
          childOptions,
          this.scene,
          this.textLoads,
          this.scene,
          pendingHelpers,
        );
        if (child) {
          this.scene.add(child);
        }
      }
    });

    SceneBuilder.BuildPendingHelpers(pendingHelpers);
  }

  updateScene(sceneOptions) {
    if (this.disposed) return;
    this.clearScene();
    this.options.scene = sceneOptions;
    this.setScene();
  }

  disposeViewHelper() {
    const viewHelper = this.viewHelper;
    this.viewHelper = null;
    if (viewHelper) disposeOwnedResources(viewHelper);
  }

  setCamera() {
    this.disposeViewHelper();

    const width = this.container?.offsetWidth ?? 0;
    const height = this.container?.offsetHeight ?? 0;
    const aspect = width > 0 && height > 0 ? width / height : 1;

    this.camera = CameraBuilder.BuildCamera(this.options.camera, aspect);

    if (
      this.options.viewerSettings.showViewHelper &&
      this.camera &&
      this.renderer &&
      this.renderer.domElement
    ) {
      this.viewHelper = new ViewHelper(this.camera, this.renderer.domElement);
    }

    // todo: add camera children (i.e. lights)
  }

  updateCamera(newCamera) {
    this.options.camera = newCamera;
    this.setCamera();
    this.setOrbitControls();
  }

  rotateCamera() {
    let cameraAnimationSettings = this.options.camera.animateRotationSettings;

    if (
      !cameraAnimationSettings ||
      cameraAnimationSettings.animateRotation === false
    ) {
      return;
    }

    let radius = cameraAnimationSettings.radius;

    this.thetaX = this.thetaX + cameraAnimationSettings.thetaX;
    this.thetaY = this.thetaY + cameraAnimationSettings.thetaY;
    this.thetaZ = this.thetaZ + cameraAnimationSettings.thetaZ;

    this.camera.position.x =
      cameraAnimationSettings.thetaX === 0
        ? this.camera.position.x
        : radius * Math.sin(THREE.MathUtils.degToRad(this.thetaX));
    this.camera.position.y =
      cameraAnimationSettings.thetaY === 0
        ? this.camera.position.y
        : radius * Math.sin(THREE.MathUtils.degToRad(this.thetaY));
    this.camera.position.z =
      cameraAnimationSettings.thetaZ === 0
        ? this.camera.position.z
        : radius * Math.cos(THREE.MathUtils.degToRad(this.thetaZ));
    let { x, y, z } = this.options.camera.lookAt;
    this.camera.lookAt(x, y, z);
    this.camera.updateMatrixWorld();
  }

  animateObjects() {
    const objectsToAnimate = this.options.scene.children.filter(
      (x) => x.animateObject3DSettings?.animateObject === true,
    );
    objectsToAnimate.forEach((object3dOptions) => {
      const object3d = this.scene.getObjectByProperty(
        "uuid",
        object3dOptions.uuid,
      );
      const animationSettings = object3dOptions.animateObject3DSettings;
      if (
        !object3d?.position ||
        !Array.isArray(animationSettings.points) ||
        animationSettings.points.length === 0
      ) {
        animationSettings.animateObject = false;
        return;
      }

      if (animationSettings.points.length === animationSettings.indexPointer) {
        if (animationSettings.loopAnimation === false) {
          animationSettings.animateObject = false;
          return;
        }
        animationSettings.indexPointer = 0;
        object3d.position.copy(
          new THREE.Vector3(
            animationSettings.points[0].x,
            animationSettings.points[0].y,
            animationSettings.points[0].z,
          ),
        );
      }

      const { x, y, z } =
        animationSettings.points[animationSettings.indexPointer];

      const target = new THREE.Vector3(x, y, z).sub(object3d.position);
      target.normalize();

      object3d.translateOnAxis(
        target,
        this.clock.getDelta() * animationSettings.speed,
      );

      const distance = new THREE.Vector3(x, y, z)
        .sub(object3d.position)
        .length();
      if (distance < 0.1) {
        animationSettings.indexPointer++;
      }
    });
  }

  showCurrentCameraInfo() {
    console.log("Current camera info:", this.camera);
    console.log("Orbit controls info:", this.controls);
  }

  setOrbitControls() {
    this.controls?.dispose();
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.screenSpacePanning = true;
    this.controls.minDistance = this.options.orbitControls.minDistance;
    this.controls.maxDistance = this.options.orbitControls.maxDistance;
    this.controls.enablePan = this.options.orbitControls.enablePan;
    this.controls.enableDamping = this.options.orbitControls.enableDamping;
    this.controls.dampingFactor = this.options.orbitControls.dampingFactor;
    let { x, y, z } = this.options.camera.lookAt;
    this.controls.target.set(x, y, z);
    this.controls.update();
  }

  updateOrbitControls(newOrbitControls) {
    this.options.orbitControls = newOrbitControls;
    this.setOrbitControls();
  }

  import3DModel(settings) {
    if (this.disposed || !this.scene) return null;

    const scene = this.scene;
    const generation = this.sceneGeneration;
    const isActive = () =>
      !this.disposed &&
      this.scene === scene &&
      this.sceneGeneration === generation;

    return Loaders.import3DModel(scene, settings, this.instanceId, isActive);
  }

  importSprite(settings) {
    if (this.disposed || !this.scene) return null;

    const scene = this.scene;
    const generation = this.sceneGeneration;
    const isActive = () =>
      !this.disposed &&
      this.scene === scene &&
      this.sceneGeneration === generation;

    return Loaders.importSprite(scene, settings, this.instanceId, isActive);
  }

  getSceneItemByGuid(guid) {
    let item = this.scene.getObjectByProperty("uuid", guid);
    if (!item) return null;

    return {
      uuid: item.uuid,
      type: item.type,
      name: item.name,
      children: item.type == "Group" ? this.iterateGroup(item.children) : [],
    };
  }

  iterateGroup(children) {
    let result = [];
    for (let i = 0; i < children.length; i++) {
      result.push({
        uuid: children[i].uuid,
        type: children[i].type,
        name: children[i].name,
        children:
          children[i].type == "Group"
            ? this.iterateGroup(children[i].children)
            : [],
      });
    }
    return result;
  }

  selectObject(event) {
    let canvas = this.renderer.domElement;

    this.mouse.x = (event.offsetX / canvas.clientWidth) * 2 - 1;
    this.mouse.y = -(event.offsetY / canvas.clientHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(
      this.scene.children,
      true,
    );

    if (intersects.length == 0) {
      if (this.INTERSECTED) {
        this.INTERSECTED.material.color.setHex(this.INTERSECTED.currentHex);
      }

      this.INTERSECTED = null;
      DotNet.invokeMethodAsync(
        "Blazor3D",
        "ReceiveSelectedObjectUUID",
        this.instanceId,
        null,
      ).catch((error) => {
        if (!this.disposed) {
          console.error(
            "Blazor3D failed to report the cleared selection.",
            error,
          );
        }
      });
      return;
    }

    if (this.options.viewerSettings.canSelectHelpers) {
      this.processSelection(intersects[0].object);
    } else {
      let nonHelper = this.getFirstNonHelper(intersects);
      if (nonHelper) {
        this.processSelection(nonHelper);
      }
    }

    if (this.INTERSECTED) {
      DotNet.invokeMethodAsync(
        "Blazor3D",
        "ReceiveSelectedObjectUUID",
        this.instanceId,
        this.INTERSECTED.uuid,
      ).catch((error) => {
        if (!this.disposed) {
          console.error(
            "Blazor3D failed to report the selected object.",
            error,
          );
        }
      });
    }
  }

  setCameraPosition(position, lookAt) {
    Transforms.setPosition(this.camera, position);
    if (lookAt != null && this.controls && this.controls.target) {
      let { x, y, z } = lookAt;
      this.camera.lookAt(x, y, z);
      this.controls.target.set(x, y, z);
    }
  }

  getFirstNonHelper(intersects) {
    for (let i = 0; i < intersects.length; i++) {
      if (!intersects[i].object.type.includes("Helper")) {
        return intersects[i].object;
      }
    }
    return null;
  }

  removeByUuid(uuid) {
    if (this.disposed || !this.scene) return false;

    const obj = this.scene.getObjectByProperty("uuid", uuid);
    if (!obj || !obj.parent) return false;

    // Remove from the actual parent, including when the UUID belongs to a child.
    obj.parent.remove(obj);

    // Preserve resources shared with objects that remain in the scene, and
    // textures still referenced by the scene background or environment.
    const keepResources = new Set(
      [this.scene.background, this.scene.environment].filter(
        (value) => value?.isTexture,
      ),
    );
    disposeResourcesNotIn(obj, this.scene, keepResources);
    this.removeSceneOptionsByUuid(this.options?.scene?.children, uuid);

    if (
      this.INTERSECTED &&
      (this.INTERSECTED === obj ||
        obj.getObjectById(this.INTERSECTED.id) === this.INTERSECTED)
    ) {
      this.INTERSECTED = null;
    }

    this.renderer?.renderLists?.dispose();
    return true;
  }

  removeSceneOptionsByUuid(children, uuid) {
    if (!Array.isArray(children)) return false;
    let removed = false;
    for (let index = children.length - 1; index >= 0; index--) {
      const child = children[index];
      if (child?.uuid === uuid) {
        children.splice(index, 1);
        removed = true;
      } else if (Array.isArray(child?.children)) {
        removed =
          this.removeSceneOptionsByUuid(child.children, uuid) || removed;
      }
    }
    return removed;
  }

  selectByUuid(uuid) {
    let obj = this.scene.getObjectByProperty("uuid", uuid);
    if (obj) {
      this.processSelection(obj);
      return true;
    }
    return false;
  }

  clearScene() {
    if (!this.scene) return;
    this.sceneGeneration++;
    this.textLoads?.clear();

    // These properties survive scene.clear(), so leave their textures alive
    // until the viewer itself is disposed.
    const keepTextures = new Set(
      [this.scene.background, this.scene.environment].filter(
        (value) => value?.isTexture,
      ),
    );
    this.INTERSECTED = null;
    disposeOwnedResources(this.scene, keepTextures);
    this.scene.clear();
    if (this.options?.scene) this.options.scene.children = [];
    this.renderer?.renderLists?.dispose();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    const notifyDisposed = this.onDisposed;
    this.onDisposed = null;
    const canvas = this.renderer?.domElement;
    const cleanup = (label, action) => {
      try {
        action();
      } catch (error) {
        // Continue releasing other resources if one cleanup operation fails.
        console.warn(`Failed to clean up viewer ${label}.`, error);
      }
    };

    try {
      cleanup("orbit controls", () => this.controls?.dispose());
      cleanup("view helper resources", () => this.disposeViewHelper());
      cleanup("scene resources", () => this.clearScene());

      const sceneTextures = new Set(
        [this.scene?.background, this.scene?.environment].filter(
          (value) => value?.isTexture,
        ),
      );
      cleanup("scene textures", () => disposeTextures(sceneTextures));

      cleanup("canvas event handler", () => {
        if (canvas) canvas.onclick = null;
      });
      cleanup("renderer", () => this.renderer?.dispose());
      // This renderer is permanently retired, not temporarily hidden.
      cleanup("WebGL context", () => this.renderer?.forceContextLoss());
      cleanup("canvas backing store", () => {
        if (canvas) {
          canvas.width = 1;
          canvas.height = 1;
        }
      });
      cleanup("canvas removal", () => canvas?.remove());
    } finally {
      this.textLoads?.dispose();
      this.textLoads = null;
      this.INTERSECTED = null;
      this.options = null;
      this.scene = null;
      this.camera = null;
      this.controls = null;
      this.viewHelper = null;
      this.renderer = null;
      this.container = null;
      this.clock = null;
      this.mouse = null;
      this.raycaster = null;
      cleanup("disposal notification", () => notifyDisposed?.(this));
    }
  }

  processSelection(objToSelect) {
    if (this.INTERSECTED != objToSelect) {
      if (this.INTERSECTED)
        this.INTERSECTED.material.color.setHex(this.INTERSECTED.currentHex);

      this.INTERSECTED = objToSelect;
      this.INTERSECTED.currentHex = this.INTERSECTED.material.color.getHex();
      this.INTERSECTED.material.color.setHex(
        new THREE.Color(this.options.viewerSettings.selectedColor).getHex(),
      );
    }
  }
}

export default Viewer3D;
