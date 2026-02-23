import React, { useEffect, useMemo, useState } from "react";
import { Viewer } from "../core/Viewer";

interface Props {
  viewer: Viewer;
}

export const ControlPanel: React.FC<Props> = ({ viewer }) => {
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    viewer.onSelectObject = (items: any) => {
      const itemsArray = Array.isArray(items) ? items : Object.values(items || {});
      const firstItem = itemsArray[0] as Record<string, any> | undefined;
      setSelectedItem(firstItem ?? null);
    };

    return () => {
      viewer.onSelectObject = undefined;
    };
  }, [viewer]);

  const flattenedRows = useMemo(() => {
    if (!selectedItem) return [] as Array<{ key: string; value: string }>;

    const rows: Array<{ key: string; value: string }> = [];
    for (const [key, rawValue] of Object.entries(selectedItem)) {
      if (searchQuery && !key.toLowerCase().includes(searchQuery.toLowerCase())) {
        continue;
      }

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

  // Handlers
  const handleLoadURL = async () => {
    await viewer.loadIfcFromURL(
      "https://thatopen.github.io/engine_components/resources/ifc/school_str.ifc"
    );
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    await viewer.loadIfcFromFile(e.target.files[0]);
  };

  const handleDownload = () => viewer.downloadFragments();

  const toggleExpand = () => setExpanded((prev) => !prev);

  const copyTSV = async () => {
    if (!flattenedRows.length) return;
    const tsv = ["Property\tValue", ...flattenedRows.map((row) => `${row.key}\t${row.value}`)].join("\n");
    await navigator.clipboard.writeText(tsv);
    alert("Copied properties as TSV!");
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
  };

  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        width: "350px",
        zIndex: 10,
        background: "rgba(255,255,255,0.95)",
        padding: "1rem",
        borderRadius: "8px",
      }}
    >
      <button
        onClick={handleLoadURL}
        style={{ display: "block", marginBottom: 8, width: "100%" }}
      >
        Load IFC (URL)
      </button>
      <input
        type="file"
        accept=".ifc"
        onChange={handleFileChange}
        style={{ display: "block", marginBottom: 8, width: "100%" }}
      />
      <button
        onClick={handleDownload}
        style={{ display: "block", marginBottom: 16, width: "100%" }}
      >
        Download Fragments
      </button>

      <bim-panel label="Properties">
        <bim-panel-section style={{ minHeight: "400px" }} label="Element Data">
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: 8 }}>
            <button onClick={toggleExpand}>{expanded ? "Collapse" : "Expand"}</button>
            <button onClick={copyTSV}>Copy as TSV</button>
          </div>

          <input
            type="text"
            placeholder="Search property..."
            value={searchQuery}
            onChange={handleSearch}
            style={{ width: "100%", marginBottom: 8, padding: "0.25rem" }}
          />

          <div style={{ height: "400px", overflow: "auto", fontSize: 13 }}>
            {!selectedItem ? (
              <p style={{ margin: 0, color: "#666" }}>Select an element to see its properties.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {flattenedRows.map((row) => (
                    <tr key={row.key}>
                      <td
                        style={{
                          borderBottom: "1px solid #ddd",
                          padding: "0.35rem 0.25rem",
                          fontWeight: 600,
                          verticalAlign: "top",
                          width: "40%",
                        }}
                      >
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
