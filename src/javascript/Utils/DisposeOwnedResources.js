function collectTexturesFromValue(value, textures, seen) {
  if (!value || typeof value !== "object") return;

  if (value.isTexture) {
    textures.add(value);
    return;
  }

  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach(item => collectTexturesFromValue(item, textures, seen));
    return;
  }

  // ShaderMaterial uniforms commonly wrap their value in an object.
  if (Object.prototype.hasOwnProperty.call(value, "value")) {
    collectTexturesFromValue(value.value, textures, seen);
  }
}

export function collectOwnedResources(root) {
  const resources = {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(),
    skeletons: new Set(),
  };

  if (!root?.traverse) return resources;

  root.traverse(object => {
    if (object.geometry) resources.geometries.add(object.geometry);

    const materials = [
      ...(Array.isArray(object.material) ? object.material : [object.material]),
      object.customDepthMaterial,
      object.customDistanceMaterial,
    ];

    for (const material of materials) {
      if (!material) continue;
      resources.materials.add(material);

      const seen = new Set();
      for (const value of Object.values(material)) {
        if (value?.isTexture) resources.textures.add(value);
        else if (Array.isArray(value)) {
          collectTexturesFromValue(value, resources.textures, seen);
        }
      }

      if (material.uniforms) {
        for (const uniform of Object.values(material.uniforms)) {
          collectTexturesFromValue(uniform?.value, resources.textures, seen);
        }
      }
    }

    if (object.skeleton) resources.skeletons.add(object.skeleton);
  });

  return resources;
}

function disposeResource(resource, type) {
  try {
    resource?.dispose?.();
  } catch (error) {
    // Continue releasing other resources if one disposal fails.
    console.warn(`Failed to dispose Three.js ${type}.`, error);
  }
}

function collectImageBitmaps(image, bitmaps, seen = new Set()) {
  if (!image || seen.has(image)) return;
  seen.add(image);

  if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) {
    bitmaps.add(image);
  } else if (Array.isArray(image)) {
    image.forEach(item => collectImageBitmaps(item, bitmaps, seen));
  }
}

function collectRetainedImageBitmaps(textures) {
  const bitmaps = new Set();
  for (const texture of textures) {
    collectImageBitmaps(texture.image, bitmaps);
  }
  return bitmaps;
}

export function disposeTextures(textures, keepTextures = new Set()) {
  const texturesToDispose = new Set(
    Array.from(textures).filter(texture => texture && !keepTextures.has(texture))
  );
  const retainedBitmaps = collectRetainedImageBitmaps(keepTextures);

  for (const texture of texturesToDispose) {
    disposeResource(texture, "texture");
  }

  const closedBitmaps = new Set();
  for (const texture of texturesToDispose) {
    const bitmaps = new Set();
    collectImageBitmaps(texture.image, bitmaps);
    for (const bitmap of bitmaps) {
      if (retainedBitmaps.has(bitmap) || closedBitmaps.has(bitmap)) continue;
      try {
        bitmap.close();
        closedBitmaps.add(bitmap);
      } catch (error) {
        console.warn("Failed to close Three.js ImageBitmap.", error);
      }
    }
  }
}

export function disposeResourcesNotIn(removedRoot, remainingRoot, keepResources = new Set()) {
  const removed = collectOwnedResources(removedRoot);
  const remaining = collectOwnedResources(remainingRoot);
  const retainedTextures = new Set(remaining.textures);
  for (const resource of keepResources) {
    if (resource?.isTexture) retainedTextures.add(resource);
  }

  const labels = {
    geometries: "geometry",
    materials: "material",
    textures: "texture",
    skeletons: "skeleton",
  };

  const texturesToDispose = Array.from(removed.textures).filter(
    texture => !remaining.textures.has(texture) && !keepResources.has(texture)
  );
  disposeTextures(texturesToDispose, retainedTextures);

  for (const type of Object.keys(removed)) {
    if (type === "textures") continue;
    for (const resource of removed[type]) {
      if (!remaining[type].has(resource) && !keepResources.has(resource)) {
        disposeResource(resource, labels[type]);
      }
    }
  }
}

// Use for resources owned by this viewer. Assets shared outside this viewer
// need an explicit ownership/ref-counting policy before they can be disposed.
export default function disposeOwnedResources(root, keepTextures = new Set()) {
  const resources = collectOwnedResources(root);
  disposeTextures(resources.textures, keepTextures);
  for (const material of resources.materials) disposeResource(material, "material");
  for (const geometry of resources.geometries) disposeResource(geometry, "geometry");
  for (const skeleton of resources.skeletons) disposeResource(skeleton, "skeleton");
}
