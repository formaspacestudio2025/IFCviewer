import React, { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { ClashFilterOptions, ClashRunResult, ComplianceDefinition, ComplianceRunResult, ModelObject, ModelOverview, Viewer } from "../core/Viewer";

interface Props {
  viewer: Viewer;
}

type PanelTab = "upload" | "models" | "properties" | "quality" | "clash" | "copilot";

const randomColor = () => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`;

type TargetKind = "model" | "class" | "propertyGroup";

type TargetState = {
  hidden?: boolean;
  isolated?: boolean;
  color?: string;
};

const makeTargetKey = (kind: TargetKind, parts: string[]) => `${kind}:${parts.join("|")}`;

const mergeTargetState = (
  map: Map<string, TargetState>,
  key: string,
  patch: Partial<TargetState>
) => {
  const next = new Map(map);
  const current = next.get(key) ?? {};
  next.set(key, { ...current, ...patch });
  return next;
};

const actionButtonStyle = (active?: boolean, color?: string): React.CSSProperties => {
  const base: React.CSSProperties = {
    border: "1px solid #cbd4f1",
    borderRadius: 6,
    padding: "6px 8px",
    cursor: "pointer",
  };

  if (color) {
    return {
      ...base,
      background: color,
      color: "#fff",
      border: "1px solid rgba(0,0,0,0.15)",
    };
  }

  if (active) {
    return {
      ...base,
      background: "#e8edff",
      fontWeight: 700,
    };
  }

  return {
    ...base,
    background: "#fff",
  };
};

const defaultRuleExample = {
  project: "Example BEP",
  version: "1.0",
  rules: [
    {
      id: "wall-fire-rating",
      name: "Walls must define FireRating",
      target: { ifcClass: "IFCWALL" },
      checks: [{ property: "FireRating", operator: "exists" }],
    },
  ],
};

export const ControlPanel: React.FC<Props> = ({ viewer }) => {
  const [activeTab, setActiveTab] = useState<PanelTab>("upload");
  const [targetStates, setTargetStates] = useState<Map<string, TargetState>>(new Map());
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<Record<string, any> | null>(null);
  const [models, setModels] = useState<ModelOverview[]>([]);
  const [propertyKey, setPropertyKey] = useState("PredefinedType");
  const [loading, setLoading] = useState(false);
  const [bepRules, setBepRules] = useState<ComplianceDefinition | null>(null);
  const [complianceResult, setComplianceResult] = useState<ComplianceRunResult | null>(null);
  const [qcBusy, setQcBusy] = useState(false);
  const [nonComplianceColor, setNonComplianceColor] = useState("#d11a2a");
  const [clashResult, setClashResult] = useState<ClashRunResult | null>(null);
  const [clashTolerance, setClashTolerance] = useState(0.1);
  const [clashClearance, setClashClearance] = useState(0.5);
  const [clashBusy, setClashBusy] = useState(false);
  const [clashSelectedModels, setClashSelectedModels] = useState<Set<string>>(new Set());
  const [clashSelectedClasses, setClashSelectedClasses] = useState<Set<string>>(new Set());
  const [clashSelectedCategories, setClashSelectedCategories] = useState<Set<string>>(new Set());
  const [clashPropertyFilter, setClashPropertyFilter] = useState<string | undefined>();
  const [clashPropertyValue, setClashPropertyValue] = useState("");
  const [clashIgnoreSameCategory, setClashIgnoreSameCategory] = useState(false);
  const [clashColor, setClashColor] = useState("#ff0000");
  const [savedViewports, setSavedViewports] = useState<Array<{name: string, camera: any}>>([]);
  const [clashObjectSelection, setClashObjectSelection] = useState<Map<string, Set<string>>>(new Map());
  const [modelObjects, setModelObjects] = useState<Map<string, ModelObject[]>>(new Map());

  // Derived state for filtering options
  const allAvailableClasses = useMemo(() => {
    const classes = new Set<string>();
    modelObjects.forEach(objects => {
      objects.forEach(obj => classes.add(obj.ifcClass));
    });
    return classes;
  }, [modelObjects]);

  const allAvailableCategories = useMemo(() => {
    const cats = new Set<string>();
    modelObjects.forEach(objects => {
      objects.forEach(obj => {
        if (obj.category) cats.add(obj.category);
      });
    });
    return cats;
  }, [modelObjects]);

  const allAvailableProperties = useMemo(() => {
    const properties = new Set<string>();
    modelObjects.forEach(objects => {
      objects.forEach(obj => {
        Object.keys(obj.properties).forEach(prop => properties.add(prop));
      });
    });
    return properties;
  }, [modelObjects]);

  const [showObjectSelection, setShowObjectSelection] = useState(false);
  const [selectedModelForObjects, setSelectedModelForObjects] = useState<string>("");
  const [objectSearchQuery, setObjectSearchQuery] = useState("");
  const [objectClassFilter, setObjectClassFilter] = useState("");
  const [copilotQuery, setCopilotQuery] = useState("");
  const [copilotApiKey, setCopilotApiKey] = useState(() => localStorage.getItem("openai_api_key") ?? "");
  const [copilotModel, setCopilotModel] = useState("gpt-4.1-mini");
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotMessages, setCopilotMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([
    { role: "assistant", text: "Hi! I can help with compliance insights. Ask: Is this model compliant? What should I fix first? Explain this violation. Summarize structural discipline issues." },
  ]);
  const [modelTransformations, setModelTransformations] = useState<Map<string, {position: THREE.Vector3, rotation: THREE.Euler, scale: THREE.Vector3}>>(new Map());

  const refreshModels = async () => {
    setLoading(true);
    try {
      const data = await viewer.getModelsOverview(propertyKey);
      setModels(data);
    } finally {
      setLoading(false);
    }
  };

  const resetAllTargetStates = () => setTargetStates(new Map());

  const updateModelTransformation = (modelId: string, type: 'position' | 'rotation' | 'scale', axis: 'x' | 'y' | 'z', value: number) => {
    setModelTransformations(prev => {
      const newMap = new Map(prev);
      const current = newMap.get(modelId) || {
        position: new THREE.Vector3(0, 0, 0),
        rotation: new THREE.Euler(0, 0, 0),
        scale: new THREE.Vector3(1, 1, 1)
      };
      
      if (type === 'position') {
        current.position[axis] = value;
      } else if (type === 'rotation') {
        current.rotation[axis] = value * Math.PI / 180; // Convert degrees to radians
      } else if (type === 'scale') {
        current.scale[axis] = value;
      }
      
      newMap.set(modelId, current);
      return newMap;
    });
  };

  const applyModelTransformation = (modelId: string) => {
    const transform = modelTransformations.get(modelId);
    if (transform) {
      viewer.transformModel(modelId, transform.position, transform.rotation, transform.scale);
    }
  };

  const resetModelTransformation = (modelId: string) => {
    const defaultTransform = {
      position: new THREE.Vector3(0, 0, 0),
      rotation: new THREE.Euler(0, 0, 0),
      scale: new THREE.Vector3(1, 1, 1)
    };
    setModelTransformations(prev => {
      const newMap = new Map(prev);
      newMap.set(modelId, defaultTransform);
      return newMap;
    });
    viewer.transformModel(modelId, defaultTransform.position, defaultTransform.rotation, defaultTransform.scale);
  };

  useEffect(() => {
    viewer.onSelectObject = (items: any) => {
      const itemsArray = Array.isArray(items) ? items : Object.values(items || {});
      const firstItem = itemsArray[0] as Record<string, any> | undefined;
      setSelectedItem(firstItem ?? null);
    };

    viewer.onModelsChanged = () => {
      void refreshModels();
    };

    void refreshModels();

    return () => {
      viewer.onSelectObject = undefined;
      viewer.onModelsChanged = undefined;
    };
  }, [viewer, propertyKey]);


  useEffect(() => {
    if (copilotApiKey.trim()) localStorage.setItem("openai_api_key", copilotApiKey.trim());
    else localStorage.removeItem("openai_api_key");
  }, [copilotApiKey]);

  const flattenedRows = useMemo(() => {
    if (!selectedItem) return [] as Array<{ key: string; value: string }>;

    const rows: Array<{ key: string; value: string }> = [];
    for (const [key, rawValue] of Object.entries(selectedItem)) {
      if (searchQuery && !key.toLowerCase().includes(searchQuery.toLowerCase())) continue;

      let normalized: unknown = rawValue;
      if (rawValue && typeof rawValue === "object" && "value" in (rawValue as object)) {
        normalized = (rawValue as { value: unknown }).value;
      }

      const value =
        typeof normalized === "object"
          ? JSON.stringify(normalized, null, expanded ? 2 : 0)
          : String(normalized ?? "");

      rows.push({ key, value });
    }

    return rows;
  }, [expanded, searchQuery, selectedItem]);

  const groupedIssues = useMemo(() => {
    const groups = new Map<string, ComplianceRunResult["issues"]>();
    for (const issue of complianceResult?.issues ?? []) {
      const key = issue.ifcClass?.trim() || "UNCLASSIFIED";
      const group = groups.get(key) ?? [];
      group.push(issue);
      groups.set(key, group);
    }

    return [...groups.entries()]
      .map(([ifcClass, issues]) => ({ ifcClass, issues }))
      .sort((a, b) => b.issues.length - a.issues.length);
  }, [complianceResult]);

  const toElementRefs = (issues: ComplianceRunResult["issues"]) =>
    issues.map((issue) => ({ modelId: issue.modelId, localId: issue.localId }));



  const findIssueForQuery = (query: string) => {
    if (!complianceResult?.issues.length) return null;

    const localIdMatch = query.match(/#?(\d{1,9})/);
    if (localIdMatch) {
      const byId = complianceResult.issues.find((issue) => issue.localId === Number(localIdMatch[1]));
      if (byId) return byId;
    }

    const normalized = query.toLowerCase();
    return complianceResult.issues.find((issue) => {
      return (
        issue.ruleId.toLowerCase().includes(normalized) ||
        issue.ruleName.toLowerCase().includes(normalized) ||
        `${issue.ifcClass ?? ""}`.toLowerCase().includes(normalized)
      );
    });
  };

  const buildCopilotReply = (query: string) => {
    if (!complianceResult) {
      return "Run a compliance check first, then I can analyze issues and prioritize fixes.";
    }

    const q = query.toLowerCase();
    const { checkedElements, nonCompliantElements, compliantElements, issues, ruleStats } = complianceResult;

    if (q.includes("compliant") || q.includes("compliance status")) {
      const percent = checkedElements ? ((compliantElements / checkedElements) * 100).toFixed(1) : "0.0";
      return `Current status: ${compliantElements}/${checkedElements} elements compliant (${percent}%). Non-compliant elements: ${nonCompliantElements}.`;
    }

    if (q.includes("fix first") || q.includes("priority") || q.includes("prioritize")) {
      if (!issues.length) return "Great news: no non-compliant elements found. Nothing to prioritize right now.";
      const topRules = [...ruleStats].sort((a, b) => b.failed - a.failed).filter((r) => r.failed > 0).slice(0, 3);
      const topText = topRules.map((r, i) => `${i + 1}. ${r.ruleName} (${r.failed} failed)`).join("\n");
      return `Fix these first based on failure volume:\n${topText}`;
    }

    if (q.includes("explain") || q.includes("violation")) {
      const issue = findIssueForQuery(query) ?? issues[0];
      if (!issue) return "I could not find a violation because current results have no issues.";
      return [
        `Violation explanation for ${issue.modelName} #${issue.localId}:`,
        `- IFC Class: ${issue.ifcClass ?? "Unknown"}`,
        `- Failed rule: ${issue.ruleName} (${issue.ruleId})`,
        `- Failed checks: ${issue.failedChecks.join("; ")}`,
        "Suggested action: open this element in Properties tab, populate missing/invalid values, and rerun compliance.",
      ].join("\n");
    }

    if (q.includes("structural") || q.includes("discipline")) {
      const structuralClasses = ["IFCBEAM", "IFCCOLUMN", "IFCSLAB", "IFCWALL", "IFCFOOTING", "IFCPILE", "IFCMEMBER", "IFCPLATE", "IFCROOF", "IFCSTAIR"];
      const structuralIssues = issues.filter((issue) => structuralClasses.includes((issue.ifcClass ?? "").toUpperCase()));
      if (!structuralIssues.length) return "No structural-discipline issues detected in the current non-compliance set.";

      const counts = new Map<string, number>();
      for (const issue of structuralIssues) {
        const key = (issue.ifcClass || "UNCLASSIFIED").toUpperCase();
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const lines = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v} issues`);
      return `Structural discipline summary (${structuralIssues.length} issues):\n${lines.join("\n")}`;
    }

    return [
      "I can help with:",
      "- compliance status",
      "- fix-first prioritization",
      "- violation explanations",
      "- structural discipline summaries",
      "Try: 'What should I fix first?'",
    ].join("\n");
  };

  const buildCopilotContext = () => {
    if (!complianceResult) return "No compliance run has been executed yet.";

    const topRules = [...complianceResult.ruleStats].sort((a, b) => b.failed - a.failed).slice(0, 10);
    const topClasses = groupedIssues.slice(0, 10).map((group) => `${group.ifcClass}: ${group.issues.length}`);

    return [
      `Checked: ${complianceResult.checkedElements}`,
      `Compliant: ${complianceResult.compliantElements}`,
      `Non-compliant: ${complianceResult.nonCompliantElements}`,
      `Top rules: ${topRules.map((r) => `${r.ruleName}=${r.failed}`).join(", ")}`,
      `Issue classes: ${topClasses.join(", ")}`,
    ].join("\n");
  };

  const askOpenAI = async (query: string) => {
    const apiKey = copilotApiKey.trim();
    if (!apiKey) return null;

    const systemPrompt =
      "You are an IFC compliance co-pilot. Answer concisely with actionable guidance. Use the provided compliance context only, do not invent model data.";

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: copilotModel,
        input: [
          { role: "system", content: [{ type: "text", text: systemPrompt }] },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Compliance context:
${buildCopilotContext()}

User question: ${query}`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return `OpenAI API error (${response.status}): ${errText.slice(0, 300)}`;
    }

    const data = (await response.json()) as { output_text?: string };
    return data.output_text?.trim() || "No response returned from OpenAI.";
  };

  const handleCopilotAsk = async () => {
    const query = copilotQuery.trim();
    if (!query) return;

    setCopilotMessages((prev) => [...prev, { role: "user", text: query }]);
    setCopilotQuery("");
    setCopilotBusy(true);

    try {
      const openAIReply = await askOpenAI(query);
      const reply = openAIReply || buildCopilotReply(query);
      setCopilotMessages((prev) => [...prev, { role: "assistant", text: reply }]);
    } catch (error) {
      const localReply = buildCopilotReply(query);
      const message = error instanceof Error ? error.message : "Unknown error";
      setCopilotMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `OpenAI request failed (${message}). Falling back to local assistant.

${localReply}`,
        },
      ]);
    } finally {
      setCopilotBusy(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    for (const file of Array.from(e.target.files)) {
      await viewer.loadIfcFromFile(file);
    }
    e.target.value = "";
    await refreshModels();
  };

  const handleRulesImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as ComplianceDefinition;
      if (!Array.isArray(parsed.rules)) {
        throw new Error("Rules JSON must include a 'rules' array.");
      }
      setBepRules(parsed);
      setComplianceResult(null);
      alert(`Imported ${parsed.rules.length} BEP rules from ${file.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON file";
      alert(`Failed to import BEP rules: ${message}`);
    } finally {
      e.target.value = "";
    }
  };

  const runComplianceCheck = async () => {
    if (!bepRules) {
      alert("Import BEP rules first.");
      return;
    }

    setQcBusy(true);
    try {
      const result = await viewer.runCompliance(bepRules);
      setComplianceResult(result);
      await viewer.highlightComplianceIssues(result.issues);
    } finally {
      setQcBusy(false);
    }
  };

  const [clashResume, setClashResume] = React.useState(false);

  const runClashDetection = async () => {
    const modelCount = Array.from(viewer.fragments.list.keys()).length;
    if (modelCount < 2) {
      alert("Need at least 2 models to check for clashes.");
      return;
    }

    // Determine if the user has explicitly selected any objects. If not, we will
    // simply pass undefined to the viewer and it will default to checking all
    // objects for the chosen models. This makes the UI much more forgiving and
    // avoids the common confusion where users load models but forget to pick
    // individual elements.
    const hasSelectedObjects = Array.from(clashObjectSelection.values()).some(selection => selection.size > 0);

    setClashBusy(true);
    try {
      const result = await viewer.runClashDetection(
        clashTolerance,
        clashClearance,
        {
          selectedModels: clashSelectedModels,
          selectedClasses: clashSelectedClasses,
          categories: clashSelectedCategories.size ? clashSelectedCategories : undefined,
          propertyFilter: clashPropertyFilter
            ? {
                key: clashPropertyFilter,
                value: clashPropertyValue,
              }
            : undefined,
          ignoreSameCategory: clashIgnoreSameCategory,
          // only include the map if the user selected anything; otherwise leave
          // undefined so the viewer will iterate over all objects in the
          // filtered models
          selectedObjects: hasSelectedObjects ? clashObjectSelection : undefined,
          resume: clashResume,
        }
      );
      setClashResult(result);
      
      // Automatically visualize clashes in 3D
      if (result.totalClashes > 0) {
        viewer.visualizeClashes(result);
      }
    } finally {
      setClashBusy(false);
    }
  };

  const highlightClash = async (clashId: string) => {
    await viewer.highlightClash(clashId);
  };

  const clearClashHighlights = async () => {
    await viewer.clearClashHighlights();
  };

  const isolateClashingObjects = async () => {
    if (!clashResult) return;
    const allClashingIds = new Set<string>();
    clashResult.clashes.forEach(clash => {
      allClashingIds.add(`${clash.a.modelId}|${clash.a.guid}`);
      allClashingIds.add(`${clash.b.modelId}|${clash.b.guid}`);
    });
    await viewer.isolateClashingObjects(allClashingIds);
  };

  const colorClashingObjects = async () => {
    if (!clashResult) return;
    const allClashingIds = new Set<string>();
    clashResult.clashes.forEach(clash => {
      allClashingIds.add(`${clash.a.modelId}|${clash.a.guid}`);
      allClashingIds.add(`${clash.b.modelId}|${clash.b.guid}`);
    });
    await viewer.colorClashingObjects(allClashingIds, clashColor);
  };

  const saveViewport = () => {
    const viewportName = prompt("Enter viewport name:");
    if (viewportName && viewer.world?.camera) {
      const camera = viewer.world.camera.three;
      const viewport = {
        name: viewportName,
        camera: {
          position: camera.position.clone(),
          target: camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(-1),
          zoom: (camera as any).zoom || 1
        }
      };
      setSavedViewports(prev => [...prev, viewport]);
    }
  };

  const loadViewport = (viewport: any) => {
    if (viewer.world?.camera) {
      const camera = viewer.world.camera.three;
      camera.position.copy(viewport.camera.position);
      // Set look at target
      viewer.world.camera.controls?.setLookAt(
        viewport.camera.position.x,
        viewport.camera.position.y,
        viewport.camera.position.z,
        viewport.camera.target.x,
        viewport.camera.target.y,
        viewport.camera.target.z
      );
    }
  };

  const exportClashReport = () => {
    if (!clashResult) return;

    // Create CSV content for XLS export
    const headers = [
      "Clash ID",
      "Type",
      "Model A",
      "Category A",
      "IFC Class A",
      "GUID A",
      "Model B",
      "Category B",
      "IFC Class B",
      "GUID B",
      "Position X",
      "Position Y",
      "Position Z"
    ];

    const rows = clashResult.clashes.map(clash => [
      clash.id,
      clash.type,
      clash.a.modelName,
      clash.a.category || "",
      clash.a.ifcClass,
      clash.a.guid,
      clash.b.modelName,
      clash.b.category || "",
      clash.b.ifcClass,
      clash.b.guid,
      clash.collision.position[0].toFixed(3),
      clash.collision.position[1].toFixed(3),
      clash.collision.position[2].toFixed(3)
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `clash-report-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const loadModelObjects = async (modelId: string) => {
    try {
      const objects = await viewer.getModelObjects(modelId);
      setModelObjects(prev => new Map(prev.set(modelId, objects)));
      setSelectedModelForObjects(modelId);
      setShowObjectSelection(true);
    } catch (error) {
      console.error("Failed to load model objects:", error);
      alert("Failed to load model objects");
    }
  };

  const toggleObjectSelection = (modelId: string, objectId: string) => {
    setClashObjectSelection(prev => {
      const newSelection = new Map(prev);
      const modelSelection = newSelection.get(modelId) || new Set<string>();
      const newModelSelection = new Set(modelSelection);

      if (newModelSelection.has(objectId)) {
        newModelSelection.delete(objectId);
      } else {
        newModelSelection.add(objectId);
      }

      newSelection.set(modelId, newModelSelection);
      return newSelection;
    });
  };

  const selectObjectsByClass = (modelId: string, ifcClass: string, select: boolean) => {
    const objects = modelObjects.get(modelId) || [];
    const classObjects = objects.filter(obj => obj.ifcClass === ifcClass);

    setClashObjectSelection(prev => {
      const newSelection = new Map(prev);
      const modelSelection = newSelection.get(modelId) || new Set<string>();
      const newModelSelection = new Set(modelSelection);

      classObjects.forEach(obj => {
        if (select) {
          newModelSelection.add(obj.id);
        } else {
          newModelSelection.delete(obj.id);
        }
      });

      newSelection.set(modelId, newModelSelection);
      return newSelection;
    });
  };

  const selectAllObjectsInModel = (modelId: string, select: boolean) => {
    const objects = modelObjects.get(modelId) || [];

    setClashObjectSelection(prev => {
      const newSelection = new Map(prev);
      const newModelSelection = new Set<string>();

      if (select) {
        objects.forEach(obj => newModelSelection.add(obj.id));
      }

      newSelection.set(modelId, newModelSelection);
      return newSelection;
    });
  };

  const clearObjectSelection = (modelId: string) => {
    setClashObjectSelection(prev => {
      const newSelection = new Map(prev);
      newSelection.delete(modelId);
      return newSelection;
    });
  };

  const getFilteredObjects = (modelId: string) => {
    const objects = modelObjects.get(modelId) || [];
    return objects.filter(obj => {
      const matchesSearch = !objectSearchQuery ||
        obj.guid.toLowerCase().includes(objectSearchQuery.toLowerCase()) ||
        obj.ifcClass.toLowerCase().includes(objectSearchQuery.toLowerCase()) ||
        JSON.stringify(obj.properties).toLowerCase().includes(objectSearchQuery.toLowerCase());

      const matchesClass = !objectClassFilter || obj.ifcClass === objectClassFilter;

      return matchesSearch && matchesClass;
    });
  };

  const exportComplianceReport = () => {
    if (!complianceResult) return;

    const allPropertyKeys = Array.from(
      new Set(complianceResult.issues.flatMap((issue) => Object.keys(issue.elementProperties || {})))
    ).sort();

    const escapeHtml = (value: string) =>
      value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");

    const headerCells = [
      "Rule ID",
      "Rule Name",
      "Model ID",
      "Model Name",
      "Local ID",
      "IFC Class",
      "Failed Checks",
      ...allPropertyKeys,
    ]
      .map((h) => `<th>${escapeHtml(h)}</th>`)
      .join("");

    const rows = complianceResult.issues
      .map((issue) => {
        const base = [
          issue.ruleId,
          issue.ruleName,
          issue.modelId,
          issue.modelName,
          String(issue.localId),
          issue.ifcClass ?? "",
          issue.failedChecks.join(" | "),
        ];

        const propertyValues = allPropertyKeys.map((key) => issue.elementProperties?.[key] ?? "");
        return [...base, ...propertyValues].map((value) => `<td>${escapeHtml(String(value ?? ""))}</td>`).join("");
      })
      .map((cells) => `<tr>${cells}</tr>`)
      .join("");

    const workbookHtml = `﻿<html><head><meta charset="utf-8" /></head><body><table border="1"><thead><tr>${headerCells}</tr></thead><tbody>${rows}</tbody></table></body></html>`;

    const blob = new Blob([workbookHtml], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `compliance-report-${new Date().toISOString().replace(/[:.]/g, "-")}.xls`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const copyTSV = async () => {
    if (!flattenedRows.length) return;
    const tsv = ["Property\tValue", ...flattenedRows.map((row) => `${row.key}\t${row.value}`)].join("\n");
    await navigator.clipboard.writeText(tsv);
    alert("Copied properties as TSV!");
  };

  const renderUploadTab = () => (
    <div style={{ border: "1px solid #d3d7e5", borderRadius: 8, padding: 10, background: "#f6f9ff" }}>
      <h3 style={{ margin: "0 0 8px" }}>Model Upload</h3>
      <input type="file" accept=".ifc" multiple onChange={handleFileChange} style={{ width: "100%" }} />
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          style={{ flex: 1 }}
          onClick={() => {
            void viewer.showAll();
            resetAllTargetStates();
          }}
        >
          Show All
        </button>
        <button
          style={{ flex: 1 }}
          onClick={() => {
            void viewer.resetColors();
            // keep hidden/isolate state but clear colors
            setTargetStates((prev) => {
              const next = new Map(prev);
              for (const [k, v] of next.entries()) next.set(k, { ...v, color: undefined });
              return next;
            });
          }}
        >
          Reset Colors
        </button>
      </div>
    </div>
  );
  const renderClashTab = () => (
    <div style={{ border: "1px solid #d3d7e5", borderRadius: 8, padding: 10, background: "#f8f9fe" }}>
      <h3 style={{ margin: "0 0 8px" }}>Clash Detection</h3>
      <div style={{ display: "grid", gap: 6 }}>
        {/* Parameters */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <label>
            Tolerance (soft clash):
            <input
              type="number"
              step="0.01"
              value={clashTolerance}
              onChange={(e) => setClashTolerance(parseFloat(e.target.value) || 0.1)}
              style={{ width: "100%" }}
            />
          </label>
          <label>
            Clearance (clearance clash):
            <input
              type="number"
              step="0.01"
              value={clashClearance}
              onChange={(e) => setClashClearance(parseFloat(e.target.value) || 0.5)}
              style={{ width: "100%" }}
            />
          </label>
        </div>

        {/* Advanced Filtering */}
        <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, background: "#fff" }}>
          <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Advanced Filtering</h4>

          {/* IFC Class Filter */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontWeight: 600, fontSize: 12 }}>IFC Classes:</label>
            <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button
                onClick={() => setClashSelectedClasses(new Set())}
                style={{
                  fontSize: 11,
                  padding: "4px 8px",
                  background: clashSelectedClasses.size === 0 ? "#4CAF50" : "#f5f5f5",
                  color: clashSelectedClasses.size === 0 ? "white" : "black",
                  border: "1px solid #ddd",
                  borderRadius: 3
                }}
              >
                All Classes
              </button>
              {Array.from(allAvailableClasses).map(ifcClass => (
                <button
                  key={ifcClass}
                  onClick={() => {
                    const newSelection = new Set(clashSelectedClasses);
                    if (newSelection.has(ifcClass)) {
                      newSelection.delete(ifcClass);
                    } else {
                      newSelection.add(ifcClass);
                    }
                    setClashSelectedClasses(newSelection);
                  }}
                  style={{
                    fontSize: 11,
                    padding: "4px 8px",
                    background: clashSelectedClasses.has(ifcClass) ? "#2196F3" : "#f5f5f5",
                    color: clashSelectedClasses.has(ifcClass) ? "white" : "black",
                    border: "1px solid #ddd",
                    borderRadius: 3
                  }}
                >
                  {ifcClass}
                </button>
              ))}
            </div>
          </div>

          {/* Category Filter */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontWeight: 600, fontSize: 12 }}>Categories:</label>
            <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button
                onClick={() => setClashSelectedCategories(new Set())}
                style={{
                  fontSize: 11,
                  padding: "4px 8px",
                  background: clashSelectedCategories.size === 0 ? "#4CAF50" : "#f5f5f5",
                  color: clashSelectedCategories.size === 0 ? "white" : "black",
                  border: "1px solid #ddd",
                  borderRadius: 3
                }}
              >
                All Categories
              </button>
              {Array.from(allAvailableCategories).map(cat => (
                <button
                  key={cat}
                  onClick={() => {
                    const newSel = new Set(clashSelectedCategories);
                    if (newSel.has(cat)) newSel.delete(cat);
                    else newSel.add(cat);
                    setClashSelectedCategories(newSel);
                  }}
                  style={{
                    fontSize: 11,
                    padding: "4px 8px",
                    background: clashSelectedCategories.has(cat) ? "#2196F3" : "f5f5f5",
                    color: clashSelectedCategories.has(cat) ? "white" : "black",
                    border: "1px solid #ddd",
                    borderRadius: 3
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Property Filter */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontWeight: 600, fontSize: 12 }}>Property Filter:</label>
            <div style={{ marginTop: 4, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              <select
                value={clashPropertyFilter || ""}
                onChange={(e) => setClashPropertyFilter(e.target.value || undefined)}
                style={{ fontSize: 12, padding: "4px" }}
              >
                <option value="">No property filter</option>
                {Array.from(allAvailableProperties).map(prop => (
                  <option key={prop} value={prop}>{prop}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Property value..."
                value={clashPropertyValue}
                onChange={(e) => setClashPropertyValue(e.target.value)}
                disabled={!clashPropertyFilter}
                style={{ fontSize: 12, padding: "4px" }}
              />
            </div>
          </div>

          {/* Discipline/category rules */}
          <div style={{ marginBottom: 8 }}>
            <label style={{ fontWeight: 600, fontSize: 12 }}>
              <input
                type="checkbox"
                checked={clashIgnoreSameCategory}
                onChange={(e) => setClashIgnoreSameCategory(e.target.checked)}
                style={{ marginRight: 4 }}
              />
              Ignore clashes within same category/discipline
            </label>
          </div>

          {/* Model Selection */}
          <div>
            <label style={{ fontWeight: 600, fontSize: 12 }}>Models to Check:</label>
            <div style={{ marginTop: 4, display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button
                onClick={() => setClashSelectedModels(new Set())}
                style={{
                  fontSize: 11,
                  padding: "4px 8px",
                  background: clashSelectedModels.size === 0 ? "#4CAF50" : "#f5f5f5",
                  color: clashSelectedModels.size === 0 ? "white" : "black",
                  border: "1px solid #ddd",
                  borderRadius: 3
                }}
              >
                All Models
              </button>
              {models.map(model => (
                <button
                  key={model.id}
                  onClick={() => {
                    const newSelection = new Set(clashSelectedModels);
                    if (newSelection.has(model.id)) {
                      newSelection.delete(model.id);
                    } else {
                      newSelection.add(model.id);
                    }
                    setClashSelectedModels(newSelection);
                  }}
                  style={{
                    fontSize: 11,
                    padding: "4px 8px",
                    background: clashSelectedModels.has(model.id) ? "#2196F3" : "#f5f5f5",
                    color: clashSelectedModels.has(model.id) ? "white" : "black",
                    border: "1px solid #ddd",
                    borderRadius: 3
                  }}
                >
                  {model.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Object Selection Interface */}
        <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, background: "#fff" }}>
          <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Select Objects for Clash Detection</h4>

          {/* Model List with Object Selection */}
          <div style={{ display: "grid", gap: 6 }}>
            {models.map((model) => {
              const selectedCount = clashObjectSelection.get(model.id)?.size || 0;
              const totalObjects = modelObjects.get(model.id)?.length || 0;

              return (
                <details key={model.id} style={{ border: "1px solid #eee", borderRadius: 4, padding: 6 }}>
                  <summary style={{ fontWeight: 600, cursor: "pointer" }}>
                    {model.name} ({selectedCount}/{totalObjects} objects selected)
                  </summary>

                  <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button
                        onClick={() => loadModelObjects(model.id)}
                        style={{ fontSize: 12, padding: "2px 6px" }}
                      >
                        Load Objects
                      </button>
                      <button
                        onClick={() => selectAllObjectsInModel(model.id, true)}
                        disabled={totalObjects === 0}
                        style={{ fontSize: 12, padding: "2px 6px" }}
                      >
                        Select All
                      </button>
                      <button
                        onClick={() => selectAllObjectsInModel(model.id, false)}
                        disabled={totalObjects === 0}
                        style={{ fontSize: 12, padding: "2px 6px" }}
                      >
                        Clear All
                      </button>
                      <button
                        onClick={() => clearObjectSelection(model.id)}
                        style={{ fontSize: 12, padding: "2px 6px" }}
                      >
                        Reset
                      </button>
                    </div>

                    {/* IFC Class Quick Selection */}
                    {totalObjects > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <small style={{ fontWeight: 600 }}>Quick Select by Class:</small>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                          {Array.from(new Set(modelObjects.get(model.id)?.map(obj => obj.ifcClass))).map(ifcClass => {
                            const classObjects = modelObjects.get(model.id)?.filter(obj => obj.ifcClass === ifcClass) || [];
                            const selectedInClass = classObjects.filter(obj => clashObjectSelection.get(model.id)?.has(obj.id)).length;

                            return (
                              <button
                                key={ifcClass}
                                onClick={() => selectObjectsByClass(model.id, ifcClass, selectedInClass === 0)}
                                style={{
                                  fontSize: 11,
                                  padding: "2px 4px",
                                  background: selectedInClass === classObjects.length ? "#4CAF50" : selectedInClass > 0 ? "#FF9800" : "#f5f5f5",
                                  color: selectedInClass > 0 ? "white" : "black",
                                  border: "1px solid #ddd",
                                  borderRadius: 3
                                }}
                              >
                                {ifcClass} ({selectedInClass}/{classObjects.length})
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Object List */}
                    {totalObjects > 0 && (
                      <div style={{ marginTop: 8, maxHeight: 200, overflowY: "auto", border: "1px solid #eee", borderRadius: 4 }}>
                        <div style={{ padding: 4, background: "#f9f9f9", borderBottom: "1px solid #eee" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 4, alignItems: "center" }}>
                            <input
                              type="text"
                              placeholder="Search objects..."
                              value={objectSearchQuery}
                              onChange={(e) => setObjectSearchQuery(e.target.value)}
                              style={{ fontSize: 12, padding: "2px 4px", width: "100%" }}
                            />
                            <select
                              value={objectClassFilter}
                              onChange={(e) => setObjectClassFilter(e.target.value)}
                              style={{ fontSize: 12, padding: "2px 4px" }}
                            >
                              <option value="">All Classes</option>
                              {Array.from(new Set(modelObjects.get(model.id)?.map(obj => obj.ifcClass))).map(ifcClass => (
                                <option key={ifcClass} value={ifcClass}>{ifcClass}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div style={{ display: "grid", gap: 2, padding: 4 }}>
                          {getFilteredObjects(model.id).slice(0, 100).map((obj) => {
                            const isSelected = clashObjectSelection.get(model.id)?.has(obj.id) || false;
                            return (
                              <label
                                key={obj.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  padding: "4px",
                                  background: isSelected ? "#e3f2fd" : "transparent",
                                  borderRadius: 3,
                                  cursor: "pointer",
                                  fontSize: 12
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleObjectSelection(model.id, obj.id)}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontWeight: 600, fontSize: 11 }}>{obj.ifcClass}</div>
                                  <div style={{ fontSize: 10, color: "#666", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {obj.properties.Name || obj.guid}
                                  </div>
                                </div>
                              </label>
                            );
                          })}
                          {getFilteredObjects(model.id).length > 100 && (
                            <small style={{ textAlign: "center", color: "#666" }}>
                              Showing first 100 objects. Use search to find more.
                            </small>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: "grid", gridTemplateColumns: "auto auto 1fr", gap: 6, alignItems: 'center' }}>
          <button onClick={runClashDetection} disabled={clashBusy}>
            {clashBusy ? "Running..." : "Run Clash Detection"}
          </button>
          <label style={{ fontSize: "0.8rem", display: 'flex', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={clashResume}
              onChange={e => setClashResume(e.target.checked)}
              style={{ marginRight: 4 }}
            />
            resume previous
          </label>
          <button onClick={clearClashHighlights} disabled={!clashResult}>
            Clear Highlights
          </button>
        </div>

        {/* Clash Actions */}
        {clashResult && clashResult.totalClashes > 0 && (
          <div style={{ borderTop: "1px solid #ddd", paddingTop: 8, marginTop: 8 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <label>
                Clash Color:
                <input
                  type="color"
                  value={clashColor}
                  onChange={(e) => setClashColor(e.target.value)}
                  style={{ marginLeft: 6, verticalAlign: "middle" }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                <button onClick={isolateClashingObjects}>
                  Isolate Clashing Objects
                </button>
                <button onClick={colorClashingObjects}>
                  Color Clashing Objects
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                <button onClick={saveViewport}>
                  Save Viewport
                </button>
                <button onClick={exportClashReport}>
                  Export XLS Report
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Saved Viewports */}
        {savedViewports.length > 0 && (
          <details style={{ marginTop: 8 }}>
            <summary>Saved Viewports ({savedViewports.length})</summary>
            <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
              {savedViewports.map((viewport, index) => (
                <button
                  key={index}
                  onClick={() => loadViewport(viewport)}
                  style={{ textAlign: "left", padding: "4px 8px" }}
                >
                  {viewport.name}
                </button>
              ))}
            </div>
          </details>
        )}

        <small>
          Selecting objects is optional. If nothing is picked the check will run
          against all elements in the loaded models (you still need at least two
          models).
        </small>
      </div>

      {clashResult && (
        <div style={{ marginTop: 10, borderTop: "1px dashed #c3c8d8", paddingTop: 8, fontSize: 13 }}>
          <strong>Clash Dashboard</strong>
          <div>Total clashes: {clashResult.totalClashes}</div>
          <div style={{ color: "#b0172b", fontWeight: 700 }}>Hard clashes: {clashResult.hardClashes}</div>
          <div style={{ color: "#ff8c00", fontWeight: 700 }}>Soft clashes: {clashResult.softClashes}</div>
          <div style={{ color: "#ffa500", fontWeight: 700 }}>Clearance clashes: {clashResult.clearanceClashes}</div>
          {clashResult.skipped && Object.keys(clashResult.skipped).length > 0 && (
            <div style={{ marginTop: 4, fontSize: 12, color: "#555" }}>
              Skipped geometry for models:
              {Object.entries(clashResult.skipped).map(([model, count]) => (
                <span key={model} style={{ marginLeft: 6 }}> {model}: {count}</span>
              ))}
            </div>
          )}
          {(clashResult.originalObjects !== undefined || clashResult.uniqueBoxes !== undefined) && (
            <div style={{ marginTop: 4, fontSize: 12, color: "#555" }}>
              {clashResult.originalObjects !== undefined && (
                <span>Objects gathered: {clashResult.originalObjects}</span>
              )}
              {clashResult.uniqueBoxes !== undefined && (
                <span style={{ marginLeft: 6 }}>Unique boxes tested: {clashResult.uniqueBoxes}</span>
              )}
            </div>
          )}

          <details style={{ marginTop: 6 }}>
            <summary>Clash List ({clashResult.clashes.length})</summary>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {clashResult.clashes.slice(0, 50).map((clash) => (
                <div
                  key={clash.id}
                  style={{ marginTop: 6, border: "1px solid #ddd", borderRadius: 6, padding: 6 }}
                >
                  <div style={{ fontWeight: 600, color: clash.type === "hard" ? "#b0172b" : clash.type === "soft" ? "#ff8c00" : "#ffa500" }}>
                    {clash.type.toUpperCase()} CLASH
                  </div>
                  <div>
                    <strong>{clash.a.ifcClass}</strong> in {clash.a.modelName}
                    {clash.a.category && (
                      <span style={{ marginLeft: 6, fontStyle: "italic", color: "#666" }}>[{clash.a.category}]</span>
                    )}
                    (GUID: {clash.a.guid})
                  </div>
                  <div>
                    <strong>{clash.b.ifcClass}</strong> in {clash.b.modelName}
                    {clash.b.category && (
                      <span style={{ marginLeft: 6, fontStyle: "italic", color: "#666" }}>[{clash.b.category}]</span>
                    )}
                    (GUID: {clash.b.guid})
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button onClick={() => highlightClash(clash.id)}>Highlight Clash</button>
                  </div>
                </div>
              ))}
              {clashResult.clashes.length > 50 && (
                <small>Showing first 50 clashes. Total: {clashResult.clashes.length}</small>
              )}
            </div>
          </details>
        </div>
      )}
    </div>
  );
  const renderModelsTab = () => (
    <div style={{ borderTop: "1px solid #ddd", paddingTop: 8 }}>
      <h3 style={{ margin: "0 0 8px" }}>Uploaded Models</h3>
      {loading && <p style={{ margin: 0 }}>Refreshing model list...</p>}
      {!models.length && !loading && <p style={{ margin: 0 }}>No IFC loaded.</p>}

      {models.map((model) => (
        <details key={model.id} open style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, marginBottom: 8 }}>
          <summary style={{ fontWeight: 700 }}>{model.name}</summary>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 6, marginTop: 8 }}>
            {(() => {
              const key = makeTargetKey("model", [model.id]);
              const st = targetStates.get(key);
              return (
                <>
                  <button
                    style={actionButtonStyle(st?.hidden === false)}
                    onClick={() => {
                      void viewer.showModel(model.id);
                      setTargetStates((prev) => mergeTargetState(prev, key, { hidden: false, isolated: false }));
                    }}
                  >
                    Show
                  </button>
                  <button
                    style={actionButtonStyle(st?.hidden === true)}
                    onClick={() => {
                      void viewer.hideModel(model.id);
                      setTargetStates((prev) => mergeTargetState(prev, key, { hidden: true, isolated: false }));
                    }}
                  >
                    Hide
                  </button>
                  <button
                    style={actionButtonStyle(st?.isolated === true)}
                    onClick={() => {
                      void viewer.isolateModel(model.id);
                      // isolating a model implies other targets are no longer isolated
                      setTargetStates((prev) => {
                        const cleared = new Map(prev);
                        for (const [k, v] of cleared.entries()) cleared.set(k, { ...v, isolated: false });
                        return mergeTargetState(cleared, key, { isolated: true, hidden: false });
                      });
                    }}
                  >
                    Isolate
                  </button>
                  <button
                    style={actionButtonStyle(false, st?.color)}
                    onClick={() => {
                      const c = randomColor();
                      void viewer.colorModel(model.id, c);
                      setTargetStates((prev) => mergeTargetState(prev, key, { color: c }));
                    }}
                    title={st?.color ? `Color: ${st.color}` : "Assign random color"}
                  >
                    {st?.color ? "Colored" : "Color"}
                  </button>
                  <button
                    onClick={() => {
                      void viewer.removeModel(model.id);
                      setTargetStates((prev) => {
                        const next = new Map(prev);
                        next.delete(key);
                        return next;
                      });
                    }}
                  >
                    Remove
                  </button>
                </>
              );
            })()}
          </div>

          <div style={{ marginTop: 10 }}>
            <strong>IFC Class Elements</strong>
            {model.classes.map((item) => (
              <div key={`${model.id}-${item.name}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, marginTop: 6 }}>
                <span title={item.name}>
                  {item.name} ({item.count})
                </span>
                <span style={{ display: "flex", gap: 4 }}>
                  {(() => {
                    const key = makeTargetKey("class", [model.id, item.name]);
                    const st = targetStates.get(key);
                    return (
                      <>
                        <button
                          style={actionButtonStyle(st?.hidden === false)}
                          onClick={() => {
                            void viewer.showClass(model.id, item.name);
                            setTargetStates((prev) => mergeTargetState(prev, key, { hidden: false, isolated: false }));
                          }}
                          title="Show"
                        >
                          S
                        </button>
                        <button
                          style={actionButtonStyle(st?.hidden === true)}
                          onClick={() => {
                            void viewer.hideClass(model.id, item.name);
                            setTargetStates((prev) => mergeTargetState(prev, key, { hidden: true, isolated: false }));
                          }}
                          title="Hide"
                        >
                          H
                        </button>
                        <button
                          style={actionButtonStyle(st?.isolated === true)}
                          onClick={() => {
                            void viewer.isolateClass(model.id, item.name);
                            setTargetStates((prev) => {
                              const cleared = new Map(prev);
                              for (const [k, v] of cleared.entries()) cleared.set(k, { ...v, isolated: false });
                              return mergeTargetState(cleared, key, { isolated: true, hidden: false });
                            });
                          }}
                          title="Isolate"
                        >
                          I
                        </button>
                        <button
                          style={actionButtonStyle(false, st?.color)}
                          onClick={() => {
                            const c = randomColor();
                            void viewer.colorClass(model.id, item.name, c);
                            setTargetStates((prev) => mergeTargetState(prev, key, { color: c }));
                          }}
                          title={st?.color ? `Color: ${st.color}` : "Assign random color"}
                        >
                          {st?.color ? "C" : "C"}
                        </button>
                      </>
                    );
                  })()}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, borderTop: "1px dashed #ccc", paddingTop: 8 }}>
            <strong>Groups by Property</strong>
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input
                value={propertyKey}
                onChange={(e) => setPropertyKey(e.target.value)}
                placeholder="e.g. PredefinedType"
                style={{ flex: 1 }}
              />
              <button onClick={() => void refreshModels()}>Build</button>
            </div>

            {model.propertyGroups.map((group) => (
              <div key={`${model.id}-${group.name}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, marginTop: 6 }}>
                <span title={group.name}>
                  {group.name} ({group.count})
                </span>
                <span style={{ display: "flex", gap: 4 }}>
                  {(() => {
                    const key = makeTargetKey("propertyGroup", [model.id, propertyKey, group.name]);
                    const st = targetStates.get(key);
                    return (
                      <>
                        <button
                          style={actionButtonStyle(st?.hidden === false)}
                          onClick={() => {
                            void viewer.showPropertyGroup(model.id, propertyKey, group.name);
                            setTargetStates((prev) => mergeTargetState(prev, key, { hidden: false, isolated: false }));
                          }}
                          title="Show"
                        >
                          S
                        </button>
                        <button
                          style={actionButtonStyle(st?.hidden === true)}
                          onClick={() => {
                            void viewer.hidePropertyGroup(model.id, propertyKey, group.name);
                            setTargetStates((prev) => mergeTargetState(prev, key, { hidden: true, isolated: false }));
                          }}
                          title="Hide"
                        >
                          H
                        </button>
                        <button
                          style={actionButtonStyle(st?.isolated === true)}
                          onClick={() => {
                            void viewer.isolatePropertyGroup(model.id, propertyKey, group.name);
                            setTargetStates((prev) => {
                              const cleared = new Map(prev);
                              for (const [k, v] of cleared.entries()) cleared.set(k, { ...v, isolated: false });
                              return mergeTargetState(cleared, key, { isolated: true, hidden: false });
                            });
                          }}
                          title="Isolate"
                        >
                          I
                        </button>
                        <button
                          style={actionButtonStyle(false, st?.color)}
                          onClick={() => {
                            const c = randomColor();
                            void viewer.colorPropertyGroup(model.id, propertyKey, group.name, c);
                            setTargetStates((prev) => mergeTargetState(prev, key, { color: c }));
                          }}
                          title={st?.color ? `Color: ${st.color}` : "Assign random color"}
                        >
                          C
                        </button>
                      </>
                    );
                  })()}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 12, borderTop: "1px dashed #ccc", paddingTop: 8 }}>
            <strong>Transform Model</strong>
            <div style={{ display: "flex", gap: 6, marginTop: 6, marginBottom: 6 }}>
              <button onClick={() => applyModelTransformation(model.id)}>Apply</button>
              <button onClick={() => resetModelTransformation(model.id)}>Reset</button>
            </div>
            
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr 1fr 1fr", gap: 4, alignItems: "center" }}>
              <span></span>
              <strong style={{ fontSize: "12px" }}>X</strong>
              <strong style={{ fontSize: "12px" }}>Y</strong>
              <strong style={{ fontSize: "12px" }}>Z</strong>
              
              <strong style={{ fontSize: "12px" }}>Position</strong>
              <input
                type="number"
                step="0.1"
                value={(modelTransformations.get(model.id)?.position.x ?? 0).toFixed(1)}
                onChange={(e) => updateModelTransformation(model.id, 'position', 'x', parseFloat(e.target.value) || 0)}
                style={{ width: "100%" }}
              />
              <input
                type="number"
                step="0.1"
                value={(modelTransformations.get(model.id)?.position.y ?? 0).toFixed(1)}
                onChange={(e) => updateModelTransformation(model.id, 'position', 'y', parseFloat(e.target.value) || 0)}
                style={{ width: "100%" }}
              />
              <input
                type="number"
                step="0.1"
                value={(modelTransformations.get(model.id)?.position.z ?? 0).toFixed(1)}
                onChange={(e) => updateModelTransformation(model.id, 'position', 'z', parseFloat(e.target.value) || 0)}
                style={{ width: "100%" }}
              />
              
              <strong style={{ fontSize: "12px" }}>Rotation (°)</strong>
              <input
                type="number"
                step="1"
                value={((modelTransformations.get(model.id)?.rotation.x ?? 0) * 180 / Math.PI).toFixed(0)}
                onChange={(e) => updateModelTransformation(model.id, 'rotation', 'x', parseFloat(e.target.value) || 0)}
                style={{ width: "100%" }}
              />
              <input
                type="number"
                step="1"
                value={((modelTransformations.get(model.id)?.rotation.y ?? 0) * 180 / Math.PI).toFixed(0)}
                onChange={(e) => updateModelTransformation(model.id, 'rotation', 'y', parseFloat(e.target.value) || 0)}
                style={{ width: "100%" }}
              />
              <input
                type="number"
                step="1"
                value={((modelTransformations.get(model.id)?.rotation.z ?? 0) * 180 / Math.PI).toFixed(0)}
                onChange={(e) => updateModelTransformation(model.id, 'rotation', 'z', parseFloat(e.target.value) || 0)}
                style={{ width: "100%" }}
              />
              
              <strong style={{ fontSize: "12px" }}>Scale</strong>
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={(modelTransformations.get(model.id)?.scale.x ?? 1).toFixed(1)}
                onChange={(e) => updateModelTransformation(model.id, 'scale', 'x', parseFloat(e.target.value) || 1)}
                style={{ width: "100%" }}
              />
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={(modelTransformations.get(model.id)?.scale.y ?? 1).toFixed(1)}
                onChange={(e) => updateModelTransformation(model.id, 'scale', 'y', parseFloat(e.target.value) || 1)}
                style={{ width: "100%" }}
              />
              <input
                type="number"
                step="0.1"
                min="0.1"
                value={(modelTransformations.get(model.id)?.scale.z ?? 1).toFixed(1)}
                onChange={(e) => updateModelTransformation(model.id, 'scale', 'z', parseFloat(e.target.value) || 1)}
                style={{ width: "100%" }}
              />
            </div>
          </div>
        </details>
      ))}
    </div>
  );

  const renderPropertiesTab = () => (
    <div style={{ border: "1px solid #d3d7e5", borderRadius: 8, padding: 10, background: "#fffdf7" }}>
      <h3 style={{ margin: "0 0 8px" }}>Properties</h3>
      <bim-panel-section style={{ minHeight: "300px" }} label="Selected Element Data">
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: 8 }}>
          <button onClick={() => setExpanded((prev) => !prev)}>{expanded ? "Collapse" : "Expand"}</button>
          <button onClick={copyTSV}>Copy as TSV</button>
        </div>

        <input
          type="text"
          placeholder="Search property..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: "100%", marginBottom: 8, padding: "0.25rem" }}
        />

        <div style={{ height: "280px", overflow: "auto", fontSize: 13 }}>
          {!selectedItem ? (
            <p style={{ margin: 0, color: "#666" }}>Select an element to see its properties.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {flattenedRows.map((row) => (
                  <tr key={row.key}>
                    <td style={{ borderBottom: "1px solid #ddd", padding: "0.35rem 0.25rem", fontWeight: 600, width: "40%" }}>
                      {row.key}
                    </td>
                    <td
                      style={{
                        borderBottom: "1px solid #ddd",
                        padding: "0.35rem 0.25rem",
                        whiteSpace: expanded ? "pre-wrap" : "nowrap",
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                        maxWidth: 1,
                      }}
                      title={row.value}
                    >
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </bim-panel-section>
    </div>
  );

  const renderQualityTab = () => (
    <div style={{ border: "1px solid #d3d7e5", borderRadius: 8, padding: 10, background: "#f8f9fe" }}>
      <h3 style={{ margin: "0 0 8px" }}>Quality Check</h3>
      <div style={{ display: "grid", gap: 6 }}>
        <input type="file" accept=".json" onChange={handleRulesImport} />
        <small>
          BEP JSON imported: <strong>{bepRules?.rules.length ?? 0}</strong> rules
        </small>
        <button onClick={runComplianceCheck} disabled={!bepRules || qcBusy}>
          {qcBusy ? "Running compliance..." : "Run Automated Compliance Check"}
        </button>
        <button onClick={() => void viewer.resetColors()} disabled={qcBusy}>
          Clear Non-compliant Highlighting
        </button>
        <button onClick={exportComplianceReport} disabled={!complianceResult}>
          Export Compliance Report
        </button>
        {!bepRules && <small>Use a BEP rules JSON file. Example: {JSON.stringify(defaultRuleExample)}</small>}
      </div>

      {complianceResult && (
        <div style={{ marginTop: 10, borderTop: "1px dashed #c3c8d8", paddingTop: 8, fontSize: 13 }}>
          <strong>Compliance Dashboard</strong>
          <div>Checked elements: {complianceResult.checkedElements}</div>
          <div>Compliant: {complianceResult.compliantElements}</div>
          <div style={{ color: "#b0172b", fontWeight: 700 }}>Non-compliant: {complianceResult.nonCompliantElements}</div>

          <details style={{ marginTop: 6 }}>
            <summary>Per Rule</summary>
            {complianceResult.ruleStats.map((rule) => (
              <div key={rule.ruleId} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 6 }}>
                <span>{rule.ruleName}</span>
                <span>checked {rule.checked}</span>
                <span style={{ color: rule.failed ? "#b0172b" : "#0c7a32" }}>failed {rule.failed}</span>
              </div>
            ))}
          </details>

          <details style={{ marginTop: 6 }}>
            <summary>Issue List ({complianceResult.issues.length})</summary>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <label>
                  Color
                  <input
                    type="color"
                    value={nonComplianceColor}
                    onChange={(e) => setNonComplianceColor(e.target.value)}
                    style={{ marginLeft: 6, verticalAlign: "middle" }}
                  />
                </label>
                <button onClick={() => void viewer.isolateElements(toElementRefs(complianceResult.issues))}>
                  Isolate All Non-compliant
                </button>
                <button onClick={() => void viewer.colorElements(toElementRefs(complianceResult.issues), nonComplianceColor)}>
                  Color All Non-compliant
                </button>
              </div>

              {groupedIssues.map((group) => (
                <details key={group.ifcClass}>
                  <summary>
                    {group.ifcClass} ({group.issues.length})
                  </summary>
                  <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                    <button onClick={() => void viewer.isolateElements(toElementRefs(group.issues))}>Isolate Class Issues</button>
                    <button onClick={() => void viewer.colorElements(toElementRefs(group.issues), nonComplianceColor)}>
                      Color Class Issues
                    </button>
                  </div>

                  {group.issues.slice(0, 25).map((issue, index) => (
                    <div
                      key={`${issue.ruleId}-${issue.modelId}-${issue.localId}-${index}`}
                      style={{ marginTop: 6, border: "1px solid #ddd", borderRadius: 6, padding: 6 }}
                    >
                      <div>
                        {issue.modelName} #{issue.localId} — {issue.ruleName}
                      </div>
                      <small style={{ display: "block", marginTop: 2 }}>{issue.failedChecks.join("; ")}</small>
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <button onClick={() => void viewer.isolateElement(issue.modelId, issue.localId)}>Isolate</button>
                        <button onClick={() => void viewer.colorElement(issue.modelId, issue.localId, nonComplianceColor)}>Color</button>
                      </div>
                    </div>
                  ))}
                </details>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );



  const renderCopilotTab = () => (
    <div style={{ border: "1px solid #d3d7e5", borderRadius: 8, padding: 10, background: "#f5f8ff" }}>
      <h3 style={{ margin: "0 0 8px" }}>AI Co-pilot</h3>
      <div style={{ fontSize: 12, color: "#4a5575", marginBottom: 8 }}>
        Ask things like: <em>Is this model compliant?</em>, <em>What should I fix first?</em>,
        <em> Explain this violation</em>, <em>Summarize structural discipline issues</em>.
      </div>

      <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
        <input
          type="password"
          value={copilotApiKey}
          onChange={(e) => setCopilotApiKey(e.target.value)}
          placeholder="OpenAI API key (stored in browser localStorage)"
          style={{ padding: "0.4rem" }}
        />
        <input
          value={copilotModel}
          onChange={(e) => setCopilotModel(e.target.value)}
          placeholder="OpenAI model (e.g. gpt-4.1-mini)"
          style={{ padding: "0.4rem" }}
        />
      </div>

      <div style={{ height: 320, overflow: "auto", border: "1px solid #d7def7", borderRadius: 6, padding: 8, background: "#fff" }}>
        {copilotMessages.map((message, index) => (
          <div key={index} style={{ marginBottom: 8, whiteSpace: "pre-wrap" }}>
            <strong style={{ color: message.role === "assistant" ? "#2d3a68" : "#7a2d2d" }}>
              {message.role === "assistant" ? "Co-pilot" : "You"}:
            </strong>{" "}
            {message.text}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <input
          value={copilotQuery}
          onChange={(e) => setCopilotQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleCopilotAsk();
          }}
          placeholder="Ask the AI Co-pilot about compliance..."
          style={{ flex: 1, padding: "0.4rem" }}
        />
        <button onClick={() => void handleCopilotAsk()} disabled={copilotBusy}>{copilotBusy ? "Thinking..." : "Ask"}</button>
      </div>
    </div>
  );

  const tabs: Array<{ key: PanelTab; label: string }> = [
    { key: "upload", label: "Model Upload" },
    { key: "models", label: "Uploaded Models" },
    { key: "properties", label: "Properties" },
    { key: "quality", label: "Quality Check" },
    { key: "clash", label: "Clash Detection" },
    { key: "copilot", label: "AI Co-pilot" },
  ];

  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        width: "420px",
        maxHeight: "95vh",
        overflow: "auto",
        zIndex: 10,
        background: "rgba(255,255,255,0.95)",
        padding: "1rem",
        borderRadius: "8px",
        display: "grid",
        gap: "0.75rem",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 4 }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "6px 4px",
              fontWeight: activeTab === tab.key ? 700 : 500,
              background: activeTab === tab.key ? "#e8edff" : "#fff",
              border: "1px solid #cbd4f1",
              borderRadius: 6,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "upload" && renderUploadTab()}
      {activeTab === "models" && renderModelsTab()}
      {activeTab === "properties" && renderPropertiesTab()}
      {activeTab === "quality" && renderQualityTab()}
      {activeTab === "clash" && renderClashTab()}
      {activeTab === "copilot" && renderCopilotTab()}
    </div>
  );
};
