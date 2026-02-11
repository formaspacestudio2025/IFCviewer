import { useEffect, useRef } from "react";
import * as THREE from "three";
import * as OBC from "@thatopen/components";

export default function App() {
  const containerRef = useRef();

  useEffect(() => {
    const container = containerRef.current;
    const components = new OBC.Components();

    // Setup ThatOpen scene and camera
    components.scene = new OBC.SimpleScene(components);
    components.camera = new OBC.SimpleCamera(components, new THREE.PerspectiveCamera());

    // Setup renderer (DOM element container)
    components.renderer = new OBC.SimpleRenderer(components, container);

    // Wait for init to complete before using loaders
    components.init().then(() => {
      const fragmentIfcLoader = components.get(OBC.FragmentIfcLoader);

      fragmentIfcLoader.settings.wasm = {
        path: "https://unpkg.com/web-ifc@0.0.44/"
      };

      // File input
      const input = document.createElement("input");
      input.type = "file";
      input.style.position = "absolute";
      input.style.zIndex = "10";

      input.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const buffer = await file.arrayBuffer();
        const model = await fragmentIfcLoader.load(buffer);

        components.scene.add(model);
        components.camera.fitTo(model); // auto-frame camera
      };

      document.body.appendChild(input);

      // Animate
      const animate = () => {
        requestAnimationFrame(animate);
        components.renderer.render();
      };
      animate();
    });

    // Cleanup
    return () => {
      if (container.firstChild) container.removeChild(container.firstChild);
    };
  }, []);

  return <div ref={containerRef} style={{ width: "100vw", height: "100vh" }} />;
}