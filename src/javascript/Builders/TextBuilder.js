import * as THREE from "three";
import Transforms from "../Utils/Transforms";
import MaterialBuilder from "./MaterialBuilder";
import TextGeometryBuilder from "./TextGeometryBuilder"

class TextBuilder {

  static BuildText(options, parent, textLoads) {
    textLoads.load(options.geometry.fontURL, (font) => {
      const geometry = TextGeometryBuilder.buildGeometry(options.geometry, font);

      if (options.geometry.type != "TextStrokeGeometry") {
        const material = MaterialBuilder.buildMaterial(options.material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.uuid = options.uuid;
        Transforms.setPosition(mesh, options.position);
        Transforms.setRotation(mesh, options.rotation);
        Transforms.setScale(mesh, options.scale);
        parent.add(mesh);
      }
      else { // build stroke text here
        const strokeText = new THREE.Group();
        Transforms.setPosition(strokeText, options.position);
        Transforms.setRotation(strokeText, options.rotation);
        Transforms.setScale(strokeText, options.scale);
        strokeText.uuid = options.uuid;

        const matDark = new THREE.MeshBasicMaterial({
          color: options.material.color,
          side: THREE.DoubleSide
        });

        geometry.forEach(element => {
          const strokeMesh = new THREE.Mesh(element, matDark);
          strokeText.add(strokeMesh);
        });

        parent.add(strokeText);
      }
    });
  }
}

export default TextBuilder;