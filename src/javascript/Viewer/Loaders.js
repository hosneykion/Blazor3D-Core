import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import Transforms from "../Utils/Transforms";
import MaterialBuilder from "../Builders/MaterialBuilder";
import disposeOwnedResources from "../Utils/DisposeOwnedResources";

class Loaders {
  static loadGltf(scene, url, guid, containerId, isActive) {
    const loader = new GLTFLoader();
    loader.load(url, (object) => {
      if (!isActive()) {
        disposeOwnedResources(object.scene);
        return;
      }
      object.scene.uuid = guid;
      scene.add(object.scene);
      Loaders.callDotNet(containerId, guid, isActive);
    });
  }

  static loadFbx(scene, url, guid, containerId, isActive) {
    const loader = new FBXLoader();
    loader.load(url, (object) => {
      if (!isActive()) {
        disposeOwnedResources(object);
        return;
      }
      scene.add(object);
      object.uuid = guid;
      Loaders.callDotNet(containerId, guid, isActive);
    });
  }

  static loadCollada(scene, url, guid, containerId, isActive) {
    let object;
    const manager = new THREE.LoadingManager(() => {
      if (!object) return;
      if (!isActive()) {
        disposeOwnedResources(object);
        return;
      }
      scene.add(object);
      object.uuid = guid;
      Loaders.callDotNet(containerId, guid, isActive);
    });
    const loader = new ColladaLoader(manager);
    loader.load(url, (obj) => {
      object = obj.scene;
    });
  }

  static loadOBJ(scene, objUrl, textureUrl, guid, containerId, isActive) {
    let object = null;
    let texture = null;
    let textureAssigned = false;

    const manager = new THREE.LoadingManager(() => {
      if (!object) {
        // The OBJ failed to load, so no object can own the texture.
        texture?.dispose();
        return;
      }

      if (texture) {
        object.traverse((child) => {
          if (!child.isMesh || !child.material) {
            return;
          }

          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];

          for (const material of materials) {
            if (!material) {
              continue;
            }

            material.map = texture;
            material.needsUpdate = true;
            textureAssigned = true;
          }
        });
      }

      if (!isActive()) {
        // Dispose resources from a load that finished after its viewer
        // or scene was disposed.
        disposeOwnedResources(object);

        // If the texture wasn't attached to a material, the object
        // cleanup cannot own or dispose it.
        if (texture && !textureAssigned) {
          texture.dispose();
        }

        return;
      }

      // A loaded texture with no receiving mesh/material is unused.
      if (texture && !textureAssigned) {
        texture.dispose();
      }

      scene.add(object);
      object.uuid = guid;

      Loaders.callDotNet(containerId, guid, isActive);
    });

    // Only request a texture when a URL was supplied.
    if (textureUrl) {
      texture = new THREE.TextureLoader(manager).load(textureUrl);
    }

    const loader = new OBJLoader(manager);

    loader.load(
      objUrl,
      (obj) => {
        object = obj;
      },
      undefined,
      (error) => {
        console.warn("Blazor3D OBJ load failed.", error);
      },
    );

    return object;
  }

  static loadStl(scene, url, guid, containerId, materialSettings, isActive) {
    const loader = new STLLoader();
    loader.load(url, function (geometry) {
      if (!isActive()) {
        geometry.dispose();
        return;
      }

      // const material = new THREE.MeshPhongMaterial( { color: 0xff5533, specular: 0x111111, shininess: 200 } );
      // const material = new THREE.MeshStandardMaterial({
      //   color: 0xff5533,
      // });
      const material = MaterialBuilder.buildMaterial(materialSettings);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.uuid = guid;

      // mesh.position.set( 0, - 0.25, 0.6 );
      // mesh.rotation.set( 0, - Math.PI / 2, 0 );
      // mesh.scale.set( 0.5, 0.5, 0.5 );

      // mesh.castShadow = true;
      // mesh.receiveShadow = true;

      scene.add(mesh);
      Loaders.callDotNet(containerId, guid, isActive);
    });
  }

  static import3DModel(scene, settings, containerId, isActive = () => true) {
    const format = settings.format;
    let objUrl = settings.fileURL;
    let textureUrl = settings.textureURL;
    let guid = settings.uuid;
    let material = settings.material;

    if (format == "Obj") {
      return Loaders.loadOBJ(
        scene,
        objUrl,
        textureUrl,
        guid,
        containerId,
        isActive,
      );
    }
    if (format == "Collada") {
      return Loaders.loadCollada(scene, objUrl, guid, containerId, isActive);
    }
    if (format == "Fbx") {
      return Loaders.loadFbx(scene, objUrl, guid, containerId, isActive);
    }
    if (format == "Gltf") {
      return Loaders.loadGltf(scene, objUrl, guid, containerId, isActive);
    }

    if (format == "Stl") {
      return Loaders.loadStl(
        scene,
        objUrl,
        guid,
        containerId,
        material,
        isActive,
      );
    }

    return null;
  }

  static importSprite(scene, settings, containerId, isActive = () => true) {
    if (!isActive()) return;

    let url = settings.fileURL;
    let guid = settings.uuid;
    let sprite;
    settings.material.map.textureUrl = url;
    const material = MaterialBuilder.buildMaterial(settings.material);
    sprite = new THREE.Sprite(material);
    Transforms.setPosition(sprite, settings.position);
    Transforms.setRotation(sprite, settings.rotation);
    Transforms.setScale(sprite, settings.scale);
    sprite.uuid = guid;
    sprite.name = settings.name;
    scene.add(sprite);
    Loaders.callDotNet(containerId, guid, isActive);
  }

  static callDotNet(containerId, uuid, isActive = () => true) {
    if (!isActive()) return;

    DotNet.invokeMethodAsync(
      "Blazor3D",
      "ReceiveLoadedObjectUUID",
      containerId,
      uuid,
    ).catch((error) => {
      // A pending load may finish as the Blazor circuit is shutting down.
      if (isActive())
        console.warn("Blazor3D model-loaded callback failed.", error);
    });
  }
}

export default Loaders;
