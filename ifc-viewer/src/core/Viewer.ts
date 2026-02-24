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

export type RuleOperator = "exists" | "notEmpty" | "equals" | "notEquals" | "in" | "regex" | "gt" | "gte" | "lt" | "lte";

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

  private getValue(raw: any): string | number | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw === "object" && raw !== null && "value" in raw) {
      return this.getValue((raw as { value: unknown }).value);
    }
    if (typeof raw === "number" || typeof raw === "string") return raw;
    return String(raw);
  }

  private getItemPropertyRaw(item: Record<string, any>, propertyName: string): any {
    if (propertyName in item) return item[propertyName];

    const normalized = propertyName.trim().toLowerCase();
    const normalizedWithoutUnderscore = normalized.startsWith("_") ? normalized.slice(1) : normalized;
    let aliases: string[] = [];

    if (normalizedWithoutUnderscore === "guid" || normalizedWithoutUnderscore === "globalid") {
      aliases = ["GlobalId", "globalId", "GUID"];
    } else if (normalizedWithoutUnderscore === "ifcclass" || normalizedWithoutUnderscore === "classname") {
      aliases = ["EntityName", "entityName", "Class"];
    } else if (normalizedWithoutUnderscore === "class") {
      aliases = ["EntityName", "entityName", "ifcClass"];
    }

    for (const alias of aliases) {
      if (alias in item) return item[alias];
    }

    for (const [key, value] of Object.entries(item)) {
      if (key.toLowerCase() === normalized) return value;
      if (key.toLowerCase() === normalizedWithoutUnderscore) return value;
    }

    return undefined;
  }

  private getItemIfcClass(item: Record<string, any>): string {
    const rawClass = this.getItemPropertyRaw(item, "ifcClass");
    return String(this.getValue(rawClass) ?? "").trim().toUpperCase();
  }

  private normalizeIfcClassName(value: string): string {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return "";
    return normalized.startsWith("IFC") ? normalized : `IFC${normalized}`;
  }

  private isRuleTargetClassMatch(item: Record<string, any>, targetIfcClass?: string): boolean {
    if (!targetIfcClass) return true;
    const elementClass = this.getItemIfcClass(item);
    if (!elementClass) return false;

    const target = this.normalizeIfcClassName(targetIfcClass);
    return elementClass === target;
  }

  private evaluateCondition(item: Record<string, any>, condition: ComplianceCondition): boolean {
    const rawValue = this.getValue(this.getItemPropertyRaw(item, condition.property));

    switch (condition.operator) {
      case "exists":
      case "notEmpty":
        return rawValue !== null && String(rawValue).trim().length > 0;
      case "equals":
        return String(rawValue ?? "") === String(condition.value ?? "");
      case "notEquals":
        return String(rawValue ?? "") !== String(condition.value ?? "");
      case "in": {
        if (!Array.isArray(condition.value)) return false;
        const candidate = String(rawValue ?? "");
        return condition.value.map((v) => String(v)).includes(candidate);
      }
      case "regex": {
        const pattern = String(condition.value ?? "");
        if (!pattern) return false;
        return new RegExp(pattern).test(String(rawValue ?? ""));
      }
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        const left = Number(rawValue);
        const right = Number(condition.value);
        if (Number.isNaN(left) || Number.isNaN(right)) return false;
        if (condition.operator === "gt") return left > right;
        if (condition.operator === "gte") return left >= right;
        if (condition.operator === "lt") return left < right;
        return left <= right;
      }
      default:
        return false;
    }
  }

  private chunkArray(values: number[], chunkSize = 300): number[][] {
    const chunks: number[][] = [];
    for (let i = 0; i < values.length; i += chunkSize) chunks.push(values.slice(i, i + chunkSize));
    return chunks;
  }

  private flattenItemProperties(item: Record<string, any>): Record<string, string> {
    const flattened: Record<string, string> = {};

    for (const [key, value] of Object.entries(item)) {
      if (key.startsWith("__")) continue;
      const normalized = this.getValue(value);
      if (normalized === null) continue;
      flattened[key] = typeof normalized === "string" ? normalized : String(normalized);
    }

    return flattened;
  }

  public async runCompliance(definition: ComplianceDefinition): Promise<ComplianceRunResult> {
    await this.ensureReady();
    await this.refreshClassifications();

    const issues: ComplianceIssue[] = [];
    const checkedByElement = new Set<string>();
    const nonCompliantByElement = new Set<string>();
    const modelStats = new Map<string, { modelName: string; checked: number; nonCompliant: number }>();
    const ruleStats = new Map<string, { ruleName: string; checked: number; failed: number }>();

    for (const rule of definition.rules) {
      ruleStats.set(rule.id, { ruleName: rule.name, checked: 0, failed: 0 });

      const targetClass = rule.target?.ifcClass ? this.normalizeIfcClassName(rule.target.ifcClass) : undefined;

      for (const modelId of this.fragments.list.keys()) {
        if (rule.target?.modelId && rule.target.modelId !== modelId) continue;

        const idsByModel = targetClass
          ? await this.getClassIdMap(modelId, targetClass)
          : await this.getModelIdMap(modelId);

        const localIdsSet = idsByModel[modelId] ?? new Set<number>();
        const model = this.fragments.list.get(modelId);
        if (!model) continue;

        const localIds = [...localIdsSet];
        for (const chunk of this.chunkArray(localIds)) {
          const itemsData = await model.getItemsData(chunk);
          for (const item of itemsData as Array<Record<string, any>>) {
            const rawLocalId = this.getValue(item._localId);
            const localId = Number(rawLocalId);
            if (Number.isNaN(localId)) continue;

            if (!targetClass && !this.isRuleTargetClassMatch(item, rule.target?.ifcClass)) continue;

            const elementKey = `${modelId}:${localId}`;
            checkedByElement.add(elementKey);

            const failingChecks = rule.checks
              .filter((check) => !this.evaluateCondition(item, check))
              .map((check) => `${check.property} ${check.operator}${check.value !== undefined ? ` ${JSON.stringify(check.value)}` : ""}`);

            const currentRuleStats = ruleStats.get(rule.id);
            if (currentRuleStats) currentRuleStats.checked += 1;

            if (failingChecks.length) {
              nonCompliantByElement.add(elementKey);
              const modelName = this.modelNames.get(modelId) ?? modelId;
              issues.push({
                ruleId: rule.id,
                ruleName: rule.name,
                modelId,
                modelName,
                localId,
                ifcClass: String(this.getValue(item.EntityName) ?? this.getValue(item.ifcClass) ?? rule.target?.ifcClass ?? ""),
                failedChecks: failingChecks,
                elementProperties: this.flattenItemProperties(item),
              });

              const modelStat = modelStats.get(modelId) ?? { modelName, checked: 0, nonCompliant: 0 };
              modelStat.nonCompliant += 1;
              modelStats.set(modelId, modelStat);

              if (currentRuleStats) currentRuleStats.failed += 1;
            }

            const modelName = this.modelNames.get(modelId) ?? modelId;
            const modelStat = modelStats.get(modelId) ?? { modelName, checked: 0, nonCompliant: 0 };
            modelStat.checked += 1;
            modelStats.set(modelId, modelStat);
          }
        }
      }
    }

    return {
      runAt: new Date().toISOString(),
      checkedElements: checkedByElement.size,
      compliantElements: checkedByElement.size - nonCompliantByElement.size,
      nonCompliantElements: nonCompliantByElement.size,
      modelStats: [...modelStats.entries()].map(([modelId, info]) => ({ modelId, ...info })),
      ruleStats: [...ruleStats.entries()].map(([ruleId, info]) => ({ ruleId, ...info })),
      issues,
    };
  }

  public async highlightComplianceIssues(issues: ComplianceIssue[]) {
    await this.ensureReady();
    const idsByModel: Record<string, Set<number>> = {};
    for (const issue of issues) {
      if (!idsByModel[issue.modelId]) idsByModel[issue.modelId] = new Set<number>();
      idsByModel[issue.modelId].add(issue.localId);
    }

    await this.fragments.highlight({ color: new Color("#d11a2a"), opacity: 1, transparent: false } as any, idsByModel);
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

  public async isolateElement(modelId: string, localId: number) {
    await this.ensureReady();
    await this.hider.isolate({ [modelId]: new Set([localId]) });
  }

  private buildModelIdMap(elements: Array<{ modelId: string; localId: number }>) {
    const idsByModel: Record<string, Set<number>> = {};
    for (const element of elements) {
      if (!idsByModel[element.modelId]) idsByModel[element.modelId] = new Set<number>();
      idsByModel[element.modelId].add(element.localId);
    }
    return idsByModel;
  }

  public async isolateElements(elements: Array<{ modelId: string; localId: number }>) {
    await this.ensureReady();
    const idsByModel = this.buildModelIdMap(elements);
    if (!Object.keys(idsByModel).length) return;
    await this.hider.isolate(idsByModel);
  }

  public async colorElement(modelId: string, localId: number, color: string) {
    await this.ensureReady();
    await this.fragments.highlight({ color: new Color(color), opacity: 1, transparent: false } as any, {
      [modelId]: new Set([localId]),
    });
  }

  public async colorElements(elements: Array<{ modelId: string; localId: number }>, color: string) {
    await this.ensureReady();
    const idsByModel = this.buildModelIdMap(elements);
    if (!Object.keys(idsByModel).length) return;
    await this.fragments.highlight({ color: new Color(color), opacity: 1, transparent: false } as any, idsByModel);
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
