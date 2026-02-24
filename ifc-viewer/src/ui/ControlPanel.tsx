import React, { useEffect, useMemo, useState } from "react";
import { ComplianceDefinition, ComplianceRunResult, ModelOverview, Viewer } from "../core/Viewer";

interface Props {
  viewer: Viewer;
}

type PanelTab = "upload" | "models" | "properties" | "quality" | "copilot";

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
  const [activeTab, setActiveTab] = useState<PanelTab>("upload");
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
  const [copilotQuery, setCopilotQuery] = useState("");
  const [copilotApiKey, setCopilotApiKey] = useState(() => localStorage.getItem("openai_api_key") ?? "");
  const [copilotModel, setCopilotModel] = useState("gpt-4.1-mini");
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotMessages, setCopilotMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([
    { role: "assistant", text: "Hi! I can help with compliance insights. Ask: Is this model compliant? What should I fix first? Explain this violation. Summarize structural discipline issues." },
  ]);

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
        <button style={{ flex: 1 }} onClick={() => void viewer.showAll()}>
          Show All
        </button>
        <button style={{ flex: 1 }} onClick={() => void viewer.resetColors()}>
          Reset Colors
        </button>
      </div>
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 4 }}>
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
      {activeTab === "copilot" && renderCopilotTab()}
    </div>
  );
};
