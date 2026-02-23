import Stats from "stats.js";
import {
  Classifier,
  Components,
  FragmentsManager,
  Grids,
  Hider,
  IfcLoader,
  OrthoPerspectiveCamera,
  SimpleRenderer,
  SimpleScene,
  World,
  Worlds,
} from "@thatopen/components";

import * as OBCF from "@thatopen/components-front";
import { Color, OrthographicCamera, PerspectiveCamera } from "three";

export interface ModelGroupInfo {
  name: string;
  count: number;
}

export interface ModelOverview {
  id: string;
  name: string;
  classes: ModelGroupInfo[];
  propertyGroups: ModelGroupInfo[];
}

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
  public classifier!: Classifier;
  public hider!: Hider;

  public onSelectObject?: (items: any) => void;
  public onModelsChanged?: () => void;

  private initialized = false;
  private static gridCreated = false;
  private modelNames = new Map<string, string>();
  private readonly readyPromise: Promise<void>;

  private constructor(container: HTMLElement) {
    this.container = container;
    this.readyPromise = this.init();
  }

  private async ensureReady() {
    await this.readyPromise;
  }

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

    this.classifier = this.components.get(Classifier);
    this.hider = this.components.get(Hider);
    this.setupHighlighter();
    this.setupStats();
  }

  private async setupIfc() {
    this.ifcLoader = this.components.get(IfcLoader);
    await this.ifcLoader.setup({
      autoSetWasm: false,
      wasm: { path: "/wasm/", absolute: false },
    });
  }

  private async setupFragments() {
    const workerUrl = "/worker.mjs";
    this.fragments = this.components.get(FragmentsManager);
    this.fragments.init(workerUrl);

    this.world.camera.controls?.addEventListener("update", () => this.fragments.core.update());

    this.fragments.list.onItemSet.add(async ({ key: modelId, value: model }) => {
      const cam = this.world.camera.three;
      if (cam instanceof PerspectiveCamera || cam instanceof OrthographicCamera) {
        model.useCamera(cam);
      }
      this.world.scene.three.add(model.object);
      this.fragments.core.update(true);

      if (!this.modelNames.has(modelId)) {
        this.modelNames.set(modelId, `Model ${this.modelNames.size + 1}`);
      }

      await this.refreshClassifications();
      this.onModelsChanged?.();
    });

    this.fragments.list.onBeforeDelete.add(async ({ key: modelId, value: model }) => {
      this.world.scene.three.remove(model.object);
      this.modelNames.delete(modelId);
      await this.refreshClassifications();
      this.onModelsChanged?.();
    });
  }

  private setupHighlighter() {
    const highlighter = this.components.get(OBCF.Highlighter);
    highlighter.setup({ world: this.world });

    highlighter.events.select.onHighlight.add(async (modelIdMap) => {
      for (const [modelId, localIds] of Object.entries(modelIdMap)) {
        const model = this.fragments.list.get(modelId);
        if (!model) continue;

        const itemsData = await model.getItemsData([...localIds]);

        if (this.onSelectObject) {
          const itemsObj: Record<string, any> = {};
          itemsData.forEach((item, i) => {
            itemsObj[i] = item;
          });
          this.onSelectObject(itemsObj);
        }

        break;
      }
    });

    highlighter.events.select.onClear.add(() => {
      this.onSelectObject?.({});
    });
  }

  private setupStats() {
    this.stats = new Stats();
    this.stats.showPanel(2);
    document.body.append(this.stats.dom);

    this.world.renderer?.onBeforeUpdate.add(() => this.stats.begin());
    this.world.renderer?.onAfterUpdate.add(() => this.stats.end());
  }

  private async refreshClassifications(propertyKey = "PredefinedType") {
    this.classifier.list.clear();

    await this.classifier.byModel({ classificationName: "Models" });
    await this.classifier.byCategory({ classificationName: "IFC Classes" });
    await this.classifyByProperty(propertyKey);
  }

  private async classifyByProperty(propertyKey: string) {
    const classificationName = this.getPropertyClassificationName(propertyKey);
    await this.classifier.aggregateItems(
      classificationName,
      { categories: [/.*/] },
      {
        aggregationCallback: (item, register) => {
          const localId = item?._localId;
          const prop = item?.[propertyKey];
          if (!localId || !("value" in localId) || !prop || !("value" in prop)) return;

          const value = String(prop.value ?? "").trim();
          if (!value) return;

          register(value, localId.value);
        },
      }
    );
  }

  private getPropertyClassificationName(propertyKey: string) {
    return `Property:${propertyKey}`;
  }

  private async getModelIdMap(modelId: string) {
    return this.classifier.find({ Models: [modelId] });
  }

  private async getClassIdMap(modelId: string, className: string) {
    return this.classifier.find({ Models: [modelId], "IFC Classes": [className] });
  }

  private async getPropertyGroupIdMap(modelId: string, propertyKey: string, groupName: string) {
    return this.classifier.find({
      Models: [modelId],
      [this.getPropertyClassificationName(propertyKey)]: [groupName],
    });
  }

  private getModelItemCount(itemsByModel: Record<string, Set<number>>, modelId: string) {
    return itemsByModel[modelId]?.size ?? 0;
  }

  public async getModelsOverview(propertyKey: string): Promise<ModelOverview[]> {
    await this.ensureReady();
    await this.classifyByProperty(propertyKey);

    const classGroups = this.classifier.list.get("IFC Classes");
    const propertyGroups = this.classifier.list.get(this.getPropertyClassificationName(propertyKey));

    const overviews: ModelOverview[] = [];

    for (const modelId of this.fragments.list.keys()) {
      const name = this.modelNames.get(modelId) ?? modelId;

      const classes: ModelGroupInfo[] = [];
      if (classGroups) {
        for (const [className] of classGroups) {
          const items = await this.getClassIdMap(modelId, className);
          const count = this.getModelItemCount(items, modelId);
          if (count > 0) classes.push({ name: className, count });
        }
      }

      const groupedByProperty: ModelGroupInfo[] = [];
      if (propertyGroups) {
        for (const [groupName] of propertyGroups) {
          const items = await this.getPropertyGroupIdMap(modelId, propertyKey, groupName);
          const count = this.getModelItemCount(items, modelId);
          if (count > 0) groupedByProperty.push({ name: groupName, count });
        }
      }

      overviews.push({
        id: modelId,
        name,
        classes: classes.sort((a, b) => b.count - a.count),
        propertyGroups: groupedByProperty.sort((a, b) => b.count - a.count),
      });
    }

    return overviews;
  }

  public async loadIfcFromFile(file: File) {
    await this.ensureReady();
    const data = await file.arrayBuffer();
    const buffer = new Uint8Array(data);
    await this.ifcLoader.load(buffer, false, file.name);

    const latestModelId = Array.from(this.fragments.list.keys()).at(-1);
    if (latestModelId) {
      this.modelNames.set(latestModelId, file.name);
      this.onModelsChanged?.();
    }
  }

  public async removeModel(modelId: string) {
    await this.ensureReady();
    this.fragments.list.delete(modelId);
  }

  public async hideModel(modelId: string) {
    await this.ensureReady();
    await this.hider.set(false, await this.getModelIdMap(modelId));
  }

  public async showModel(modelId: string) {
    await this.ensureReady();
    await this.hider.set(true, await this.getModelIdMap(modelId));
  }

  public async isolateModel(modelId: string) {
    await this.ensureReady();
    await this.hider.isolate(await this.getModelIdMap(modelId));
  }

  public async hideClass(modelId: string, className: string) {
    await this.ensureReady();
    await this.hider.set(false, await this.getClassIdMap(modelId, className));
  }

  public async showClass(modelId: string, className: string) {
    await this.ensureReady();
    await this.hider.set(true, await this.getClassIdMap(modelId, className));
  }

  public async isolateClass(modelId: string, className: string) {
    await this.ensureReady();
    await this.hider.isolate(await this.getClassIdMap(modelId, className));
  }

  public async hidePropertyGroup(modelId: string, propertyKey: string, groupName: string) {
    await this.ensureReady();
    await this.hider.set(false, await this.getPropertyGroupIdMap(modelId, propertyKey, groupName));
  }

  public async showPropertyGroup(modelId: string, propertyKey: string, groupName: string) {
    await this.ensureReady();
    await this.hider.set(true, await this.getPropertyGroupIdMap(modelId, propertyKey, groupName));
  }

  public async isolatePropertyGroup(modelId: string, propertyKey: string, groupName: string) {
    await this.ensureReady();
    await this.hider.isolate(await this.getPropertyGroupIdMap(modelId, propertyKey, groupName));
  }

  public async colorModel(modelId: string, color: string) {
    await this.ensureReady();
    await this.fragments.highlight({ color: new Color(color), opacity: 1, transparent: false } as any, await this.getModelIdMap(modelId));
  }

  public async colorClass(modelId: string, className: string, color: string) {
    await this.ensureReady();
    await this.fragments.highlight(
      { color: new Color(color), opacity: 1, transparent: false } as any,
      await this.getClassIdMap(modelId, className)
    );
  }

  public async colorPropertyGroup(modelId: string, propertyKey: string, groupName: string, color: string) {
    await this.ensureReady();
    await this.fragments.highlight(
      { color: new Color(color), opacity: 1, transparent: false } as any,
      await this.getPropertyGroupIdMap(modelId, propertyKey, groupName)
    );
  }

  public async resetColors() {
    await this.ensureReady();
    await this.fragments.resetHighlight();
  }

  public async showAll() {
    await this.ensureReady();
    await this.hider.set(true);
  }

  public async downloadFragments() {
    await this.ensureReady();

    const model = this.fragments.list.values().next().value as any;
    if (!model) return;

    model.getBuffer(false).then((buf: Uint8Array) => {
      const safeBuffer = new Uint8Array(buf);
      const file = new File([safeBuffer], "fragments.frag", {
        type: "application/octet-stream",
      });

      const link = document.createElement("a");
      link.href = URL.createObjectURL(file);
      link.download = file.name;
      link.click();

      URL.revokeObjectURL(link.href);
    });
  }
}
