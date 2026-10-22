// The evolution plot (SPEC 7.16): the scene inside the 3D canvas. The layout is evolution.ts.
// - One instanced mesh for each kind of node (fast for thousands of nodes). Nodes move to new places smoothly when the
//   depth or the layout changes.
// - Lines: made-from links (warm) and nesting links (gray), one line buffer each; the lineage of the selected node is
//   bright, the rest fades.
// - Labels are DOM elements over the canvas (as in GalaxyView): the generations always; nodes on hover and in the
//   selected lineage. A click selects a node; Escape (or a click on empty space: the canvas) clears.

import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef, type RefObject } from "react";
import { BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedMesh, Object3D, Vector3 } from "three";
import type { Id } from "../../core/types";
import { lineageOf, type Evolution, type EvolutionKind, type EvolutionLayout, type EvolutionNode } from "./evolution";

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;

/** Colors of the kinds: readable on the light and the dark board background. */
const KIND_COLORS: Record<EvolutionKind, string> = { board: "#6d8cff", map: "#a07cf0", group: "#4a90ff", note: "#e0b400", page: "#a3abbd", link: "#e05d5d", small: "#3fb6ac" };
const KIND_SIZE: Record<EvolutionKind, number> = { board: 0.9, map: 0.9, group: 0.75, note: 0.32, page: 0.34, link: 0.34, small: 0.26 };
const KINDS = Object.keys(KIND_COLORS) as EvolutionKind[];
const MADE_COLOR = "#ff9f43";
const STALE_COLOR = "#ff7a45";

type Props = {
  evolution: Evolution;
  layout: EvolutionLayout;
  background: string;
  nestColor: string;
  labelLayer: RefObject<HTMLDivElement | null>;
  selected: Id | null;
  onSelect(id: Id | null): void;
  generationLabel(generation: number, count: number): string;
};

export function EvolutionScene({ evolution, layout, background, nestColor, labelLayer, selected, onSelect, generationLabel }: Props) {
  const { camera, size } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const byKind = useMemo(() => new Map(KINDS.map((kind) => [kind, evolution.nodes.filter((node) => node.kind === kind)])), [evolution]);
  const meshes = useRef(new Map<EvolutionKind, InstancedMesh>());
  // Current places (they move to the target places): node ID -> position.
  const current = useRef(new Map<Id, Vector3>());
  const lineage = useMemo(() => (selected === null || !evolution.nodes.some((node) => node.id === selected) ? null : lineageOf(evolution, selected)), [evolution, selected]);

  // Frame the whole plot when the layout changes (a new set of layers).
  const frameKey = `${evolution.layers.length}:${evolution.layers[0]?.center.join(",")}:${evolution.layers.at(-1)?.center.join(",")}`;
  useLayoutEffect(() => {
    if (evolution.nodes.length === 0) return;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const node of evolution.nodes) {
      const point = new Vector3(...node.position);
      min.min(point);
      max.max(point);
    }
    const center = min.clone().add(max).multiplyScalar(0.5);
    const extent = Math.max(10, max.distanceTo(min));
    const direction = layout === "walls" ? new Vector3(0.15, 0.35, 1) : new Vector3(1, 0.35, 0.9);
    camera.position.copy(center).add(direction.normalize().multiplyScalar(extent * 0.85));
    camera.lookAt(center);
    controls.current?.target.copy(center);
    controls.current?.update();
  }, [frameKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape clears the lineage.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onSelect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSelect]);

  // Instance colors: bright in the lineage (or with no selection), faded toward the background otherwise.
  useEffect(() => {
    const faded = new Color(background);
    for (const kind of KINDS) {
      const mesh = meshes.current.get(kind);
      if (mesh === undefined) continue;
      const base = new Color(KIND_COLORS[kind]);
      byKind.get(kind)!.forEach((node, index) => mesh.setColorAt(index, lineage === null || lineage.has(node.id) ? base : base.clone().lerp(faded, 0.82)));
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
    }
  }, [byKind, lineage, background]);

  const lines = useMemo(() => {
    const made = evolution.edges.filter((edge) => edge.kind === "made");
    const nest = evolution.edges.filter((edge) => edge.kind === "nest");
    const hot = lineage === null ? [] : evolution.edges.filter((edge) => lineage.has(edge.from) && lineage.has(edge.to));
    const geometry = (count: number) => {
      const value = new BufferGeometry();
      value.setAttribute("position", new BufferAttribute(new Float32Array(Math.max(1, count) * 6), 3));
      value.setDrawRange(0, count * 2);
      return value;
    };
    return { made, nest, hot, madeGeometry: geometry(made.length), nestGeometry: geometry(nest.length), hotGeometry: geometry(hot.length) };
  }, [evolution, lineage]);
  useEffect(() => () => [lines.madeGeometry, lines.nestGeometry, lines.hotGeometry].forEach((geometry) => geometry.dispose()), [lines]);

  // Labels: the generations, and the nodes in the lineage (at most 80) or under the pointer.
  const hovered = useRef<Id | null>(null);
  const labelElements = useRef(new Map<string, HTMLDivElement>());
  const wanted = useMemo(() => {
    const list: { key: string; text: string; className: string; at: () => Vector3 | null }[] = evolution.layers.map((layer) => ({
      key: `layer:${layer.generation}`,
      text: generationLabel(layer.generation, layer.count),
      className: "galaxy-label evolution-layer",
      at: () => new Vector3(...layer.anchor),
    }));
    if (lineage !== null) {
      for (const node of evolution.nodes.filter((other) => lineage.has(other.id)).slice(0, 80)) {
        list.push({ key: node.id, text: node.label, className: `galaxy-label${node.id === selected ? " evolution-selected" : ""}`, at: () => current.current.get(node.id) ?? null });
      }
    }
    return list;
  }, [evolution, lineage, selected, generationLabel]);
  const nodeById = useMemo(() => new Map(evolution.nodes.map((node) => [node.id, node])), [evolution]);
  useEffect(() => {
    const layer = labelLayer.current;
    if (layer === null) return;
    const keys = new Set(wanted.map((entry) => entry.key));
    for (const [key, element] of labelElements.current) {
      if (keys.has(key) || key === "hover") continue;
      element.remove();
      labelElements.current.delete(key);
    }
    for (const entry of wanted) {
      let element = labelElements.current.get(entry.key);
      if (element === undefined) {
        element = document.createElement("div");
        element.dir = "auto";
        layer.appendChild(element);
        labelElements.current.set(entry.key, element);
      }
      element.className = entry.className;
      element.textContent = entry.text;
    }
  }, [wanted, labelLayer]);
  useEffect(() => {
    const elements = labelElements.current;
    return () => {
      for (const element of elements.values()) element.remove();
      elements.clear();
    };
  }, []);

  const dummy = useMemo(() => new Object3D(), []);
  const projected = useMemo(() => new Vector3(), []);
  useFrame((_state, delta) => {
    const ease = 1 - Math.exp(-delta * 4);
    const target = new Vector3();
    for (const node of evolution.nodes) {
      target.set(...node.position);
      const point = current.current.get(node.id);
      if (point === undefined) current.current.set(node.id, target.clone());
      else point.lerp(target, ease);
    }
    for (const kind of KINDS) {
      const mesh = meshes.current.get(kind);
      if (mesh === undefined) continue;
      byKind.get(kind)!.forEach((node, index) => {
        dummy.position.copy(current.current.get(node.id)!);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    const write = (geometry: BufferGeometry, edges: readonly { from: Id; to: Id }[]) => {
      const array = geometry.getAttribute("position").array as Float32Array;
      edges.forEach((edge, index) => {
        const a = current.current.get(edge.from);
        const b = current.current.get(edge.to);
        if (a === undefined || b === undefined) return;
        array.set([a.x, a.y, a.z, b.x, b.y, b.z], index * 6);
      });
      geometry.getAttribute("position").needsUpdate = true;
      geometry.computeBoundingSphere();
    };
    write(lines.madeGeometry, lines.made);
    write(lines.nestGeometry, lines.nest);
    write(lines.hotGeometry, lines.hot);
    // Labels follow their points.
    const place = (element: HTMLDivElement, point: Vector3 | null, below: number) => {
      if (point === null) {
        element.style.display = "none";
        return;
      }
      projected.copy(point).project(camera);
      const visible = projected.z < 1;
      element.style.display = visible ? "" : "none";
      if (visible) element.style.transform = `translate(-50%, 0) translate(${((projected.x + 1) / 2) * size.width}px, ${((1 - projected.y) / 2) * size.height + below}px)`;
    };
    for (const entry of wanted) {
      const element = labelElements.current.get(entry.key);
      if (element !== undefined) place(element, entry.at(), entry.key.startsWith("layer:") ? -24 : 12);
    }
    const hover = labelElements.current.get("hover");
    if (hover !== undefined) {
      const node = hovered.current === null ? undefined : nodeById.get(hovered.current);
      if (node === undefined || lineage?.has(node.id) === true) hover.style.display = "none";
      else place(hover, current.current.get(node.id) ?? null, 12);
    }
  });

  const pick = (kind: EvolutionKind) => (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    const node = event.instanceId === undefined ? undefined : byKind.get(kind)![event.instanceId];
    if (node !== undefined) onSelect(node.id);
  };
  const hover = (kind: EvolutionKind) => (event: ThreeEvent<PointerEvent>) => {
    const node: EvolutionNode | undefined = event.instanceId === undefined ? undefined : byKind.get(kind)![event.instanceId];
    hovered.current = node?.id ?? null;
    const layer = labelLayer.current;
    if (layer === null) return;
    let element = labelElements.current.get("hover");
    if (element === undefined) {
      element = document.createElement("div");
      element.className = "galaxy-label";
      element.dir = "auto";
      layer.appendChild(element);
      labelElements.current.set("hover", element);
    }
    element.textContent = node === undefined ? "" : node.label || "…";
  };

  const outdated = evolution.nodes.filter((node) => node.outdated);
  return (
    <>
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} minDistance={1} maxDistance={1200} />
      {KINDS.map((kind) => {
        const nodes = byKind.get(kind)!;
        if (nodes.length === 0) return null;
        const flat = kind === "note" || kind === "page" || kind === "link" || kind === "small";
        return (
          <instancedMesh
            key={`${kind}:${nodes.length}`}
            ref={(mesh) => {
              if (mesh === null) meshes.current.delete(kind);
              else meshes.current.set(kind, mesh);
            }}
            args={[undefined, undefined, nodes.length]}
            onClick={pick(kind)}
            onPointerMove={hover(kind)}
            onPointerOut={() => {
              hovered.current = null;
            }}
          >
            {flat ? <boxGeometry args={[KIND_SIZE[kind] * 1.6, KIND_SIZE[kind] * 1.3, KIND_SIZE[kind] * 0.25]} /> : <sphereGeometry args={[KIND_SIZE[kind], 20, 14]} />}
            <meshStandardMaterial emissiveIntensity={0.25} roughness={0.6} />
          </instancedMesh>
        );
      })}
      <lineSegments geometry={lines.madeGeometry}>
        <lineBasicMaterial color={MADE_COLOR} transparent opacity={lineage === null ? 0.45 : 0.08} />
      </lineSegments>
      <lineSegments geometry={lines.nestGeometry}>
        <lineBasicMaterial color={nestColor} transparent opacity={lineage === null ? 0.3 : 0.05} />
      </lineSegments>
      <lineSegments geometry={lines.hotGeometry}>
        <lineBasicMaterial color={MADE_COLOR} transparent opacity={0.95} />
      </lineSegments>
      {outdated.map((node) => (
        <StaleRing key={node.id} node={node} current={current} />
      ))}
      {evolution.layers.map((layer) => (
        <mesh key={layer.generation} position={layer.center} rotation={layout === "walls" ? [0, Math.PI / 2, 0] : [Math.PI / 2, 0, 0]}>
          <circleGeometry args={[layer.radius, 48]} />
          <meshBasicMaterial color="#8fb0ff" transparent opacity={0.05} side={DoubleSide} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

/** An orange ring around an outdated node: a source changed since it was made. It faces the camera. */
function StaleRing({ node, current }: { node: EvolutionNode; current: RefObject<Map<Id, Vector3>> }) {
  const ref = useRef<Object3D>(null);
  const { camera } = useThree();
  useFrame(() => {
    const point = current.current?.get(node.id);
    if (ref.current === null || point === undefined) return;
    ref.current.position.copy(point);
    ref.current.lookAt(camera.position);
  });
  return (
    <mesh ref={ref}>
      <torusGeometry args={[KIND_SIZE[node.kind] * 1.7, 0.06, 8, 40]} />
      <meshBasicMaterial color={STALE_COLOR} />
    </mesh>
  );
}
