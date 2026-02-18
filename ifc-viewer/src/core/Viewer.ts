// core/Viewer.ts
import Stats from "stats.js";
import {
  Components,
  Worlds,
  SimpleScene,
  OrthoPerspectiveCamera,
  SimpleRenderer,
  Grids,
  IfcLoader,
  FragmentsManager,
  World,
} from "@thatopen/components";

import { PerspectiveCamera, OrthographicCamera, Object3D } from "three";
import * as OBCF from "@thatopen/components-front"; // Highlighter
import "@thatopen/ui-obc"; // <bim-panel> and <bui-properties-table>

export class Viewer {
  private static instance: Viewer | null = null;

  public static getInstance(container: HTMLElement): Viewer {
    if (!Viewer.instance) Viewer.instance = new Viewer(container);
    return Viewer.instance;
  }

  public container: HTMLElement;
  public components!: Components;
  public world!: World;
  public fragments!: FragmentsManager;
  public ifcLoader!: IfcLoader;
  public stats!: Stats;

  public onSelectObject?: (obj: Object3D | null, props?: any[]) => void;

  private initialized = false;
  private static gridCreated = false;

  private constructor(container: HTMLElement) {
    this.container = container;
    void this.init();
  }

  // -----------------
  // Initialization
  // -----------------
  private async init() {
    if (this.initialized) return;
    this.initialized = true;

    this.components = new Components();
    const worlds = this.components.get(Worlds);

    this.world = worlds.create();
    this.world.scene = new SimpleScene(this.components);
    this.world.renderer = new SimpleRenderer(this.components, this.container);
    this.world.camera = new OrthoPerspectiveCamera(this.components);

    (this.world.scene as SimpleScene).setup();
    this.components.init();

    await this.world.camera.controls?.setLookAt(10, 10, 10, 0, 0, 0);

    if (!Viewer.gridCreated) {
      this.components.get(Grids).create(this.world);
      Viewer.gridCreated = true;
    }

    await this.setupIfc();
    await this.setupFragments();
    this.setupHighlighter();
    this.setupStats();
  }

  // -----------------
  // IFC Loader
  // -----------------
  private async setupIfc() {
    this.ifcLoader = this.components.get(IfcLoader);
    await this.ifcLoader.setup({
      autoSetWasm: false,
      wasm: { path: "/wasm/", absolute: false },
    });
  }

  // -----------------
  // Fragments
  // -----------------
  private async setupFragments() {
    const url = "https://thatopen.github.io/engine_fragment/resources/worker.mjs";
    const res = await fetch(url);
    const blob = await res.blob();
    const workerUrl = URL.createObjectURL(
      new File([blob], "worker.mjs", { type: "text/javascript" })
    );

    this.fragments = this.components.get(FragmentsManager);
    this.fragments.init(workerUrl);

    this.world.camera.controls?.addEventListener("update", () =>
      this.fragments.core.update()
    );

    this.fragments.list.onItemSet.add(({ value: model }) => {
      const cam = this.world.camera.three;
      if (cam instanceof PerspectiveCamera || cam instanceof OrthographicCamera) {
        model.useCamera(cam);
      }
      this.world.scene.three.add(model.object);
      this.fragments.core.update(true);
    });
  }

  // -----------------
  // Highlighter + Property Extraction
  // -----------------
  private setupHighlighter() {
    const highlighter = this.components.get(OBCF.Highlighter);
    highlighter.setup({ world: this.world });

    // Selection: extract properties for highlighted objects
    highlighter.events.select.onHighlight.add(async (modelIdMap) => {
      const promises: Promise<any[]>[] = [];

      for (const [modelId, localIds] of Object.entries(modelIdMap)) {
        const model = this.fragments.list.get(modelId);
        if (!model) continue;

        promises.push(model.getItemsData([...localIds]));
      }

      const itemsData = (await Promise.all(promises)).flat();

      // Callback for custom logic
      if (this.onSelectObject) {
        this.onSelectObject(null, itemsData);
      }

      // Render in property window
      this.renderItemsData(itemsData);
    });

    // Clear selection
    highlighter.events.select.onClear.add(() => {
      this.renderItemsData([]);
    });
  }

  // -----------------
  // Render ItemsData into <bui-properties-table>
  // -----------------
  private renderItemsData(data: any[]) {
    const table = document.getElementById("properties-table") as any;
    if (!table) return;

    table.clear?.();
    data.forEach((item) => {
      const { name, value } = item;
      table.addRow?.({ name, value });
    });
  }

  // -----------------
  // Stats
  // -----------------
  private setupStats() {
    this.stats = new Stats();
    this.stats.showPanel(2);
    document.body.append(this.stats.dom);

    this.world.renderer?.onBeforeUpdate.add(() => this.stats.begin());
    this.world.renderer?.onAfterUpdate.add(() => this.stats.end());
  }

  // -----------------
  // Public API
  // -----------------
  public async loadIfcFromFile(file: File) {
    const data = await file.arrayBuffer();
    const buffer = new Uint8Array(data);
    await this.ifcLoader.load(buffer, false, file.name);
  }

  public async loadIfcFromURL(url: string) {
    const file = await fetch(url);
    const data = await file.arrayBuffer();
    const buffer = new Uint8Array(data);
    await this.ifcLoader.load(buffer, false, "example.ifc");
  }

  public downloadFragments() {
    const model = this.fragments.list.values().next().value as any;
    if (!model) return;

    model.getBuffer(false).then((buf: Uint8Array) => {
      const arrayBufferView = new Uint8Array(buf);
      const file = new File([arrayBufferView], "fragments.frag", { type: "application/octet-stream" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = file.name;
      link.click();
      URL.revokeObjectURL(link.href);
    });
  }
}