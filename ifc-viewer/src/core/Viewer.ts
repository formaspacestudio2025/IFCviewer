import Stats from "stats.js";
import * as THREE from "three";
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
import { MeshBVH, acceleratedRaycast } from "three-mesh-bvh";
import { ClashVisualizer } from "./ClashVisualizer";

// Debug flag for clash detection
declare global {
  // eslint-disable-next-line no-var
  var clashDebugLogged: boolean;
}

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

export type RuleOperator =
  | "exists"
  | "notEmpty"
  | "equals"
  | "notEquals"
  | "in"
  | "regex"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export interface ComplianceCondition {
  property: string;
  operator: RuleOperator;
  value?: string | number | Array<string | number>;
}

export interface ComplianceRule {
  id: string;
  name: string;
  description?: string;
  target?: {
    ifcClass?: string;
    modelId?: string;
  };
  checks: ComplianceCondition[];
}

export interface ComplianceDefinition {
  project?: string;
  version?: string;
  rules: ComplianceRule[];
}

export interface ComplianceIssue {
  ruleId: string;
  ruleName: string;
  modelId: string;
  modelName: string;
  localId: number;
  ifcClass?: string;
  failedChecks: string[];
  elementProperties: Record<string, string>;
}

export interface ComplianceRunResult {
  runAt: string;
  checkedElements: number;
  compliantElements: number;
  nonCompliantElements: number;
  modelStats: Array<{
    modelId: string;
    modelName: string;
    checked: number;
    nonCompliant: number;
  }>;
  ruleStats: Array<{
    ruleId: string;
    ruleName: string;
    checked: number;
    failed: number;
  }>;
  issues: ComplianceIssue[];
}

export type ClashType = "hard" | "soft" | "clearance";

export interface ClashResult {
  id: string;
  type: ClashType;
  a: {
    modelId: string;
    modelName: string;
    guid: string;
    ifcClass: string;
    category?: string;
  };
  b: {
    modelId: string;
    modelName: string;
    guid: string;
    ifcClass: string;
    category?: string;
  };
  collision: {
    position: [number, number, number];
    normal: [number, number, number];
  };
}

export interface ClashRunResult {
  runAt: string;
  hardClashes: number;
  softClashes: number;
  clearanceClashes: number;
  totalClashes: number;
  clashes: ClashResult[];
  skipped?: Record<string, number>;
  originalObjects?: number;
  uniqueBoxes?: number;
  debug?: Record<string, any>;
}

export interface ModelObject {
  id: string;
  guid: string;
  ifcClass: string;
  localId: number;
  properties: Record<string, any>;
  bbox?: THREE.Box3;
  geometry?: THREE.BufferGeometry;
  category?: string;
  _bvh?: MeshBVH;
}

export interface ClashFilterOptions {
  selectedModels?: Set<string>;
  selectedClasses?: Set<string>;
  propertyFilter?: {
    key: string;
    value: string;
  };
  selectedObjects?: Map<string, Set<string>>;
  ignoreSameCategory?: boolean;
  categories?: Set<string>;
  resume?: boolean;
  zones?: Set<string>;
  status?: Set<"new" | "reviewed" | "accepted" | "deferred">;
}

const CLASH_DEBUG = false;

interface ClashCacheEntry {
  filters?: ClashFilterOptions;
  models: string[];
  tolerance?: number;
  clearance?: number;
  objectCounts: Map<string, number>;
  result?: ClashRunResult;
}

THREE.Mesh.prototype.raycast = acceleratedRaycast;

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
  public clashVisualizer!: ClashVisualizer;

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

    this.fragments = this.components.get(FragmentsManager);
    if (!this.fragments.initialized) {
      this.fragments.init("/worker.mjs");
    }

    (this.world.scene as SimpleScene).setup();
    this.components.init();

    await this.world.camera.controls?.setLookAt(10, 10, 10, 0, 0, 0);

    if (!Viewer.gridCreated) {
      this.components.get(Grids).create(this.world);
      Viewer.gridCreated = true;
    }

    this.classifier = this.components.get(Classifier);
    this.hider = this.components.get(Hider);

    await this.setupIfc();
    await this.setupFragments();

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
    this.stats.dom.style.position = "fixed";
    this.stats.dom.style.right = "10px";
    this.stats.dom.style.bottom = "10px";
    this.stats.dom.style.left = "auto";
    this.stats.dom.style.top = "auto";
    this.stats.dom.style.zIndex = "20";
    document.body.append(this.stats.dom);

    const scene = (this.world.scene as SimpleScene).three;
    this.clashVisualizer = new ClashVisualizer(scene);

    this.world.renderer?.onBeforeUpdate.add(() => {
      this.stats.begin();
      this.clashVisualizer.updateAnimations(Date.now());
    });
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

  private assertValidModelId(modelId: string) {
    if (!this.fragments.list.has(modelId)) {
      // This is the most common source of "Fragments: Model not found".
      // It means a filename or UI label was passed instead of the internal fragment modelId.
      throw new Error(
        `Invalid modelId '${modelId}'. Use the fragments internal id (fragments.list key), not the IFC filename.`
      );
    }
  }

  private async getModelIdMap(modelId: string) {
    this.assertValidModelId(modelId);
    // We already have the internal modelId; return a map keyed by it.
    // The hider/fragments APIs require the internal id.
    const localIdsSet = (await this.classifier.find({ Models: [this.modelNames.get(modelId) ?? modelId] }))[modelId] ?? new Set<number>();
    return { [modelId]: localIdsSet } as Record<string, Set<number>>;
  }

  private async getClassIdMap(modelId: string, className: string) {
    this.assertValidModelId(modelId);
    const result = await this.classifier.find({ Models: [this.modelNames.get(modelId) ?? modelId], "IFC Classes": [className] });
    const localIdsSet = result[modelId] ?? new Set<number>();
    return { [modelId]: localIdsSet } as Record<string, Set<number>>;
  }

  private getModelItemCount(itemsByModel: Record<string, Set<number>>, modelId: string) {
    return itemsByModel[modelId]?.size ?? 0;
  }

  private getValue(raw: any): string | number | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === "object" && raw !== null && "value" in raw) {
      return this.getValue((raw as { value: unknown }).value);
    }
    if (typeof raw === "number" || typeof raw === "string") return raw;
    return String(raw);
  }

  private chunkArray(values: number[], chunkSize = 300): number[][] {
    const chunks: number[][] = [];
    for (let i = 0; i < values.length; i += chunkSize) chunks.push(values.slice(i, i + chunkSize));
    return chunks;
  }

  private categorizeIfcClass(ifcClass: string): string {
    const cls = ifcClass.toLowerCase();
    if (/wall|slab|beam|column|roof|floor|buildingelement/.test(cls)) return "Structure";
    if (/duct|pipe|cable|conduit|cabletray|system|flow|distribution/.test(cls)) return "MEP";
    if (/door|window|furniture|curtain|annotation|covering|site|space/.test(cls)) return "Architecture";
    return "Other";
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

  private async getPropertyGroupIdMap(modelId: string, propertyKey: string, groupName: string) {
    this.assertValidModelId(modelId);
    const modelName = this.modelNames.get(modelId) ?? modelId;
    const result = await this.classifier.find({
      Models: [modelName],
      [this.getPropertyClassificationName(propertyKey)]: [groupName],
    });
    const localIdsSet = result[modelId] ?? new Set<number>();
    return { [modelId]: localIdsSet } as Record<string, Set<number>>;
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

  public async transformModel(
    modelId: string,
    position: THREE.Vector3,
    rotation: THREE.Euler,
    scale: THREE.Vector3
  ) {
    await this.ensureReady();
    this.assertValidModelId(modelId);

    const fragment = this.fragments.list.get(modelId);
    if (!fragment) {
      throw new Error(`Model ${modelId} not found`);
    }

    fragment.object.position.copy(position);
    fragment.object.rotation.copy(rotation);
    fragment.object.scale.copy(scale);

    fragment.object.updateMatrixWorld(true);
    this.fragments.core.update(true);
  }

  public async colorModel(modelId: string, color: string) {
    await this.ensureReady();
    await this.fragments.highlight(
      { color: new Color(color), opacity: 1, transparent: false } as any,
      await this.getModelIdMap(modelId)
    );
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

  private buildModelIdMap(elements: Array<{ modelId: string; localId: number }>) {
    const idsByModel: Record<string, Set<number>> = {};
    for (const el of elements) {
      if (!idsByModel[el.modelId]) idsByModel[el.modelId] = new Set<number>();
      idsByModel[el.modelId].add(el.localId);
    }
    return idsByModel;
  }

  public async isolateElement(modelId: string, localId: number) {
    await this.ensureReady();
    await this.hider.isolate({ [modelId]: new Set([localId]) });
  }

  public async isolateElements(elements: Array<{ modelId: string; localId: number }>) {
    await this.ensureReady();
    const idsByModel = this.buildModelIdMap(elements);
    if (!Object.keys(idsByModel).length) return;
    await this.hider.isolate(idsByModel);
  }

  public async colorElement(modelId: string, localId: number, color: string) {
    await this.ensureReady();
    await this.fragments.highlight(
      { color: new Color(color), opacity: 1, transparent: false } as any,
      { [modelId]: new Set([localId]) }
    );
  }

  public async colorElements(elements: Array<{ modelId: string; localId: number }>, color: string) {
    await this.ensureReady();
    const idsByModel = this.buildModelIdMap(elements);
    if (!Object.keys(idsByModel).length) return;
    await this.fragments.highlight(
      { color: new Color(color), opacity: 1, transparent: false } as any,
      idsByModel
    );
  }

  public async highlightClash(clashId: string, color: string = "#ff0000") {
    // For now just color the two elements referenced by the clashId if possible.
    // clashId format: "<modelId-localId>|<modelId-localId>" (from our clash generator)
    await this.ensureReady();
    const parts = clashId.split("|");
    if (parts.length !== 2) return;

    const parse = (s: string): { modelId: string; localId: number } | null => {
      // expected "<modelId>-<localId>"
      const lastDash = s.lastIndexOf("-");
      if (lastDash === -1) return null;
      const mid = s.slice(0, lastDash);
      const lid = Number(s.slice(lastDash + 1));
      if (!Number.isFinite(lid)) return null;
      return { modelId: mid, localId: lid };
    };

    const a = parse(parts[0]);
    const b = parse(parts[1]);
    if (a) await this.colorElement(a.modelId, a.localId, color);
    if (b) await this.colorElement(b.modelId, b.localId, color);
  }

  public async clearClashHighlights() {
    await this.ensureReady();
    await this.showAll();
    await this.fragments.resetHighlight();
  }

  public async isolateClashingObjects(clashingIds: Set<string>) {
    await this.ensureReady();
    // incoming ids are `${modelId}|${guid}` from ControlPanel
    // We only support isolation by localId; resolve by scanning model objects.
    const elements: Array<{ modelId: string; localId: number }> = [];
    for (const token of clashingIds) {
      const [modelId, guid] = token.split("|");
      if (!modelId || !guid) continue;
      const objs = await this.getModelObjects(modelId);
      const hit = objs.find(o => o.guid === guid || o.id === guid);
      if (hit) elements.push({ modelId, localId: hit.localId });
    }
    await this.isolateElements(elements);
  }

  public async colorClashingObjects(clashingIds: Set<string>, color: string) {
    await this.ensureReady();
    const elements: Array<{ modelId: string; localId: number }> = [];
    for (const token of clashingIds) {
      const [modelId, guid] = token.split("|");
      if (!modelId || !guid) continue;
      const objs = await this.getModelObjects(modelId);
      const hit = objs.find(o => o.guid === guid || o.id === guid);
      if (hit) elements.push({ modelId, localId: hit.localId });
    }
    await this.colorElements(elements, color);
  }

  public async runCompliance(_definition: ComplianceDefinition): Promise<ComplianceRunResult> {
    // Minimal placeholder implementation to satisfy UI/IDE.
    // TODO: reintroduce full compliance engine if needed.
    await this.ensureReady();
    return {
      runAt: new Date().toISOString(),
      checkedElements: 0,
      compliantElements: 0,
      nonCompliantElements: 0,
      modelStats: [],
      ruleStats: [],
      issues: [],
    };
  }

  public async highlightComplianceIssues(_issues: ComplianceIssue[]) {
    // no-op placeholder
    await this.ensureReady();
  }

  public async resetColors() {
    await this.ensureReady();
    await this.fragments.resetHighlight();
  }

  public async showAll() {
    await this.ensureReady();
    await this.hider.set(true);
  }

  private clashCache: ClashCacheEntry = { models: [], objectCounts: new Map() };

  private filtersEqual(a?: ClashFilterOptions, b?: ClashFilterOptions): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    const keys: Array<keyof ClashFilterOptions> = [
      "selectedModels",
      "selectedClasses",
      "ignoreSameCategory",
      "categories",
      "propertyFilter",
      "selectedObjects",
    ];
    for (const k of keys) {
      const va = (a as any)[k];
      const vb = (b as any)[k];
      if (k === "propertyFilter") {
        if (va?.key !== vb?.key || va?.value !== vb?.value) return false;
      } else if (k === "selectedObjects") {
        if (va && vb) {
          if (va.size !== vb.size) return false;
          for (const [mid, setA] of va) {
            const setB = vb.get(mid);
            if (!setB || setA.size !== setB.size) return false;
            for (const id of setA) if (!setB.has(id)) return false;
          }
        } else if (va || vb) {
          return false;
        }
      } else if (va instanceof Set && vb instanceof Set) {
        if (va.size !== vb.size) return false;
        for (const v of va) if (!vb.has(v)) return false;
      } else if (va !== vb) {
        return false;
      }
    }
    return true;
  }

  public async runClashDetection(
    tolerance: number = 0.1,
    clearance: number = 0.5,
    filters?: ClashFilterOptions
  ): Promise<ClashRunResult> {
    await this.ensureReady();

    const models = Array.from(this.fragments.list.keys());
    if (models.length < 2) {
      return {
        runAt: new Date().toISOString(),
        hardClashes: 0,
        softClashes: 0,
        clearanceClashes: 0,
        totalClashes: 0,
        clashes: [],
      };
    }

    let filteredModels = models;

    const wantResume = filters?.resume;
    const cache = this.clashCache;
    const sameModelSet = cache.models.length === models.length && cache.models.every((m) => models.includes(m));
    const countsUnchanged = models.every((mid) => {
      const prev = cache.objectCounts.get(mid) || 0;
      return prev === (filters && filters.selectedObjects ? filters.selectedObjects.get(mid)?.size ?? 0 : 0);
    });

    if (
      wantResume &&
      sameModelSet &&
      countsUnchanged &&
      cache.result &&
      cache.tolerance === tolerance &&
      cache.clearance === clearance &&
      this.filtersEqual(filters, cache.filters)
    ) {
      return cache.result;
    }

    if (filters?.selectedModels && filters.selectedModels.size > 0) {
      filteredModels = models.filter((modelId) => filters.selectedModels!.has(modelId));
    }

    const allObjects: Array<{ modelId: string; modelName: string; object: ModelObject; bbox?: THREE.Box3 }> = [];
    const skippedPerModel: Record<string, number> = {};

    for (const modelId of filteredModels) {
      const modelName = this.modelNames.get(modelId) || modelId;

      let objectsToCheck: ModelObject[] = [];
      if (filters?.selectedObjects?.has(modelId) && filters.selectedObjects.get(modelId)!.size > 0) {
        const selectedIds = filters.selectedObjects.get(modelId)!;
        const allModelObjects = await this.getModelObjects(modelId);
        objectsToCheck = allModelObjects.filter((obj) => selectedIds.has(obj.id));
      } else {
        objectsToCheck = await this.getModelObjects(modelId);
      }

      if (filters?.selectedClasses && filters.selectedClasses.size > 0) {
        objectsToCheck = objectsToCheck.filter((obj) => filters.selectedClasses!.has(obj.ifcClass));
      }

      if (filters?.propertyFilter) {
        objectsToCheck = objectsToCheck.filter((obj) => {
          const value = obj.properties[filters.propertyFilter!.key];
          return value && value.toString().toLowerCase().includes(filters.propertyFilter!.value.toLowerCase());
        });
      }

      let skipped = 0;
      for (const obj of objectsToCheck) {
        if (obj.bbox) {
          allObjects.push({ modelId, modelName, object: obj, bbox: obj.bbox });
        } else {
          skipped++;
        }
      }

      if (skipped > 0) skippedPerModel[modelId] = skipped;
      cache.objectCounts.set(modelId, objectsToCheck.length);
    }

    // If we have too few AABBs, return early.
    if (allObjects.length < 2) {
      return {
        runAt: new Date().toISOString(),
        hardClashes: 0,
        softClashes: 0,
        clearanceClashes: 0,
        totalClashes: 0,
        clashes: [],
        skipped: Object.keys(skippedPerModel).length ? skippedPerModel : undefined,
        originalObjects: allObjects.length,
        uniqueBoxes: allObjects.length,
      };
    }

    // simple dedupe by bbox
    const duplicates = new Map<string, typeof allObjects[0][]>();
    for (const obj of allObjects) {
      const b = obj.bbox!;
      const key = `${obj.modelId}|${b.min.toArray().join(",")}|${b.max.toArray().join(",")}`;
      const group = duplicates.get(key) ?? [];
      group.push(obj);
      duplicates.set(key, group);
    }

    const dedupedObjects: Array<typeof allObjects[0] & { bboxKey: string }> = [];
    for (const [key, group] of duplicates) {
      const first = group[0] as any;
      first.bboxKey = key;
      dedupedObjects.push(first);
    }

    const clashes: ClashResult[] = [];
    const checked = new Set<string>();

    // BVH (very simple recursive split)
    interface BVHNode {
      bbox: THREE.Box3;
      left?: BVHNode;
      right?: BVHNode;
      objs?: typeof dedupedObjects;
    }

    const buildBVH = (objs: typeof dedupedObjects): BVHNode => {
      const node: BVHNode = { bbox: new THREE.Box3() };
      for (const o of objs) node.bbox.union(o.bbox!);
      if (objs.length <= 4) {
        node.objs = objs;
        return node;
      }
      const size = node.bbox.getSize(new THREE.Vector3());
      let axis: "x" | "y" | "z" = "x";
      if (size.y > size.x && size.y >= size.z) axis = "y";
      else if (size.z > size.x && size.z > size.y) axis = "z";

      objs.sort(
        (a, b) => a.bbox!.getCenter(new THREE.Vector3())[axis] - b.bbox!.getCenter(new THREE.Vector3())[axis]
      );
      const mid = Math.floor(objs.length / 2);
      node.left = buildBVH(objs.slice(0, mid) as any);
      node.right = buildBVH(objs.slice(mid) as any);
      return node;
    };

    const byModel = new Map<string, typeof dedupedObjects>();
    for (const o of dedupedObjects) {
      const list = byModel.get(o.modelId) ?? [];
      list.push(o);
      byModel.set(o.modelId, list);
    }

    const bvhMap = new Map<string, BVHNode>();
    for (const [mid, objs] of byModel) {
      bvhMap.set(mid, buildBVH(objs));
    }

    const candidatePairs: Array<[typeof dedupedObjects[0], typeof dedupedObjects[0]]> = [];

    const traversePairs = (nodeA: BVHNode, nodeB: BVHNode) => {
      if (!nodeA.bbox.intersectsBox(nodeB.bbox)) return;
      if (nodeA.objs && nodeB.objs) {
        for (const a of nodeA.objs) for (const b of nodeB.objs) candidatePairs.push([a, b]);
        return;
      }
      if (nodeA.objs) {
        if (nodeB.left) traversePairs(nodeA, nodeB.left);
        if (nodeB.right) traversePairs(nodeA, nodeB.right);
        return;
      }
      if (nodeB.objs) {
        if (nodeA.left) traversePairs(nodeA.left, nodeB);
        if (nodeA.right) traversePairs(nodeA.right, nodeB);
        return;
      }
      if (nodeA.left && nodeB.left) traversePairs(nodeA.left, nodeB.left);
      if (nodeA.left && nodeB.right) traversePairs(nodeA.left, nodeB.right);
      if (nodeA.right && nodeB.left) traversePairs(nodeA.right, nodeB.left);
      if (nodeA.right && nodeB.right) traversePairs(nodeA.right, nodeB.right);
    };

    const mids = [...bvhMap.keys()].sort();
    for (let i = 0; i < mids.length; i++) {
      for (let j = i + 1; j < mids.length; j++) {
        traversePairs(bvhMap.get(mids[i])!, bvhMap.get(mids[j])!);
      }
    }

    const boxDistance = (a: THREE.Box3, b: THREE.Box3) => {
      if (a.intersectsBox(b)) return 0;
      let dx = 0,
        dy = 0,
        dz = 0;
      if (a.max.x < b.min.x) dx = b.min.x - a.max.x;
      else if (b.max.x < a.min.x) dx = a.min.x - b.max.x;
      if (a.max.y < b.min.y) dy = b.min.y - a.max.y;
      else if (b.max.y < a.min.y) dy = a.min.y - b.max.y;
      if (a.max.z < b.min.z) dz = b.min.z - a.max.z;
      else if (b.max.z < a.min.z) dz = a.min.z - b.max.z;
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };

    for (const [objA, objB] of candidatePairs) {
      if (!objA.bbox || !objB.bbox) continue;

      const d = boxDistance(objA.bbox, objB.bbox);
      if (d > clearance) continue;

      let type: ClashType;
      if (d === 0) type = "hard";
      else if (d <= tolerance) type = "soft";
      else type = "clearance";

      const groupA = duplicates.get((objA as any).bboxKey) ?? [objA];
      const groupB = duplicates.get((objB as any).bboxKey) ?? [objB];

      const posA = objA.bbox.getCenter(new THREE.Vector3());
      const posB = objB.bbox.getCenter(new THREE.Vector3());
      const mid = posA.lerp(posB, 0.5);

      for (const aObj of groupA) {
        for (const bObj of groupB) {
          const k = [aObj.object.id, bObj.object.id].sort().join("-");
          if (checked.has(k)) continue;
          checked.add(k);
          clashes.push({
            id: `${aObj.object.id}|${bObj.object.id}`,
            type,
            a: {
              modelId: aObj.modelId,
              modelName: aObj.modelName,
              guid: aObj.object.guid,
              ifcClass: aObj.object.ifcClass,
              category: aObj.object.category,
            },
            b: {
              modelId: bObj.modelId,
              modelName: bObj.modelName,
              guid: bObj.object.guid,
              ifcClass: bObj.object.ifcClass,
              category: bObj.object.category,
            },
            collision: {
              position: [mid.x, mid.y, mid.z],
              normal: [0, 0, 1],
            },
          });
        }
      }
    }

    const result: ClashRunResult = {
      runAt: new Date().toISOString(),
      hardClashes: clashes.filter((c) => c.type === "hard").length,
      softClashes: clashes.filter((c) => c.type === "soft").length,
      clearanceClashes: clashes.filter((c) => c.type === "clearance").length,
      totalClashes: clashes.length,
      clashes,
      skipped: Object.keys(skippedPerModel).length ? skippedPerModel : undefined,
      originalObjects: allObjects.length,
      uniqueBoxes: dedupedObjects.length,
    };

    cache.models = models.slice();
    cache.filters = filters;
    cache.tolerance = tolerance;
    cache.clearance = clearance;
    cache.result = result;

    return result;
  }

  public visualizeClashes(result: ClashRunResult): void {
    this.clashVisualizer?.visualizeClashes(result.clashes);
  }

  public clearClashVisualizations(): void {
    this.clashVisualizer?.clearAllVisualizations();
  }

  // Strategy A implementation: compute per-element AABBs from fragment item mapping
  public async getModelObjects(modelId: string): Promise<ModelObject[]> {
    await this.ensureReady();

    const modelName = this.modelNames.get(modelId) || modelId;

    let model: any = this.fragments.list.get(modelId);
    if (!model) {
      for (const [key, frag] of this.fragments.list) {
        if (key === modelId || frag.object.name === modelName) {
          model = frag;
          break;
        }
      }
    }
    if (!model) {
      console.warn(`getModelObjects: model ${modelName} (${modelId}) not found`);
      return [];
    }

    const idsByModel = await this.getModelIdMap(modelId);
    const localIds = [...(idsByModel[modelId] ?? new Set<number>())];
    if (localIds.length === 0) return [];

    // Build bbox map by traversing instanced meshes and reading instance->localId attribute
    const sceneObject = model.object as THREE.Object3D;
    sceneObject.updateMatrixWorld(true);

    const bboxByLocalId = new Map<number, THREE.Box3>();
    const tmpMat = new THREE.Matrix4();
    const tmpBox = new THREE.Box3();

    let loggedInstanceAttrs = false;

    const pickInstanceIdAttribute = (geom: THREE.BufferGeometry, inst: THREE.InstancedMesh): THREE.BufferAttribute | null => {
      const anyGeom = geom as any;

      const tryNames = [
        "expressID",
        "expressId",
        "itemID",
        "itemId",
        "instanceID",
        "instanceId",
        "ids",
        "id",
        "localId",
        "localID",
      ];

      for (const name of tryNames) {
        const attr = (anyGeom.getAttribute?.(name) ?? anyGeom.attributes?.[name]) as THREE.BufferAttribute | undefined;
        if (attr && typeof (attr as any).getX === "function") return attr;
      }

      const attrs = geom.attributes as Record<string, THREE.BufferAttribute>;
      const instCount = inst.count ?? 0;

      // Heuristic: pick a scalar numeric attribute whose count matches instance count.
      // Fragment instancing typically stores one id per instance.
      for (const [name, attr] of Object.entries(attrs)) {
        if (!attr) continue;
        if (name === "position" || name === "normal" || name === "uv" || name === "color") continue;
        if (attr.itemSize !== 1) continue;
        if (instCount > 0 && attr.count !== instCount) continue;
        if (typeof (attr as any).getX !== "function") continue;

        // basic sanity check: first value should be finite
        const v0 = Number((attr as any).getX(0));
        if (!Number.isFinite(v0)) continue;
        return attr;
      }

      return null;
    };

    sceneObject.traverse((child) => {
      const inst = child as unknown as THREE.InstancedMesh;
      if (!(inst as any).isInstancedMesh) return;

      const geom = inst.geometry as THREE.BufferGeometry;
      if (!geom) return;

      if (!geom.boundingBox) geom.computeBoundingBox();
      if (!geom.boundingBox) return;

      const idAttr = pickInstanceIdAttribute(geom, inst);

      if (!loggedInstanceAttrs) {
        loggedInstanceAttrs = true;
        const attrNames = Object.keys((geom as any).attributes ?? {});
        console.info("[getModelObjects] Instanced geometry attributes:", attrNames);
        console.info(
          "[getModelObjects] Picked id attribute:",
          idAttr ? (Object.entries(geom.attributes).find(([, a]) => a === idAttr)?.[0] ?? "<unknown>") : "<none>",
          "inst.count=", inst.count
        );
      }

      if (!idAttr || typeof (idAttr as any).getX !== "function") return;

      const count = inst.count ?? idAttr.count;
      for (let i = 0; i < count; i++) {
        const localId = Number((idAttr as any).getX(i));
        if (!Number.isFinite(localId) || localId < 0) continue;

        inst.getMatrixAt(i, tmpMat);
        tmpMat.premultiply(inst.matrixWorld);

        tmpBox.copy(geom.boundingBox);
        tmpBox.applyMatrix4(tmpMat);

        const existing = bboxByLocalId.get(localId);
        if (existing) existing.union(tmpBox);
        else bboxByLocalId.set(localId, tmpBox.clone());
      }
    });

    const objects: ModelObject[] = [];

    for (const chunk of this.chunkArray(localIds)) {
      let itemsData: any[] = [];
      try {
        itemsData = await model.getItemsData(chunk);
      } catch (e) {
        console.warn("getModelObjects: failed to fetch item data for chunk", e);
        continue;
      }

      for (const item of itemsData as Array<Record<string, any>>) {
        const rawLocalId = this.getValue(item._localId);
        const localId = Number(rawLocalId);
        if (Number.isNaN(localId)) continue;

        const ifcClass = String(
          this.getValue(item.EntityName) ?? this.getValue(item.ifcClass) ?? this.getValue(item._type) ?? "Unknown"
        );

        const guid = String(this.getValue(item.GlobalId) ?? this.getValue(item.guid) ?? `LOCAL_${localId}`);

        const properties: Record<string, any> = {};
        const commonProps = ["Name", "Description", "ObjectType", "PredefinedType", "Tag"];
        for (const prop of commonProps) {
          const value = this.getValue(item[prop]);
          if (value !== undefined && value !== null && value !== "") properties[prop] = value;
        }
        for (const [key, value] of Object.entries(item)) {
          if (
            !key.startsWith("_") &&
            !key.startsWith("$") &&
            !["EntityName", "ifcClass", "_type", "GlobalId", "guid", "_localId"].includes(key)
          ) {
            const v = this.getValue(value);
            if (v !== undefined && v !== null && v !== "") properties[key] = v;
          }
        }

        const bbox = bboxByLocalId.get(localId);

        objects.push({
          id: `${modelId}-${localId}`,
          guid,
          ifcClass,
          localId,
          properties,
          category: this.categorizeIfcClass(ifcClass),
          ...(bbox ? { bbox: bbox.clone() } : {}),
        });
      }
    }

    return objects;
  }
}
