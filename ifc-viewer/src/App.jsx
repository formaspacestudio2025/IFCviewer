import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { IFCLoader } from "web-ifc-three/IFCLoader";

function App() {
  const mountRef = useRef();

  useEffect(() => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(10, 10, 10);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountRef.current.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(20, 20, 20);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));

    const ifcLoader = new IFCLoader();
    ifcLoader.ifcManager.setWasmPath(
      "https://unpkg.com/web-ifc@0.0.44/"
    );

    let model;

    const input = document.createElement("input");
    input.type = "file";
    input.style.position = "absolute";
    input.style.zIndex = "1";
    input.onchange = async (event) => {
      const file = event.target.files[0];
      const url = URL.createObjectURL(file);
      model = await ifcLoader.loadAsync(url);
      scene.add(model);
    };

    document.body.appendChild(input);

    const animate = () => {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      mountRef.current.removeChild(renderer.domElement);
    };
  }, []);

  return <div ref={mountRef} />;
}

export default App;