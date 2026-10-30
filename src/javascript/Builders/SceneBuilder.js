import TextBuilder from "./TextBuilder";
import HelperBuilder from "./HelperBuilder";
import LightBuilder from "./LightBuilder";
import MeshBuilder from "./MeshBuilder";
import GroupBuilder from "./GroupBuilder";
import LineBuilder from "./LineBuilder";
import SpriteBuilder from "./SpriteBuilder";

class SceneBuilder {

  static BuildChild(options, scene, textLoads, rootScene = scene, pendingHelpers = null) {
    if (options.type == "Text") {
      TextBuilder.BuildText(options, scene, textLoads);
      return null;
    }
    if (options.type == "Mesh") {
      return MeshBuilder.BuildMesh(options);
    }

    if (options.type == "Line") {
      return LineBuilder.BuildMesh(options);
    }
    
    if (options.type == "SplineCurve"){
      return SplineCurveBuilder.BuildMesh(options)
    }

    if (options.type == "Group") {
      return GroupBuilder.BuildGroup(options, scene, textLoads, rootScene, pendingHelpers);
    }

    if (options.type == "AmbientLight") {
      return LightBuilder.BuildAmbientLight(options);
    }

    if (options.type == "PointLight") {
      return LightBuilder.BuildPointLight(options);
    }

    if (options.type.includes("Helper")) {
      if (pendingHelpers) {
        pendingHelpers.push({ options, parent: scene, rootScene });
        return null;
      }
      return HelperBuilder.BuildHelper(options, scene, rootScene);
    }

    if (options.type.includes("Sprite")) {
      return SpriteBuilder.BuildSprite(options);
    }
  }

  static BuildPendingHelpers(pendingHelpers) {
    pendingHelpers.forEach(({ options, parent, rootScene }) => {
      const helper = HelperBuilder.BuildHelper(options, parent, rootScene);
      if (helper) parent.add(helper);
    });
  }
}

export default SceneBuilder;
