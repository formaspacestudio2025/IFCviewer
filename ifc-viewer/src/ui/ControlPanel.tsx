// src/ui/ControlPanel.tsx
import React, { useRef, useEffect, useState } from "react";
import { Viewer } from "../core/Viewer";

interface Props {
  viewer: Viewer;
}

export const ControlPanel: React.FC<Props> = ({ viewer }) => {
  const tableRef = useRef<any>(null); // ref for <bui-properties-table>
  const [expanded, setExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Update the table when a selection is made in the viewer
  useEffect(() => {
    viewer.onSelectObject = (items) => {
      if (!tableRef.current) return;

      const itemsObj: Record<string, any> = {};
      if (Array.isArray(items)) {
        items.forEach((item, i) => (itemsObj[i] = item));
      } else if (items) {
        Object.assign(itemsObj, items);
      }

      tableRef.current.items = itemsObj;
      tableRef.current.expanded = expanded;
      tableRef.current.queryString = searchQuery || null;
      tableRef.current.requestUpdate?.();
    };

    return () => {
      viewer.onSelectObject = undefined;
    };
  }, [viewer, expanded, searchQuery]);

  // IFC Load handlers
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

  // Expand/Collapse table
  const toggleExpand = () => setExpanded((prev) => !prev);

  // Copy table as TSV
  const copyTSV = async () => {
    if (!tableRef.current?.tsv) return;
    await navigator.clipboard.writeText(tableRef.current.tsv);
    alert("Copied properties as TSV!");
  };

  // Search input
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
        background: "rgba(255,255,255,0.95)",
        padding: "1rem",
        borderRadius: "8px",
        zIndex: 10,
        width: "350px",
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
        <bim-panel-section label="Element Data">
          {/* Expand / Collapse & Copy */}
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
          <bui-properties-table ref={tableRef} />
        </bim-panel-section>
      </bim-panel>
    </div>
  );
};