// core/Viewer.ts
import Stats from "stats.js";
import * as BUI from "@thatopen/ui";
import {
  Components,
  Worlds,
  SimpleScene,
  OrthoPerspectiveCamera,
  SimpleRenderer,
  Grids,
  IfcLoader,
  FragmentsManager,
} from "@thatopen/components";

export class Viewer {
  components;
  world;
  fragments;
  ifcLoader;
  stats;

  constructor(container) {
    this.init(container);
  }

  async init(container) {
    this.components = new Components();
    const worlds = this.components.get(Worlds);

    this.world = worlds.create(
      SimpleScene,
      OrthoPerspectiveCamera,
      SimpleRenderer
    );

    this.world.scene = new SimpleScene(this.components);
    this.world.renderer = new SimpleRenderer(this.components, container);
    this.world.camera = new OrthoPerspectiveCamera(this.components);

    this.world.scene.setup();
    this.components.init();

    await this.world.camera.controls.setLookAt(10, 10, 10, 0, 0, 0);

    this.components.get(Grids).create(this.world);

    await this.setupIfc();
    await this.setupFragments();
    this.setupStats();
  }

  async setupIfc() {
    this.ifcLoader = this.components.get(IfcLoader);

    await this.ifcLoader.setup({
      autoSetWasm: false,
      wasm: { path: "/wasm/", absolute: false },
    });
  }

  async setupFragments() {
    const githubUrl =
      "https://thatopen.github.io/engine_fragment/resources/worker.mjs";

    const fetchedUrl = await fetch(githubUrl);
    const workerBlob = await fetchedUrl.blob();
    const workerUrl = URL.createObjectURL(
      new File([workerBlob], "worker.mjs", {
        type: "text/javascript",
      })
    );

    this.fragments = this.components.get(FragmentsManager);
    this.fragments.init(workerUrl);

    this.world.camera.controls.addEventListener("update", () =>
      this.fragments.core.update()
    );

    this.fragments.list.onItemSet.add(({ value: model }) => {
      model.useCamera(this.world.camera.three);
      this.world.scene.three.add(model.object);
      this.fragments.core.update(true);
    });
  }

  async loadIfcFromFile(file) {
    const data = await file.arrayBuffer();
    const buffer = new Uint8Array(data);
    await this.ifcLoader.load(buffer, false, file.name);
  }

  setupStats() {
    this.stats = new Stats();
    this.stats.showPanel(2);
    document.body.append(this.stats.dom);

    this.world.renderer.onBeforeUpdate.add(() => this.stats.begin());
    this.world.renderer.onAfterUpdate.add(() => this.stats.end());
  }
}