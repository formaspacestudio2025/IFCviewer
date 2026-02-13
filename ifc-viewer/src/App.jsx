// App.jsx
import { useEffect, useRef } from "react";
import Stats from "stats.js";
import * as BUI from "@thatopen/ui";
import { Components, Worlds, SimpleScene, OrthoPerspectiveCamera, SimpleRenderer, Grids, IfcLoader, FragmentsManager } from "@thatopen/components";

function App() {
  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const fragmentsRef = useRef(null);
  const ifcLoaderRef = useRef(null);
  const worldRef = useRef(null);
  const buttonRef = useRef(null);
  const statsRef = useRef(null);

  useEffect(() => {
    const init = async () => {
      if (worldRef.current) return; // Already initialized, prevent duplicates

      // Initialize components
      const components = new Components();
      const worlds = components.get(Worlds);

      const world = worlds.create(SimpleScene, OrthoPerspectiveCamera, SimpleRenderer);
      worldRef.current = world;

      world.scene = new SimpleScene(components);
      world.renderer = new SimpleRenderer(components, containerRef.current);
      world.camera = new OrthoPerspectiveCamera(components);

      world.scene.setup();
      components.init();
      await world.camera.controls.setLookAt(10, 10, 10, 0, 0, 0);

      // Only create grid once
      if (!worldRef.current.gridCreated) {
        components.get(Grids).create(world);
        worldRef.current.gridCreated = true;
      }

      // IFC Loader
      const ifcLoader = components.get(IfcLoader);
      ifcLoaderRef.current = ifcLoader;

      ifcLoader.onIfcImporterInitialized.add((importer) => {
        console.log(importer.classes);
      });

      await ifcLoader.setup({
        autoSetWasm: false,
        wasm: { path: "/wasm/", absolute: false },
      });

      // Fragments Manager
      const githubUrl = "https://thatopen.github.io/engine_fragment/resources/worker.mjs";
      const fetchedUrl = await fetch(githubUrl);
      const workerBlob = await fetchedUrl.blob();
      const workerFile = new File([workerBlob], "worker.mjs", { type: "text/javascript" });
      const workerUrl = URL.createObjectURL(workerFile);

      const fragments = components.get(FragmentsManager);
      fragmentsRef.current = fragments;
      fragments.init(workerUrl);

      world.camera.controls.addEventListener("update", () => fragments.core.update());

      fragments.list.onItemSet.add(({ value: model }) => {
        model.useCamera(world.camera.three);
        world.scene.three.add(model.object);
        fragments.core.update(true);
      });

      fragments.core.models.materials.list.onItemSet.add(({ value: material }) => {
        if (!("isLodMaterial" in material && material.isLodMaterial)) {
          material.polygonOffset = true;
          material.polygonOffsetUnits = 1;
          material.polygonOffsetFactor = Math.random();
        }
      });

      // Initialize UI
      BUI.Manager.init();

      const loadIfc = async (path) => {
        const file = await fetch(path);
        const data = await file.arrayBuffer();
        const buffer = new Uint8Array(data);
        await ifcLoader.load(buffer, false, "example", {
          processData: { progressCallback: (progress) => console.log(progress) },
        });
      };

      const downloadFragments = async () => {
        const [model] = fragments.list.values();
        if (!model) return;
        const fragsBuffer = await model.getBuffer(false);
        const file = new File([fragsBuffer], "school_str.frag");
        const link = document.createElement("a");
        link.href = URL.createObjectURL(file);
        link.download = file.name;
        link.click();
        URL.revokeObjectURL(link.href);
      };

      // Create UI panel (only once)
      if (!panelRef.current) {
        const [panel, updatePanel] = BUI.Component.create((_) => {
          let downloadBtn, loadBtn;
          if (fragments.list.size > 0) {
            downloadBtn = BUI.html`<bim-button label="Download Fragments" @click=${downloadFragments}></bim-button>`;
          }
          if (fragments.list.size === 0) {
            const onLoadIfc = async ({ target }) => {
              target.label = "Conversion in progress...";
              target.loading = true;
              await loadIfc(
                "https://thatopen.github.io/engine_components/resources/ifc/school_str.ifc"
              );
              target.loading = false;
              target.label = "Load IFC";
            };
            loadBtn = BUI.html`
              <bim-button label="Load IFC" @click=${onLoadIfc}></bim-button>
              <bim-label>Open the console to see the progress!</bim-label>
            `;
          }

          return BUI.html`
            <bim-panel active label="IfcLoader Tutorial" class="options-menu">
              <bim-panel-section label="Controls">
                ${loadBtn}
                ${downloadBtn}
              </bim-panel-section>
            </bim-panel>
          `;
        }, {});
        panelRef.current = panel;
        document.body.append(panel);
        fragments.list.onItemSet.add(() => panelRef.current.update());
      }

      // Phone toggle button (only once)
      if (!buttonRef.current) {
        const button = BUI.Component.create(() => {
          return BUI.html`
            <bim-button class="phone-menu-toggler" icon="solar:settings-bold"
              @click="${() => {
                if (panelRef.current.classList.contains("options-menu-visible")) {
                  panelRef.current.classList.remove("options-menu-visible");
                } else {
                  panelRef.current.classList.add("options-menu-visible");
                }
              }}">
            </bim-button>
          `;
        });
        buttonRef.current = button;
        document.body.append(button);
      }

      // Stats (only once)
      if (!statsRef.current) {
        const stats = new Stats();
        stats.showPanel(2);
        document.body.append(stats.dom);
        stats.dom.style.left = "0px";
        stats.dom.style.zIndex = "unset";
        statsRef.current = stats;

        world.renderer.onBeforeUpdate.add(() => stats.begin());
        world.renderer.onAfterUpdate.add(() => stats.end());
      }
    };

    init();
  }, []);

  return <div ref={containerRef} style={{ width: "100vw", height: "100vh" }} />;
}

export default App;