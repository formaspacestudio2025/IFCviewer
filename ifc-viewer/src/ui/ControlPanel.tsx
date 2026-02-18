import React, { useEffect, useRef } from "react";
import { Viewer } from "../core/Viewer";
import "@thatopen/ui-obc"; // registers <bim-panel> and <bui-properties-table>

interface Props {
  viewer: Viewer;
}

export const ControlPanel: React.FC<Props> = ({ viewer }) => {
  const tableRef = useRef<any>(null);

  useEffect(() => {
    viewer.onSelectObject = (obj, props) => {
      if (!props || !tableRef.current) return;

      tableRef.current.items = props;
      tableRef.current.selected = obj?.userData?.expressID ?? obj?.userData?.localId ?? null;
    };

    return () => {
      viewer.onSelectObject = undefined;
    };
  }, [viewer]);

  const handleLoadURL = async () => {
    await viewer.loadIfcFromURL(
      "https://thatopen.github.io/engine_components/resources/ifc/school_str.ifc"
    );
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    await viewer.loadIfcFromFile(e.target.files[0]);
  };

  const handleDownload = () => {
    viewer.downloadFragments();
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
        maxWidth: "300px",
      }}
    >
      <button onClick={handleLoadURL} style={{ display: "block", marginBottom: "0.5rem" }}>
        Load IFC (URL)
      </button>

      <input
        type="file"
        accept=".ifc"
        onChange={handleFileChange}
        style={{ display: "block", marginBottom: "0.5rem" }}
      />

      <button onClick={handleDownload} style={{ display: "block", marginBottom: "1rem" }}>
        Download Fragments
      </button>

      {/* Use React.createElement to avoid TSX errors */}
      {React.createElement(
        "bim-panel",
        { label: "Properties" },
        React.createElement(
          "bim-panel-section",
          { label: "Element Data" },
          React.createElement("bui-properties-table", { ref: tableRef })
        )
      )}
    </div>
  );
};