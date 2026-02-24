import React, { useEffect, useMemo, useState } from "react";
import { ComplianceDefinition, ComplianceRunResult, ModelOverview, Viewer } from "../core/Viewer";

interface Props {
  viewer: Viewer;
}

const randomColor = () => `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`;

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
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<Record<string, any> | null>(null);
  const [models, setModels] = useState<ModelOverview[]>([]);
  const [propertyKey, setPropertyKey] = useState("PredefinedType");
  const [loading, setLoading] = useState(false);
  const [bepRules, setBepRules] = useState<ComplianceDefinition | null>(null);
  const [complianceResult, setComplianceResult] = useState<ComplianceRunResult | null>(null);
  const [qcBusy, setQcBusy] = useState(false);

  const refreshModels = async () => {
    setLoading(true);
    try {
      const data = await viewer.getModelsOverview(propertyKey);
      setModels(data);
    } finally {
      setLoading(false);
    }
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

  const exportComplianceReport = () => {
    if (!complianceResult) return;

    const payload = {
      project: bepRules?.project,
      version: bepRules?.version,
      ruleCount: bepRules?.rules.length ?? 0,
      ...complianceResult,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `compliance-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const copyTSV = async () => {
    if (!flattenedRows.length) return;
    const tsv = ["Property\tValue", ...flattenedRows.map((row) => `${row.key}\t${row.value}`)].join("\n");
    await navigator.clipboard.writeText(tsv);
    alert("Copied properties as TSV!");
  };

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
      <div>
        <input type="file" accept=".ifc" multiple onChange={handleFileChange} style={{ width: "100%" }} />
      </div>

      <div style={{ border: "1px solid #d3d7e5", borderRadius: 8, padding: 10, background: "#f8f9fe" }}>
        <h3 style={{ margin: "0 0 8px" }}>Quality Control</h3>
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
              <summary>Top Issues ({complianceResult.issues.length})</summary>
              {complianceResult.issues.slice(0, 20).map((issue, index) => (
                <div key={`${issue.ruleId}-${issue.modelId}-${issue.localId}-${index}`} style={{ marginTop: 6 }}>
                  <div>
                    {issue.modelName} #{issue.localId} — {issue.ruleName}
                  </div>
                  <small>{issue.failedChecks.join("; ")}</small>
                </div>
              ))}
            </details>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button style={{ flex: 1 }} onClick={() => void viewer.showAll()}>
          Show All
        </button>
        <button style={{ flex: 1 }} onClick={() => void viewer.resetColors()}>
          Reset Colors
        </button>
      </div>

      <div style={{ borderTop: "1px solid #ddd", paddingTop: 8 }}>
        <h3 style={{ margin: "0 0 8px" }}>Uploaded Models</h3>
        {loading && <p style={{ margin: 0 }}>Refreshing model list...</p>}
        {!models.length && !loading && <p style={{ margin: 0 }}>No IFC loaded.</p>}

        {models.map((model) => (
          <details key={model.id} open style={{ border: "1px solid #ddd", borderRadius: 6, padding: 8, marginBottom: 8 }}>
            <summary style={{ fontWeight: 700 }}>{model.name}</summary>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 6, marginTop: 8 }}>
              <button onClick={() => void viewer.showModel(model.id)}>Show</button>
              <button onClick={() => void viewer.hideModel(model.id)}>Hide</button>
              <button onClick={() => void viewer.isolateModel(model.id)}>Isolate</button>
              <button onClick={() => void viewer.colorModel(model.id, randomColor())}>Color</button>
              <button onClick={() => void viewer.removeModel(model.id)}>Remove</button>
            </div>

            <div style={{ marginTop: 10 }}>
              <strong>IFC Class Elements</strong>
              {model.classes.map((item) => (
                <div key={`${model.id}-${item.name}`} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, marginTop: 6 }}>
                  <span title={item.name}>
                    {item.name} ({item.count})
                  </span>
                  <span style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => void viewer.showClass(model.id, item.name)}>S</button>
                    <button onClick={() => void viewer.hideClass(model.id, item.name)}>H</button>
                    <button onClick={() => void viewer.isolateClass(model.id, item.name)}>I</button>
                    <button onClick={() => void viewer.colorClass(model.id, item.name, randomColor())}>C</button>
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
                    <button onClick={() => void viewer.showPropertyGroup(model.id, propertyKey, group.name)}>S</button>
                    <button onClick={() => void viewer.hidePropertyGroup(model.id, propertyKey, group.name)}>H</button>
                    <button onClick={() => void viewer.isolatePropertyGroup(model.id, propertyKey, group.name)}>I</button>
                    <button onClick={() => void viewer.colorPropertyGroup(model.id, propertyKey, group.name, randomColor())}>C</button>
                  </span>
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>

      <bim-panel label="Properties">
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
      </bim-panel>
    </div>
  );
};
