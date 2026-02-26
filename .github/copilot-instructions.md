# IFC Viewer - AI Coding Guidelines

## Architecture Overview
This is a React-based IFC (Industry Foundation Classes) model viewer using Open BIM Components (@thatopen/components) for 3D visualization. The app loads IFC files, converts them to fragments, and renders them in a Three.js scene.

**Core Components:**
- `Viewer` (singleton class in `src/core/Viewer.ts`): Manages IFC loading, scene setup, and model operations
- `ControlPanel` (`src/ui/ControlPanel.tsx`): Multi-tab UI for file upload, model management, property inspection, compliance checks, and AI assistance
- Uses web workers (`public/worker.mjs`) and WASM (`public/wasm/`) for IFC processing

**Data Flow:**
1. IFC files loaded via `viewer.loadIfcFromFile(file)` → `ifcLoader.load()` 
2. Converted to fragments and added to `fragments.list`
3. Rendered in Three.js scene via `world.scene.three.add(model.object)`

## Key Patterns
- **Singleton Viewer**: Always use `Viewer.getInstance(container)` instead of `new Viewer()`
- **Async Initialization**: Call `await viewer.ensureReady()` before operations
- **Model Management**: Models identified by string IDs, stored in `fragments.list`
- **Compliance Rules**: JSON-based rules with conditions on IFC properties (see `ComplianceRule` interface)
- **Clash Detection**: Object-level bounding box intersection with hard/soft/clearance types using individual IFC item bounds when available
- **Advanced Filtering**: Select specific models, IFC classes, or filter by properties before clash detection
- **Granular Object Selection**: Choose individual objects from models by IFC class and properties before clash detection
- **Clash Management**: Isolate clashing fragments, color them, save viewports, export XLS reports
- **Event Callbacks**: Set `viewer.onSelectObject` and `viewer.onModelsChanged` for UI updates

## Development Workflow
- **Start dev server**: `npm run dev` (Vite with HMR)
- **Build**: `npm run build` (outputs to `dist/`)
- **Lint**: `npm run lint` (ESLint with React rules)
- **Preview build**: `npm run preview`

## Code Conventions
- **TypeScript strict mode**: Full type safety required
- **React functional components**: Use hooks, avoid class components
- **Async/await**: Preferred over Promises for all async operations
- **Error handling**: Use try/catch in async functions, propagate errors appropriately
- **File structure**: Core logic in `src/core/`, UI components in `src/ui/`, assets in `src/assets/`

## Common Tasks
- **Add new viewer feature**: Extend `Viewer` class methods, update `ControlPanel` tabs if needed
- **Modify compliance checks**: Update `ComplianceRule` interface and validation logic in `Viewer.runComplianceCheck()`
- **Add UI controls**: Create new tab in `ControlPanel`, use React state for local data
- **Handle model events**: Listen to `fragments.list.onItemSet` / `onBeforeDelete` for model lifecycle
- **Implement clash detection**: Use `viewer.runClashDetection(tolerance, clearance, filters)` with object-level bounding box intersection
- **Extract model objects**: Use `viewer.getModelObjects(modelId)` to get IFC objects with properties for selection
- **Manage clash results**: Use `isolateClashingObjects()`, `colorClashingObjects()`, save/load viewports, export XLS reports

## Dependencies
- **@thatopen/components**: Core IFC viewing library (FragmentsManager, IfcLoader, etc.)
- **Three.js**: 3D rendering engine
- **React 19**: UI framework with modern hooks
- **Vite**: Build tool with fast dev server

## Gotchas
- IFC loading is asynchronous and resource-intensive; always await operations
- Model IDs are auto-generated strings; use `fragments.list.keys()` to enumerate
- WASM files must be served from `/wasm/` path (configured in `ifcLoader.setup()`)
- Compliance checks run on all loaded models; results include per-model and per-rule statistics
- Clash detection requires at least 2 models loaded and uses tolerance/clearance parameters
- Clash filtering can reduce detection scope to specific models/classes/properties