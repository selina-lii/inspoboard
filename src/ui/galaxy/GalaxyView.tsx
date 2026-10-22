// Galaxy view (3D). This is the three.js adapter. See docs/SPEC.md section 7.3.
// - Left drag on empty space rotates. Right drag pans. Scroll or pinch zooms.
// - Drag a dot to move it. The move is one command when you release it.
// - Double-click a dot to zoom into it.
// - Right-click a dot of this board: "Delete" takes it off the board (as Delete in 2D; ⌘Z undoes it).
// - Reorient (button): the camera goes back to the front view of the board, at the middle of its cards.
// - Explode (button): a new random spread for the cards that the user did not place (view state, not saved). The dots
//   move to their new places with an animation.
// Labels are plain DOM elements above the canvas. A frame callback moves them to the
// screen position of their dot. (drei <Html> makes one React root per label. That fails
// when labels mount and unmount quickly.)

import { useShownTheme } from "../app/theme";
import { Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Compass, GitBranch, Route, Sparkles, Tag, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type MutableRefObject, type RefObject } from "react";
import { AdditiveBlending, CanvasTexture, DoubleSide, ExtrudeGeometry, Plane, Quaternion, Shape as ThreeShape, ShapeGeometry, Vector2, Vector3 } from "three";
import { buildTour, stopAt, tourTarget, type Tour } from "./tour";
import { removeFromBoard, setGroupFilled, setPlacement3d } from "../../core/actions";
import { ContextMenu, type MenuRequest } from "../app/ContextMenu";
import { useBoardBackground } from "../app/vaultImages";
import type { Id, Point3 } from "../../core/types";
import { usePinchZoom, type PinchHandler } from "../app/gestures";
import { moveOutline } from "../../core/outline";
import { useRunCommand, useSession, useSessionState, useStoreRevision } from "../app/sessionContext";
import { useWorkspaceActions } from "../app/workspaceActions";
import { groupColor } from "../app/colors";
import { buildGalaxyModel, UNITS_PER_3D, worldToPlacement, type GalaxyArea, type GalaxyLine, type GalaxyModel, type GalaxyPoint } from "./galaxyModel";
import { t } from "../i18n/i18n";
import { buildEvolution, type DepthBy, type EvolutionLayout } from "./evolution";
import { EvolutionScene } from "./EvolutionScene";
import { titleOf } from "../board/boardModel";
import "./galaxy.css";

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;
type CameraApi = { dolly(zoom: number): void; begin(): number; reorient(): void };

/** The explode seed of each board (0: the fixed spread). It stays while the app is open. */
const seeds = new Map<Id, number>();
/** Time of the move to new places, and of the camera move of Reorient (ms). */
const ANIMATION_MS = 700;
const ease = (value: number) => 1 - (1 - value) ** 3;

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
  const actions = useWorkspaceActions();
  const revision = useStoreRevision();
  const [seed, setSeed] = useState(() => seeds.get(boardId) ?? 0);
  useEffect(() => setSeed(seeds.get(boardId) ?? 0), [boardId]);
  const model = useMemo(
    () => buildGalaxyModel(session.store, session.graph, boardId, seed),
    // The revision changes after each store write. It is a dependency on purpose.
    [session, boardId, revision, seed],
  );
  const explode = () => {
    const next = Math.floor(Math.random() * 1e9) + 1;
    seeds.set(boardId, next);
    setSeed(next);
  };
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
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  // The tour (a cruising camera, tour.ts). A drag on the view, Esc, or the button ends it. It also runs in Buzzies mode.
  const [touring, setTouring] = useState(false);
  const [tourInfo, setTourInfo] = useState("");
  const endTour = useCallback(() => setTouring(false), []);
  useEffect(() => {
    if (!touring) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setTouring(false);
    const onPointer = (event: PointerEvent) => (event.target as Element | null)?.closest(".galaxy canvas") != null && setTouring(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [touring]);

  // The evolution plot (SPEC 7.16): items in generations. View state: it stays while the app is open.
  const [evolutionOn, setEvolutionOn] = useState(false);
  const [depthBy, setDepthBy] = useState<DepthBy>("both");
  const [evolutionLayout, setEvolutionLayout] = useState<EvolutionLayout>("walls");
  const [nebula, setNebula] = useState(4);
  const [lineageOf, setLineageOf] = useState<Id | null>(null);
  const evolutionLabels = useRef<HTMLDivElement>(null);
  const evolution = useMemo(
    () => (evolutionOn ? buildEvolution(session.store, session.graph, boardId, depthBy, evolutionLayout, nebula) : null),
    // The revision changes after each store write. It is a dependency on purpose.
    [evolutionOn, session, boardId, revision, depthBy, evolutionLayout, nebula], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const generationLabel = useCallback((generation: number, count: number) => t("Generation {0} · {1} items", generation, count), []);
  const selectedNode = evolution?.nodes.find((node) => node.id === lineageOf) ?? null;

  const pinch = useMemo<PinchHandler>(
    () => ({ begin: () => camera.current?.begin() ?? 1, change: (zoom) => camera.current?.dolly(zoom) }),
    [],
  );
  usePinchZoom(wrapper, pinch);

  return (
    <div ref={wrapper} className="galaxy" style={fixedStyle}>
      <Canvas camera={{ position: [0, 0, 12], fov: 50, far: evolution !== null ? 5000 : 2000 }} onContextMenu={(event) => event.preventDefault()} onPointerMissed={() => setLineageOf(null)}>
        {fixedStyle === undefined && <color attach="background" args={[backgroundColor]} />}
        <ambientLight intensity={0.8} />
        <pointLight position={[10, 10, 10]} intensity={60} />
        {evolution !== null ? (
          <EvolutionScene key={`evolution:${boardId}`} evolution={evolution} layout={evolutionLayout} background={backgroundColor} nestColor={colors.cluster} labelLayer={evolutionLabels} selected={lineageOf} onSelect={setLineageOf} generationLabel={generationLabel} />
        ) : (
          <Scene key={boardId} model={model} seed={seed} colors={colors} cameraApi={camera} labels={labels} hovered={hovered} setHovered={setHovered} onMenu={setMenu} touring={touring} onTourEnd={endTour} onTourInfo={setTourInfo} />
        )}
      </Canvas>
      {evolution !== null && <div ref={evolutionLabels} className="galaxy-labels" />}
      <div className="galaxy-labels" hidden={evolution !== null}>
        {model.points
          // A note with no name shows a label only on hover: then the start of its text. "Hide labels": all only on hover.
          .filter((point) => (point.depth === 1 && point.label !== "" && !settings.galaxyHideLabels) || point.key === hovered)
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
      {touring && (
        <div className="galaxy-tour-info" role="status">
          <Route size={13} />
          <span dir="auto" translate="no">{tourInfo}</span>
        </div>
      )}
      {evolution !== null && (
        <div className="galaxy-evolution-bar" role="group" aria-label="Evolution plot">
          <span className="muted">Depth</span>
          <span className="segmented">
            {(["made", "nest", "both"] as const).map((value) => (
              <button key={value} className={depthBy === value ? "active" : ""} aria-pressed={depthBy === value} onClick={() => setDepthBy(value)}>
                {value === "made" ? "Made from" : value === "nest" ? "Nesting" : "Both"}
              </button>
            ))}
          </span>
          <span className="segmented">
            {(["walls", "floors"] as const).map((value) => (
              <button key={value} className={evolutionLayout === value ? "active" : ""} aria-pressed={evolutionLayout === value} onClick={() => setEvolutionLayout(value)}>
                {value === "walls" ? "Walls" : "Floors"}
              </button>
            ))}
          </span>
          <label className="galaxy-evolution-nebula">
            <span className="muted">Nebula</span>
            <input type="range" min={0} max={10} step={0.5} value={nebula} onChange={(event) => setNebula(Number(event.target.value))} />
          </label>
          <span className="muted">{t("{0} items · {1} generations", evolution.nodes.length, evolution.layers.length)}</span>
        </div>
      )}
      {selectedNode !== null && (
        <div className="galaxy-evolution-card" role="status">
          <strong dir="auto" translate="no">{titleOf(session.store, selectedNode.id)}</strong>
          <span className="muted">{t("Generation {0} · made from {1}", selectedNode.generation, selectedNode.sources)}</span>
          {selectedNode.outdated && <span className="galaxy-evolution-stale">A source changed since this was made.</span>}
          {session.store.has("items", selectedNode.id) && <button onClick={() => actions.openText(selectedNode.id)}>Open</button>}
        </div>
      )}
      <div className="galaxy-tools">
        <button
          className={`icon-button${evolutionOn ? " active" : ""}`}
          data-tip={evolutionOn ? "Back to the board in 3D" : "Evolution: items in generations (what they were made from, and nesting)"}
          data-tip-start
          aria-pressed={evolutionOn}
          onClick={() => {
            setTouring(false);
            setLineageOf(null);
            setEvolutionOn((on) => !on);
          }}
        >
          <GitBranch size={16} />
        </button>
        {/* The tools of the board in 3D. The evolution plot has its own bar. */}
        {!evolutionOn && (
          <>
            <button className="icon-button" data-tip="Reorient: front view of the board" data-tip-start onClick={() => camera.current?.reorient()}>
              <Compass size={16} />
            </button>
            <button
              className={`icon-button${touring ? " active" : ""}`}
              data-tip={touring ? "Stop the tour" : "Tour: a cruise through the whole board at one speed (a drag or Esc stops it)"}
              data-tip-start
              aria-pressed={touring}
              onClick={() => {
                setTourInfo("");
                setTouring((on) => !on);
              }}
            >
              <Route size={16} />
            </button>
            <button className="icon-button" data-tip="Explode: a new random spread (cards that you placed stay)" data-tip-start onClick={explode}>
              <Sparkles size={16} />
            </button>
            <button
              className={`icon-button${settings.galaxyHideLabels ? " active" : ""}`}
              data-tip={settings.galaxyHideLabels ? "Show labels" : "Hide labels (a label shows when the pointer is on its dot)"}
              data-tip-start
              aria-pressed={settings.galaxyHideLabels}
              onClick={() => void session.updateSettings({ galaxyHideLabels: !settings.galaxyHideLabels })}
            >
              <Tag size={16} />
            </button>
          </>
        )}
      </div>
      {menu !== null && <ContextMenu request={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

type SceneProps = {
  model: ReturnType<typeof buildGalaxyModel>;
  seed: number;
  colors: Colors;
  cameraApi: MutableRefObject<CameraApi | null>;
  labels: MutableRefObject<Map<Id, HTMLDivElement>>;
  hovered: Id | null;
  setHovered(update: (current: Id | null) => Id | null): void;
  onMenu(request: MenuRequest): void;
  /** The tour (a cruising camera) runs. `onTourInfo`: what the camera shows now (for the line at the top). */
  touring: boolean;
  onTourEnd(): void;
  onTourInfo(text: string): void;
};

/** The color of a link line: its own color, else the color of its group, else the line color of the theme. */
function lineColor(line: GalaxyLine, colors: Colors): string {
  return line.color ?? (line.group !== undefined ? groupColor(line.group) : colors.line);
}

function Scene({ model, seed, colors, cameraApi, labels, hovered, setHovered, onMenu, touring, onTourEnd, onTourInfo }: SceneProps) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, size } = useThree();
  /** Live positions while a dot moves. The store changes only when the drag ends. */
  const [dragging, setDragging] = useState<{ key: Id; position: Point3 } | null>(null);

  // Explode: the dots move from their old places to the new ones. `tween.from`: the old place of each point.
  const shown = useRef(new Map<Id, Point3>());
  const [tween, setTween] = useState<{ from: Map<Id, Point3>; start: number; progress: number } | null>(null);
  const lastSeed = useRef(seed);
  useEffect(() => {
    if (lastSeed.current === seed) return;
    lastSeed.current = seed;
    setTween({ from: new Map(shown.current), start: performance.now(), progress: 0 });
  }, [seed]);
  // Reorient: the camera goes to the front view, in a short move.
  const cameraMove = useRef<{ fromPosition: Vector3; fromTarget: Vector3; toPosition: Vector3; toTarget: Vector3; start: number } | null>(null);

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
      reorient: () => {
        if (controls.current === null) return;
        const target = contentCenter(model);
        const distance = camera.position.distanceTo(controls.current.target);
        cameraMove.current = {
          fromPosition: camera.position.clone(),
          fromTarget: controls.current.target.clone(),
          toPosition: target.clone().add(new Vector3(0, 0, distance)),
          toTarget: target,
          start: performance.now(),
        };
      },
    };
    return () => {
      cameraApi.current = null;
    };
  }, [camera, cameraApi, model]);

  // Look at the center of the board contents.
  useEffect(() => {
    if (!model.points.some((point) => point.depth === 1) || controls.current === null) return;
    const center = contentCenter(model);
    const offset = camera.position.clone().sub(controls.current.target);
    controls.current.target.copy(center);
    camera.position.copy(center.clone().add(offset));
    controls.current.update();
    // Only when the scene opens. Later model changes must not move the camera.
  }, []);

  const positionOf = (point: GalaxyPoint): Point3 => {
    if (dragging?.key === point.key) return dragging.position;
    // The cards of a radial move with its core while it is dragged.
    const core = dragging !== null && point.followKey === dragging.key ? model.points.find((other) => other.key === dragging.key) : undefined;
    if (core !== undefined) return [point.position[0] + dragging!.position[0] - core.position[0], point.position[1] + dragging!.position[1] - core.position[1], point.position[2] + dragging!.position[2] - core.position[2]];
    const from = tween?.from.get(point.key);
    if (tween === null || from === undefined) return point.position;
    const amount = ease(tween.progress);
    const to = point.position;
    return [from[0] + (to[0] - from[0]) * amount, from[1] + (to[1] - from[1]) * amount, from[2] + (to[2] - from[2]) * amount];
  };
  const pointByKey = new Map(model.points.map((point) => [point.key, point]));
  const live = new Map(model.points.map((point) => [point.key, positionOf(point)]));
  shown.current = live;

  // Move each label to the screen position of its dot, below the dot.
  const projected = useRef(new Vector3());
  useFrame(() => {
    const now = performance.now();
    if (tween !== null) {
      const progress = Math.min(1, (now - tween.start) / ANIMATION_MS);
      setTween(progress >= 1 ? null : { ...tween, progress });
    }
    const move = cameraMove.current;
    if (move !== null && controls.current !== null) {
      const amount = ease(Math.min(1, (now - move.start) / ANIMATION_MS));
      camera.position.lerpVectors(move.fromPosition, move.toPosition, amount);
      camera.up.set(0, 1, 0);
      controls.current.target.lerpVectors(move.fromTarget, move.toTarget, amount);
      controls.current.update();
      if (amount >= 1) cameraMove.current = null;
    }
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
      <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} minDistance={MIN_DISTANCE} maxDistance={MAX_DISTANCE} enabled={!touring} />
      {touring && <TourRunner model={model} controls={controls} onEnd={onTourEnd} onInfo={onTourInfo} />}
      {touring && <Glow points={model.points} colors={colors} />}
      {model.lines.map((line) => (
        <Line
          key={line.key}
          points={[moved(line.from), moved(line.to)]}
          color={line.kind === "cluster" ? colors.cluster : lineColor(line, colors)}
          lineWidth={line.kind === "cluster" ? 0.6 : 1.2}
          dashed={line.kind === "cluster" || line.dashed === true}
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
        const color = lineColor(line, colors);
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
          onMenu={onMenu}
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
  onMenu(request: MenuRequest): void;
};

function Dot({ point, position, colors, hovered, onHover, controls, onDrag, onMenu }: DotProps) {
  const session = useSession();
  const { readOnly } = useSessionState();
  const runCommand = useRunCommand();
  const actions = useWorkspaceActions();
  const { camera } = useThree();
  const drag = useRef<{ plane: Plane; offset: Vector3; last: Point3 } | null>(null);
  const radius = radiusOf(point);
  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    // A group point comes from its cards: it does not move by itself. A satellite inside a page has no card to move.
    // A radial core moves (its cards follow it). The cards of a radial keep their place in its ball.
    const movable = point.groupType === "radial" ? point.kind === "group" : point.kind !== "group" && point.placeId !== "" && point.followKey === undefined;
    if (event.button !== 0 || readOnly || !movable) return;
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
    if (final === point.position) return;
    if (point.kind === "group") {
      // The core of a radial: its new place on the board (the plane of the board; the depth is not saved).
      const radial = session.store.get("outlines", point.recordId);
      if (radial !== undefined) runCommand(moveOutline(session.context, radial.id, Math.round(radial.x + (final[0] - point.position[0]) * UNITS_PER_3D), Math.round(radial.y - (final[1] - point.position[1]) * UNITS_PER_3D)));
      return;
    }
    runCommand(setPlacement3d(session.context, new Map([[point.placeId, worldToPlacement(point, final)]])));
  };

  return (
    <group position={position}>
      <mesh
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerOver={(event) => (event.stopPropagation(), onHover(true))}
        onPointerOut={() => onHover(false)}
        onContextMenu={(event) => {
          // Only a card of this board (not a group point, not a card of a board in it).
          if (readOnly || point.kind === "group" || point.placeId === "" || point.depth !== 1) return;
          event.stopPropagation();
          event.nativeEvent.preventDefault();
          onMenu({
            x: event.nativeEvent.clientX,
            y: event.nativeEvent.clientY,
            entries: [
              // A group card: its look, as on the 2D board.
              ...(point.area !== null
                ? [
                    {
                      kind: "choices" as const,
                      label: "Look",
                      choices: [
                        { id: "outline", text: "Outline only", tip: "Only the outline of the group shows" },
                        { id: "filled", text: "Filled", tip: "The color of the group fills its area" },
                      ],
                      current: point.area.filled ? "filled" : "outline",
                      onSelect: (id: string) => runCommand(setGroupFilled(session.context, point.placeId, id === "filled")),
                    },
                  ]
                : []),
              { label: "Delete", icon: <Trash2 size={14} />, onSelect: () => runCommand(removeFromBoard(session.context, [point.placeId])) },
            ],
          });
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          if (point.kind === "stamp" || point.kind === "group") return;
          // A note never opens as a page: show it on its board. A reference opens a quick view.
          if (point.isReference) actions.openText(point.recordId);
          // A link object (an item with a web address or PDF, not a board) opens its saved page, not an empty board.
          else if ((point.view === "note" || session.store.get("items", point.recordId)?.url !== undefined) && !point.isBoard) actions.openAt(point.recordId);
          else actions.openRecord(point.recordId);
        }}
      >
        <Shape point={point} radius={radius} colors={colors} hovered={hovered} />
      </mesh>
      {point.area !== null && <AreaShape area={point.area} color={point.area.color ?? colors.ghost} hovered={hovered} selectedColor={colors.selected} />}
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
    // A radial core: a light red ball, as its circle on the board.
    if (point.groupType === "radial") {
      return (
        <>
          <sphereGeometry args={[radius * 1.1, 24, 16]} />
          <meshStandardMaterial color={tint(GROUP_COLORS.radial)} emissive={GROUP_COLORS.radial} emissiveIntensity={0.35} />
        </>
      );
    }
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

const GROUP_COLORS = { outline: "#3fbf6a", calendar: "#4a90ff", radial: "#ff8f8f" };

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

/**
 * A group card in 3D: a faint flat shape in the plane of the board. It does not take the pointer (a drag on it turns
 * the view); its dot in the middle moves it.
 */
/**
 * A group card in 3D: a volume around the depth of its cards (a flat shape if they are in one plane).
 * Outline: its front and back edges, and four lines between them. Filled: also a clear volume in its color.
 */
function AreaShape({ area, color, hovered, selectedColor }: { area: GalaxyArea; color: string; hovered: boolean; selectedColor: string }) {
  const { outline, filled } = area;
  const [back, front] = area.depth;
  const span = front - back;
  const geometry = useMemo(() => {
    const shape = new ThreeShape(outline.map(([x, y]) => new Vector2(x, y)));
    return span > 0 ? new ExtrudeGeometry(shape, { depth: span, bevelEnabled: false, curveSegments: 1 }) : new ShapeGeometry(shape);
  }, [outline, span]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const loops = useMemo<Point3[][]>(() => {
    const ring = (z: number): Point3[] => [...outline, outline[0]!].map(([x, y]) => [x, y, z]);
    return span > 0 ? [ring(back), ring(front)] : [ring(0)];
  }, [outline, span, back, front]);
  // Four lines from the back to the front: at the far left, right, top, and bottom of the shape.
  const sides = useMemo<Point3[][]>(() => {
    if (span <= 0 || outline.length === 0) return [];
    const pick = (better: (a: [number, number], b: [number, number]) => boolean) => outline.reduce((best, point) => (better(point, best) ? point : best));
    const extremes = [pick((a, b) => a[0] < b[0]), pick((a, b) => a[0] > b[0]), pick((a, b) => a[1] < b[1]), pick((a, b) => a[1] > b[1])];
    return extremes.map(([x, y]) => [[x, y, back], [x, y, front]]);
  }, [outline, span, back, front]);
  const tint = hovered ? selectedColor : color;
  return (
    <>
      {filled && (
        <mesh geometry={geometry} position={[0, 0, span > 0 ? back : 0]} raycast={() => null}>
          <meshBasicMaterial color={tint} transparent opacity={hovered ? 0.22 : 0.14} side={DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {[...loops, ...sides].map((points, index) => (
        <Line key={index} points={points} color={tint} lineWidth={filled ? 1.25 : 1} dashed={!filled} dashSize={0.15} gapSize={0.1} transparent opacity={filled ? 0.8 : 0.7} raycast={() => null} />
      ))}
    </>
  );
}

/** The middle of the depth-1 points (the board contents). */
/**
 * Moves the camera along the tour (tour.ts) at one fixed speed, from the whole board, round the major stars, and back
 * to the whole board. At the end the user has the camera again, looking at the middle of the board.
 */
function TourRunner({ model, controls, onEnd, onInfo }: { model: GalaxyModel; controls: RefObject<OrbitControlsImpl | null>; onEnd(): void; onInfo(text: string): void }) {
  const { camera } = useThree();
  // A change of the board (a store write) makes a new path; the tour goes on from the same part of it.
  const tour = useMemo<Tour | null>(() => buildTour(model), [model]);
  const u = useRef(0);
  const look = useRef<Vector3 | null>(null);
  const info = useRef("");
  const ended = useRef(false);
  // The speed is fixed for one tour: a part of the board size each second.
  const speed = useRef<number | null>(null);
  useEffect(() => {
    if (tour === null) onEnd();
  }, [tour, onEnd]);
  useFrame((_state, delta) => {
    if (tour === null || ended.current) return;
    speed.current ??= Math.max(0.5, tour.boardRadius * 0.13);
    // The first frame starts from where the camera is: it eases onto the path in the first second (no jump).
    u.current += (speed.current * Math.min(delta, 0.05)) / tour.length;
    if (u.current >= 1) {
      ended.current = true;
      if (controls.current !== null) {
        controls.current.target.copy(tour.center);
        controls.current.update();
      }
      onEnd();
      return;
    }
    const position = tour.curve.getPointAt(u.current);
    const blend = Math.min(1, u.current * tour.length / Math.max(1, tour.boardRadius * 0.3));
    camera.position.lerp(position, blend < 1 ? 0.08 : 1);
    const target = tourTarget(tour, u.current, position);
    look.current ??= controls.current?.target.clone() ?? target.clone();
    // Exponential smoothing: the look never jumps.
    look.current.lerp(target, 1 - Math.exp(-Math.min(delta, 0.05) * 2.2));
    camera.lookAt(look.current);
    const stop = stopAt(tour, u.current);
    const wide = position.distanceTo(tour.overview) < tour.boardRadius * 0.6;
    // In the UI language here: the line shows a name of the user in it.
    const text = wide ? t("The whole board") : stop !== null ? t("Circling: {0}", stop.point.label || stop.point.hoverLabel) : t("Cruising");
    if (text !== info.current) {
      info.current = text;
      onInfo(text);
    }
  });
  return null;
}

/** A soft glow around each dot while the tour runs (additive light, as stars). */
function Glow({ points, colors }: { points: readonly GalaxyPoint[]; colors: Colors }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,0.9)");
    gradient.addColorStop(0.3, "rgba(255,255,255,0.25)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    return new CanvasTexture(canvas);
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <>
      {points.map((point) => (
        <sprite key={`glow:${point.key}`} position={point.position} scale={radiusOf(point) * (point.depth === 1 ? 5 : 3.5)}>
          <spriteMaterial map={texture} color={glowColor(point, colors)} transparent depthWrite={false} blending={AdditiveBlending} opacity={point.depth === 1 ? 0.9 : 0.6} />
        </sprite>
      ))}
    </>
  );
}

/** The color of the glow of a dot: the color of its shape. */
function glowColor(point: GalaxyPoint, colors: Colors): string {
  if (point.kind === "group") return point.groupType === "calendar" ? GROUP_COLORS.calendar : point.groupType === "radial" ? GROUP_COLORS.radial : GROUP_COLORS.outline;
  if (point.isBoard) return colors.item;
  const object = OBJECT_LOOKS[point.view];
  if (object !== undefined) return object.color;
  return point.view === "note" ? colors.note : point.view === "page" ? colors.page : colors.text;
}

function contentCenter(model: GalaxyModel): Vector3 {
  const top = model.points.filter((point) => point.depth === 1);
  const center = new Vector3();
  if (top.length === 0) return center;
  for (const point of top) center.add(new Vector3(...point.position));
  return center.divideScalar(top.length);
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
