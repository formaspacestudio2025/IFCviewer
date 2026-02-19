import React, { useRef, useEffect, useState } from "react";
import { Viewer } from "../core/Viewer";

// Type for the web component table
type PropertiesTable = HTMLElement & {
  items?: Record<string, any>;
  expanded?: boolean;
  queryString?: string | null;
  requestUpdate?: () => void;
  tsv?: string;
};

interface Props {
  viewer: Viewer;
}

export const ControlPanel: React.FC<Props> = ({ viewer }) => {
  const tableRef = useRef<PropertiesTable>(null);
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Transform IFC ItemsData into key/value object for bui-properties-table
  const transformItemsData = (itemsData: any[]): Record<string, any> => {
    const result: Record<string, any> = {};
    itemsData.forEach((item, idx) => {
      const entry: Record<string, any> = {};
      for (const [key, prop] of Object.entries(item)) {
        if (prop && typeof prop === "object" && "value" in prop) {
          entry[key] = prop.value;
        } else {
          entry[key] = prop;
        }
      }
      result[idx] = entry;
    });
    return result;
  };

  // Update table when a selection occurs
  useEffect(() => {
    viewer.onSelectObject = (items: any) => {
      if (!tableRef.current) return;

      const itemsArray = Array.isArray(items)
        ? items
        : Object.values(items || {});

      const transformed = transformItemsData(itemsArray);

      tableRef.current.items = transformed;
      tableRef.current.expanded = expanded;
      tableRef.current.queryString = searchQuery || null;
      tableRef.current.requestUpdate?.();
    };

    return () => {
      viewer.onSelectObject = undefined;
    };
  }, [viewer, expanded, searchQuery]);

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
    if (!tableRef.current?.tsv) return;
    await navigator.clipboard.writeText(tableRef.current.tsv);
    alert("Copied properties as TSV!");
  };

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    if (tableRef.current) {
      tableRef.current.queryString = value || null;
      tableRef.current.requestUpdate?.();
    }
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
      {/* IFC Load Buttons */}
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

      {/* Properties Panel */}
      <bim-panel label="Properties">
        <bim-panel-section style={{ minHeight: "400px" }} label="Element Data">
          {/* Actions */}
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: 8 }}>
            <button onClick={toggleExpand}>
              {expanded ? "Collapse" : "Expand"}
            </button>
            <button onClick={copyTSV}>Copy as TSV</button>
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search property..."
            value={searchQuery}
            onChange={handleSearch}
            style={{ width: "100%", marginBottom: 8, padding: "0.25rem" }}
          />

          {/* Properties Table */}
          <bui-properties-table
            ref={tableRef}
            style={{ display: "block", height: "400px", overflow: "auto" }}
          />
        </bim-panel-section>
      </bim-panel>
    </div>
  );
};