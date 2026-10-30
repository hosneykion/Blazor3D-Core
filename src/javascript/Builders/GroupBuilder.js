import * as THREE from "three";
import Transforms from "../Utils/Transforms";
import SceneBuilder from "./SceneBuilder";

class GroupBuilder {

    static BuildGroup(options, scene, textLoads, rootScene = scene, pendingHelpers = null) {
        const group = new THREE.Group();
        group.uuid = options.uuid;
        options.children.forEach((childOptions) => {
            var child = SceneBuilder.BuildChild(childOptions, group, textLoads, rootScene, pendingHelpers);
            if (child) {
                group.add(child);
            }
        });
        Transforms.setPosition(group, options.position);
        Transforms.setRotation(group, options.rotation);
        Transforms.setScale(group, options.scale);
        return group;
    }
}

export default GroupBuilder;