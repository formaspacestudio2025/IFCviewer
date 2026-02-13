import React, { useRef, useEffect, useState } from "react";
import { Viewer } from "./core/Viewer";
import { ControlPanel } from "./ui/ControlPanel";

const App: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewer, setViewer] = useState<Viewer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (viewer) return; // ✅ Prevent multiple instances

    const v = Viewer.getInstance(containerRef.current); // Singleton
    setViewer(v);
  }, [viewer]);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {viewer && <ControlPanel viewer={viewer} />}
    </div>
  );
};

export default App;