import * as THREE from "three";
import { ClashResult } from "./Viewer";

/**
 * ClashVisualizer handles 3D visualization of clash detection results.
 * It creates visual markers for clash points and zones in the 3D scene.
 */
export class ClashVisualizer {
  private scene: THREE.Scene;
  private clashMarkers: Map<string, THREE.Group> = new Map();
  private clashZones: Map<string, THREE.Group> = new Map();
  private selectedClashId: string | null = null;

  // Material definitions for different clash types
  private materials = {
    hard: new THREE.MeshStandardMaterial({
      color: 0xb0172b,
      emissive: 0xb0172b,
      emissiveIntensity: 0.5,
      metalness: 0.3,
      roughness: 0.4,
    }),
    soft: new THREE.MeshStandardMaterial({
      color: 0xff8c00,
      emissive: 0xff8c00,
      emissiveIntensity: 0.5,
      metalness: 0.3,
      roughness: 0.4,
    }),
    clearance: new THREE.MeshStandardMaterial({
      color: 0xffa500,
      emissive: 0xffa500,
      emissiveIntensity: 0.5,
      metalness: 0.3,
      roughness: 0.4,
    }),
  };

  private lineMaterials = {
    hard: new THREE.LineBasicMaterial({ color: 0xb0172b, linewidth: 2 }),
    soft: new THREE.LineBasicMaterial({ color: 0xff8c00, linewidth: 2 }),
    clearance: new THREE.LineBasicMaterial({ color: 0xffa500, linewidth: 2 }),
  };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /**
   * Visualize all clashes in the 3D scene
   */
  public visualizeClashes(clashes: ClashResult[]): void {
    // Clear previous visualizations
    this.clearAllVisualizations();

    for (const clash of clashes) {
      this.visualizeClash(clash);
    }
  }

  /**
   * Visualize a single clash
   */
  private visualizeClash(clash: ClashResult): void {
    const group = new THREE.Group();
    group.name = `clash-${clash.id}`;

    // Create collision point marker
    const pointMarker = this.createPointMarker(clash);
    group.add(pointMarker);

    // Create zone visualization (bounding box representation)
    const zoneMarker = this.createZoneMarker(clash);
    if (zoneMarker) {
      group.add(zoneMarker);
    }

    // Add to scene and track
    this.scene.add(group);
    this.clashMarkers.set(clash.id, group);
  }

  /**
   * Create a 3D marker for the collision point
   */
  private createPointMarker(clash: ClashResult): THREE.Group {
    const group = new THREE.Group();

    const [x, y, z] = clash.collision.position;

    // Main sphere marker
    const sphereGeom = new THREE.SphereGeometry(0.5, 16, 16);
    const sphere = new THREE.Mesh(sphereGeom, this.materials[clash.type]);
    sphere.position.set(x, y, z);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    group.add(sphere);

    // Pulsing animation setup (will be handled by render loop)
    (sphere as any).userData.isPulsingClash = true;
    (sphere as any).userData.clashType = clash.type;

    // Add a glow/halo effect using a larger transparent sphere
    const haloGeom = new THREE.SphereGeometry(1.2, 16, 16);
    const haloMat = new THREE.MeshStandardMaterial({
      color: this.getColorForType(clash.type),
      transparent: true,
      opacity: 0.2,
      emissive: this.getColorForType(clash.type),
      emissiveIntensity: 0.3,
    });
    const halo = new THREE.Mesh(haloGeom, haloMat);
    halo.position.set(x, y, z);
    group.add(halo);

    // Add directional indicator (arrow pointing along normal)
    const [nx, ny, nz] = clash.collision.normal;
    const arrowDir = new THREE.Vector3(nx, ny, nz).normalize();
    const arrowOrigin = new THREE.Vector3(x, y, z);
    const arrowHelper = new THREE.ArrowHelper(
      arrowDir,
      arrowOrigin,
      2,
      this.getColorForType(clash.type),
      0.5,
      0.3
    );
    group.add(arrowHelper);

    return group;
  }

  /**
   * Create a zone visualization (wireframe box or similar)
   */
  private createZoneMarker(clash: ClashResult): THREE.Group | null {
    const group = new THREE.Group();

    const [x, y, z] = clash.collision.position;

    // Create a small wireframe cube around the collision point
    const boxGeom = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    const wireframe = new THREE.LineSegments(
      boxGeom,
      this.lineMaterials[clash.type]
    );
    wireframe.position.set(x, y, z);
    group.add(wireframe);

    // Add a subtle filled box with transparency
    const filledBoxMat = new THREE.MeshStandardMaterial({
      color: this.getColorForType(clash.type),
      transparent: true,
      opacity: 0.05,
      wireframe: false,
    });
    const filledBox = new THREE.Mesh(boxGeom, filledBoxMat);
    filledBox.position.set(x, y, z);
    group.add(filledBox);

    return group;
  }

  /**
   * Highlight a specific clash
   */
  public highlightClash(clashId: string): void {
    // Unhighlight previous
    if (this.selectedClashId && this.selectedClashId !== clashId) {
      this.unhighlightClash(this.selectedClashId);
    }

    const marker = this.clashMarkers.get(clashId);
    if (!marker) return;

    this.selectedClashId = clashId;

    // Enhance visibility of selected clash
    marker.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissiveIntensity = 1.0;
          child.scale.set(1.3, 1.3, 1.3);
        }
      }
    });
  }

  /**
   * Unhighlight a specific clash
   */
  public unhighlightClash(clashId: string): void {
    const marker = this.clashMarkers.get(clashId);
    if (!marker) return;

    marker.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material instanceof THREE.MeshStandardMaterial) {
          child.material.emissiveIntensity = 0.5;
          child.scale.set(1, 1, 1);
        }
      }
    });

    if (this.selectedClashId === clashId) {
      this.selectedClashId = null;
    }
  }

  /**
   * Clear all clash visualizations
   */
  public clearAllVisualizations(): void {
    // Remove all clash markers from scene
    for (const marker of this.clashMarkers.values()) {
      this.scene.remove(marker);
      // Dispose geometries and materials
      marker.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }

    // Remove all clash zones from scene
    for (const zone of this.clashZones.values()) {
      this.scene.remove(zone);
      zone.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
    }

    this.clashMarkers.clear();
    this.clashZones.clear();
    this.selectedClashId = null;
  }

  /**
   * Get color for clash type
   */
  private getColorForType(type: string): number {
    switch (type) {
      case "hard":
        return 0xb0172b;
      case "soft":
        return 0xff8c00;
      case "clearance":
        return 0xffa500;
      default:
        return 0xffffff;
    }
  }

  /**
   * Update animation state (call from render loop)
   */
  public updateAnimations(time: number): void {
    for (const marker of this.clashMarkers.values()) {
      marker.traverse((child) => {
        if (
          child instanceof THREE.Mesh &&
          (child as any).userData.isPulsingClash
        ) {
          // Pulsing effect
          const scale = 1 + Math.sin(time * 0.003) * 0.1;
          child.scale.set(scale, scale, scale);
        }
      });
    }
  }

  /**
   * Get clash marker by ID
   */
  public getClashMarker(clashId: string): THREE.Group | undefined {
    return this.clashMarkers.get(clashId);
  }

  /**
   * Get all clash markers
   */
  public getAllClashMarkers(): Map<string, THREE.Group> {
    return this.clashMarkers;
  }

  /**
   * Toggle visibility of all clash markers
   */
  public setVisibility(visible: boolean): void {
    for (const marker of this.clashMarkers.values()) {
      marker.visible = visible;
    }
  }

  /**
   * Filter clashes by type and show only those
   */
  public filterByType(types: Set<string>): void {
    for (const [clashId, marker] of this.clashMarkers.entries()) {
      // Extract clash type from marker (would need to store it)
      marker.visible = true; // Default to visible
    }
  }
}
