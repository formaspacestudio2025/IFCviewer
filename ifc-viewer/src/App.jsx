import { useEffect, useRef } from "react";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

export default function App() {
  const containerRef = useRef();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const components = new OBC.Components();

    // Scene
    components.scene = new OBC.SimpleScene(components);

    // Camera
    const camera = new THREE.PerspectiveCamera(
      60,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.set(10, 10, 10);
    components.camera = new OBC.SimpleCamera(components, camera);

    // Renderer — pass container at construction (important!)
    components.renderer = new OBC.SimpleRenderer(components, container);

    // Initialize ThatOpen components
    components.init();

    // Orbit controls
    const controls = new OrbitControls(camera, components.renderer.domElement);
    controls.enableDamping = true;
    controls.update();

    // IFC Loader
    const fragmentIfcLoader = components.get(OBC.FragmentIfcLoader);
    if (fragmentIfcLoader) {
      fragmentIfcLoader.settings.wasm = {
        path: "https://unpkg.com/web-ifc@0.0.44/",
      };
    }

    // File input
    const input = document.createElement("input");
    input.type = "file";
    input.style.position = "absolute";
    input.style.zIndex = "10";

    input.onchange = async (event) => {
      const file = event.target.files[0];
      if (!file || !fragmentIfcLoader) return;

      try {
        const buffer = await file.arrayBuffer();
        const model = await fragmentIfcLoader.load(buffer);

        components.scene.add(model);
        components.camera.fitTo(model);
        controls.update();
      } catch (err) {
        console.error("Error loading IFC model:", err);
      }
    };

    document.body.appendChild(input);

    // Animate loop
    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      components.renderer.render();
    };
    animate();

    // Cleanup
    return () => {
      if (container.firstChild) container.removeChild(container.firstChild);
      document.body.removeChild(input);
    };
  }, []);

  return <div ref={containerRef} style={{ width: "100vw", height: "100vh" }} />;
}