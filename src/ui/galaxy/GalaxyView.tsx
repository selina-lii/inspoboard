// Galaxy view (3D). This is the three.js adapter. See docs/SPEC.md section 7.3.
// - Left drag on empty space rotates. Right drag pans. Scroll or pinch zooms.
// - Drag a dot to move it. The move is one command when you release it.
// - Double-click a dot to zoom into it.
// Labels are plain DOM elements above the canvas. A frame callback moves them to the
// screen position of their dot. (drei <Html> makes one React root per label. That fails
// when labels mount and unmount quickly.)

import { useShownTheme } from "../app/theme";
import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ComponentRef, type MutableRefObject, type RefObject } from "react";
import { Plane, Quaternion, Vector3 } from "three";
import { setPlacement3d } from "../../core/actions";
import { useBoardBackground } from "../app/vaultImages";
import type { Id, Point3 } from "../../core/types";
import { usePinchZoom, type PinchHandler } from "../app/gestures";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import { useWorkspaceActions } from "../app/workspaceActions";
import { groupColor } from "../app/colors";
import { boardToWorld, buildGalaxyModel, UNITS_PER_3D, worldToPlacement, type GalaxyLine, type GalaxyModel, type GalaxyPoint } from "./galaxyModel";
import "./galaxy.css";

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;
type CameraApi = { dolly(zoom: number): void; begin(): number };

const MIN_DISTANCE = 1;
const MAX_DISTANCE = 200;

type Colors = {
  background: string;
  item: string;
  note: string;
  page: string;
  text: string;
  ghost: string;
  stamp: string;
  line: string;
  cluster: string;
  selected: string;
};

function readColors(): Colors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    background: read("--bg-board"),
    item: read("--accent"),
    note: read("--note-bg"),
    page: read("--page-bg"),
    text: read("--text"),
    ghost: read("--text-faint"),
    stamp: read("--text-muted"),
    line: read("--edge"),
    cluster: read("--border-strong"),
    selected: read("--text"),
  };
}

export function GalaxyView({ boardId }: { boardId: Id }) {
  const session = useSession();
  const revision = useStoreRevision();
  const model = useMemo(
    () => buildGalaxyModel(session.store, session.graph, boardId),
    // The revision changes after each store write. It is a dependency on purpose.
    [session, boardId, revision],
  );
  // The board background, as in 2D: a color behind all, or an image that lies on the plane of the board (under the cards).
  const { settings } = useSessionState();
  // The colors come from the theme tokens. Read them again after a change of light / dark (the workspace sets the
  // theme in a layout effect: it is on the root element before this effect).
  const shownTheme = useShownTheme(settings.theme);
  const [colors, setColors] = useState(readColors);
  useEffect(() => setColors(readColors()), [shownTheme]);
  const ownBackground = session.store.get("items", boardId)?.background;
  const background = useBoardBackground(session, ownBackground ?? settings.defaultBackground);
  const backgroundColor = background?.kind === "color" ? background.color : colors.background;
  // A background image stays still: it fills the view behind the 3D scene (the canvas is clear there).
  const fixedStyle = background?.kind === "image" ? { backgroundImage: `url("${background.url}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined;
  const wrapper = useRef<HTMLDivElement>(null);
  const camera = useRef<CameraApi | null>(null);
  const labels = useRef(new Map<Id, HTMLDivElement>());
  const [hovered, setHovered] = useState<Id | null>(null);

  const pinch = useMemo<PinchHandler>(
    () => ({ begin: () => camera.current?.begin() ?? 1, change: (zoom) => camera.current?.dolly(zoom) }),
    [],
  );
  usePinchZoom(wrapper, pinch);

  return (
    <div ref={wrapper} className="galaxy" style={fixedStyle}>
      <Canvas camera={{ position: [0, 0, 12], fov: 50 }} onContextMenu={(event) => event.preventDefault()}>
        {fixedStyle === undefined && <color attach="background" args={[backgroundColor]} />}
        <ambientLight intensity={0.8} />
        <pointLight position={[10, 10, 10]} intensity={60} />
        <Scene key={boardId} model={model} colors={colors} cameraApi={camera} labels={labels} hovered={hovered} setHovered={setHovered} />
      </Canvas>
      <div className="galaxy-labels">
        {model.points
          // A note with no name shows a label only on hover: then the start of its text.
          .filter((point) => (point.depth === 1 && point.label !== "") || point.key === hovered)
          .map((point) => (
            <div
              key={point.key}
              ref={(element) => {
                if (element === null) labels.current.delete(point.key);
                else labels.current.set(point.key, element);
              }}
              dir="auto"
              className={`galaxy-label depth-${point.depth}${point.kind === "ghost" ? " ghost" : ""}${point.kind === "group" ? ` group ${point.groupType}` : ""}${point.codeName ? " code-name" : ""}`}
            >
              {point.key === hovered ? point.hoverLabel : point.label}
              {point.kind === "group" && point.groupType === "calendar" && <span className="galaxy-count">{`${point.days} days`}</span>}
              {point.kind !== "group" && point.childCount > 0 && <span className="galaxy-count">{point.childCount}</span>}
              {/* An outline lists its rows like a tree when the pointer is on it. */}
              {point.kind === "group" && point.key === hovered && point.tree.length > 0 && (
                <ul className="galaxy-tree">
                  {point.tree.slice(0, 40).map((row, index) => (
                    <li key={index} style={{ paddingLeft: row.depth * 12 }}>
                      {row.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
      </div>
      <div className="galaxy-hint">Drag: rotate · Right drag: pan · Scroll or pinch: zoom · Drag a dot: move it · Double-click: open</div>
    </div>
  );
}

type SceneProps = {
  model: ReturnType<typeof buildGalaxyModel>;
  colors: Colors;
  cameraApi: MutableRefObject<CameraApi | null>;
  labels: MutableRefObject<Map<Id, HTMLDivElement>>;
  hovered: Id | null;
  setHovered(update: (current: Id | null) => Id | null): void;
};

function Scene({ model, colors, cameraApi, labels, hovered, setHovered }: SceneProps) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  /** Live positions while a dot moves. The store changes only when the drag ends. */
  const [dragging, setDragging] = useState<{ key: Id; position: Point3 } | null>(null);

  useEffect(() => {
    let startDistance = 1;
    cameraApi.current = {
      begin: () => {
        const target = controls.current?.target ?? new Vector3();
        startDistance = camera.position.distanceTo(target);
        return 1;
      },
      dolly: (zoom) => {
        const target = controls.current?.target ?? new Vector3();
        const distance = Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, startDistance / zoom));
        const direction = camera.position.clone().sub(target).normalize();
        camera.position.copy(target.clone().add(direction.multiplyScalar(distance)));
        controls.current?.update();
      },
    };
    return () => {
      cameraApi.current = null;
    };
  }, [camera, cameraApi]);

  // Look at the center of the board contents.
  useEffect(() => {
    const top = model.points.filter((point) => point.depth === 1);
    if (top.length === 0 || controls.current === null) return;
    const center = new Vector3();
    for (const point of top) center.add(new Vector3(...point.position));
    center.divideScalar(top.length);
    const offset = camera.position.clone().sub(controls.current.target);
    controls.current.target.copy(center);
    camera.position.copy(center.clone().add(offset));
    controls.current.update();
    // Only when the scene opens. Later model changes must not move the camera.
  }, []);

  const positionOf = (point: GalaxyPoint): Point3 => (dragging?.key === point.key ? dragging.position : point.position);
  const pointByKey = new Map(model.points.map((point) => [point.key, point]));
  const live = new Map(model.points.map((point) => [point.key, positionOf(point)]));

  // Move each label to the screen position of its dot, below the dot.
  const projected = useRef(new Vector3());
  useFrame(() => {
    for (const point of model.points) {
      const element = labels.current.get(point.key);
      if (element === undefined) continue;
      const [x, y, z] = live.get(point.key) ?? point.position;
      projected.current.set(x, y, z).project(camera);
      const visible = projected.current.z < 1;
      element.style.display = visible ? "" : "none";
      if (!visible) continue;
      const left = ((projected.current.x + 1) / 2) * size.width;
      const top = ((1 - projected.current.y) / 2) * size.height;
      element.style.transform = `translate(-50%, 0) translate(${left}px, ${top + (point.depth === 1 ? 14 : 8)}px)`;
    }
  });
  const moved = (position: Point3): Point3 => {
    // Lines follow a dragged dot: they share the position array of the model.
    for (const point of model.points) if (point.position === position) return live.get(point.key) ?? position;
    return position;
  };

  return (
    <>
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} minDistance={MIN_DISTANCE} maxDistance={MAX_DISTANCE} />
      {model.lines.map((line) => (
        <Line
          key={line.key}
          points={[moved(line.from), moved(line.to)]}
          color={line.kind === "cluster" ? colors.cluster : line.group !== undefined ? groupColor(line.group) : colors.line}
          lineWidth={line.kind === "cluster" ? 0.6 : 1.2}
          dashed={line.kind === "cluster"}
          dashSize={0.12}
          gapSize={0.08}
          transparent
          opacity={line.kind === "cluster" ? 0.5 : 0.9}
        />
      ))}
      {model.lines.map((line) => {
        if (line.kind !== "relation") return null;
        const from = moved(line.from);
        const to = moved(line.to);
        const color = line.group !== undefined ? groupColor(line.group) : colors.line;
        return (
          <group key={`caps:${line.key}`}>
            {isArrow(line.end) && <ArrowHead from={from} to={to} gap={radiusOf(pointByKey.get(line.toKey))} color={color} open={line.end === "open-arrow"} />}
            {isArrow(line.start) && <ArrowHead from={to} to={from} gap={radiusOf(pointByKey.get(line.fromKey))} color={color} open={line.start === "open-arrow"} />}
          </group>
        );
      })}
      {model.points.map((point) => (
        <Dot
          key={point.key}
          point={point}
          position={positionOf(point)}
          colors={colors}
          hovered={hovered === point.key}
          onHover={(on) => setHovered((current) => (on ? point.key : current === point.key ? null : current))}
          controls={controls}
          onDrag={(position) => setDragging(position === null ? null : { key: point.key, position })}
        />
      ))}
    </>
  );
}

type DotProps = {
  point: GalaxyPoint;
  position: Point3;
  colors: Colors;
  hovered: boolean;
  onHover(on: boolean): void;
  controls: RefObject<OrbitControlsImpl | null>;
  onDrag(position: Point3 | null): void;
};

function Dot({ point, position, colors, hovered, onHover, controls, onDrag }: DotProps) {
  const session = useSession();
  const { readOnly } = useSessionState();
  const runCommand = useRunCommand();
  const actions = useWorkspaceActions();
  const { camera } = useThree();
  const drag = useRef<{ plane: Plane; offset: Vector3; last: Point3 } | null>(null);
  const radius = radiusOf(point);
  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    // A group point comes from its cards: it does not move by itself.
    if (event.button !== 0 || readOnly || point.kind === "group") return;
    event.stopPropagation();
    (event.target as unknown as Element).setPointerCapture(event.pointerId);
    if (controls.current !== null) controls.current.enabled = false;
    const normal = camera.getWorldDirection(new Vector3()).negate();
    const origin = new Vector3(...position);
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, origin);
    const hit = event.ray.intersectPlane(plane, new Vector3()) ?? origin.clone();
    drag.current = { plane, offset: origin.clone().sub(hit), last: position };
  };
  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (drag.current === null) return;
    event.stopPropagation();
    const hit = event.ray.intersectPlane(drag.current.plane, new Vector3());
    if (hit === null) return;
    const next = hit.add(drag.current.offset);
    drag.current.last = [next.x, next.y, next.z];
    onDrag(drag.current.last);
  };
  const onPointerUp = (event: ThreeEvent<PointerEvent>) => {
    if (drag.current === null) return;
    event.stopPropagation();
    const final = drag.current.last;
    drag.current = null;
    if (controls.current !== null) controls.current.enabled = true;
    onDrag(null);
    if (final !== point.position) {
      runCommand(setPlacement3d(session.context, new Map([[point.placeId, worldToPlacement(point, final)]])));
    }
  };

  return (
    <group position={position}>
      <mesh
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerOver={(event) => (event.stopPropagation(), onHover(true))}
        onPointerOut={() => onHover(false)}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (point.kind === "stamp" || point.kind === "group") return;
          // A note never opens as a page: show it on its board. A reference opens a quick view.
          if (point.isReference) actions.openText(point.recordId);
          else if (point.view === "note" && !point.isBoard) actions.openAt(point.recordId);
          else actions.openRecord(point.recordId);
        }}
      >
        <Shape point={point} radius={radius} colors={colors} hovered={hovered} />
      </mesh>
      {point.kind === "item" && point.isBoard && (
        <mesh rotation={[Math.PI / 2.4, 0, 0]}>
          <torusGeometry args={[radius * 1.7, radius * 0.08, 8, 48]} />
          <meshStandardMaterial color={hovered ? colors.selected : colors.item} emissive={colors.item} emissiveIntensity={0.3} />
        </mesh>
      )}
    </group>
  );
}

/**
 * One shape for each kind, the same as the 2D cards:
 * item with a board = planet (sphere with a ring), note = yellow tile, page = paper sheet,
 * text = small dot, scribble = diamond, ghost = wire sphere.
 */
function Shape({ point, radius, colors, hovered }: { point: GalaxyPoint; radius: number; colors: Colors; hovered: boolean }) {
  const tint = (color: string) => (hovered ? colors.selected : color);
  // Groups (and boards that are one group): an outline is a green book, a calendar a blue calendar.
  if (point.kind === "group" || (point.groupType !== null && !point.isReference)) {
    if (point.groupType === "calendar") {
      return (
        <>
          <boxGeometry args={[radius * 1.9, radius * 1.8, radius * 0.22]} />
          <meshStandardMaterial color={tint(GROUP_COLORS.calendar)} emissive={GROUP_COLORS.calendar} emissiveIntensity={0.35} />
        </>
      );
    }
    return (
      <>
        <boxGeometry args={[radius * 1.4, radius * 1.85, radius * 0.45]} />
        <meshStandardMaterial color={tint(GROUP_COLORS.outline)} emissive={GROUP_COLORS.outline} emissiveIntensity={0.3} />
      </>
    );
  }
  // A reference (the item lives on a different board) is a wire shape, as the dashed card in 2D.
  if (point.kind === "ghost" || point.isReference) {
    return (
      <>
        <sphereGeometry args={[radius, 12, 8]} />
        <meshBasicMaterial color={colors.ghost} wireframe />
      </>
    );
  }
  if (point.kind === "stamp") {
    return (
      <>
        <octahedronGeometry args={[radius * 0.8, 0]} />
        <meshStandardMaterial color={tint(colors.stamp)} />
      </>
    );
  }
  if (point.isBoard) {
    return (
      <>
        <sphereGeometry args={[radius, 32, 20]} />
        <meshStandardMaterial color={tint(colors.item)} emissive={colors.item} emissiveIntensity={0.35} />
      </>
    );
  }
  const object = OBJECT_LOOKS[point.view];
  if (object !== undefined) {
    return (
      <>
        {object.shape === "bubble" ? <sphereGeometry args={[radius * 0.75, 20, 14]} /> : object.shape === "ring" ? <torusGeometry args={[radius * 0.55, radius * 0.2, 10, 28]} /> : <boxGeometry args={[radius * 1.7, radius * 1.15, radius * 0.12]} />}
        <meshStandardMaterial color={tint(object.color)} emissive={object.color} emissiveIntensity={0.35} transparent={point.view === "todo"} opacity={point.view === "todo" ? 0.6 : 1} />
      </>
    );
  }
  if (point.view === "note") {
    return (
      <>
        <boxGeometry args={[radius * 1.8, radius * 1.8, radius * 0.25]} />
        <meshStandardMaterial color={tint(colors.note)} emissive={colors.note} emissiveIntensity={0.2} />
      </>
    );
  }
  if (point.view === "page") {
    return (
      <>
        <boxGeometry args={[radius * 1.5, radius * 2, radius * 0.12]} />
        <meshStandardMaterial color={tint(colors.page)} emissive={colors.page} emissiveIntensity={0.15} />
      </>
    );
  }
  return (
    <>
      <sphereGeometry args={[radius * 0.5, 16, 12]} />
      <meshStandardMaterial color={tint(colors.text)} emissive={colors.text} emissiveIntensity={0.4} />
    </>
  );
}

const GROUP_COLORS = { outline: "#3fbf6a", calendar: "#4a90ff" };

/** Objects: comment = pink bubble, link = blue ring, action item = film, flashcard = cornflower card. */
const OBJECT_LOOKS: Partial<Record<GalaxyPoint["view"], { shape: "bubble" | "ring" | "card"; color: string }>> = {
  comment: { shape: "bubble", color: "#ff2bd6" },
  weblink: { shape: "ring", color: "#2f5fd0" },
  todo: { shape: "card", color: "#f4ff3a" },
  flashcard: { shape: "card", color: "#6495ed" },
  quote: { shape: "card", color: "#e9dfb8" },
};

/** The radius of a dot. Boards with more children are larger. Depth 2 dots and satellites are small. */
export function radiusOf(point: GalaxyPoint | undefined): number {
  if (point === undefined) return 0.16;
  // A calendar grows with the number of days that have cards. An outline with its number of rows.
  if (point.kind === "group") return point.groupType === "calendar" ? 0.2 + Math.min(point.days, 60) * 0.012 : 0.2 + Math.min(point.childCount, 20) * 0.01;
  const size = point.depth === 1 ? 1 : point.satellite ? 0.3 : 0.4;
  return (point.childCount > 0 ? 0.2 + Math.min(point.childCount, 20) * 0.01 : 0.16) * size;
}

function isArrow(cap: GalaxyLine["end"]): boolean {
  return cap === "arrow" || cap === "open-arrow";
}

const UP = new Vector3(0, 1, 0);
const ARROW_LENGTH = 0.22;
const ARROW_RADIUS = 0.08;

/** A cone at the `to` end of a line, just outside the dot, pointing at it. */
function ArrowHead({ from, to, gap, color, open }: { from: Point3; to: Point3; gap: number; color: string; open: boolean }) {
  const start = new Vector3(...from);
  const end = new Vector3(...to);
  const direction = end.clone().sub(start);
  const length = direction.length();
  if (length < gap + ARROW_LENGTH) return null;
  direction.normalize();
  const tip = end.clone().sub(direction.clone().multiplyScalar(gap + 0.02));
  const center = tip.clone().sub(direction.clone().multiplyScalar(ARROW_LENGTH / 2));
  const rotation = new Quaternion().setFromUnitVectors(UP, direction);
  return (
    <mesh position={center} quaternion={rotation}>
      <coneGeometry args={[ARROW_RADIUS, ARROW_LENGTH, 16, 1, open]} />
      <meshBasicMaterial color={color} wireframe={open} />
    </mesh>
  );
}
