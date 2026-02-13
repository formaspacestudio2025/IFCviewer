import React from "react";
import { Viewer } from "../core/Viewer";

interface Props {
  viewer: Viewer;
}

export const ControlPanel: React.FC<Props> = ({ viewer }) => {
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
        background: "rgba(255,255,255,0.9)",
        padding: "1rem",
        borderRadius: "8px",
        zIndex: 10,
      }}
    >
      <button onClick={handleLoadURL}>Load IFC (URL)</button>
      <input type="file" accept=".ifc" onChange={handleFileChange} />
      <button onClick={handleDownload}>Download Fragments</button>
    </div>
  );
};