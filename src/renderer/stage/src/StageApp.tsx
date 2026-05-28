import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowUp, PanelRight, PanelRightClose } from "lucide-react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, Html, Line, Text } from "@react-three/drei";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { useDarkMode } from "@common/hooks/useDarkMode";
import type {
  Card,
  RunToPointEvent,
  StageState,
  ThumbnailEvent,
} from "./stageTypes";
import {
  extractSkyColorsFromDataUrl,
  getSkyFallback,
  StageSkyGradient,
  type SkyGradientColors,
} from "./stageSky";
import triangleModelUrl from "../../../../resources/models/gltf/A/Triangle-running.glb?url";
import triangleMiningModelUrl from "../../../../resources/models/gltf/A/Triangle-mining.glb?url";
import triangleIdleModelUrl from "../../../../resources/models/gltf/A/Triangle-idle.glb?url";
import triangleThinkingModelUrl from "../../../../resources/models/gltf/A/Triangle-thinking.glb?url";
import triangleJumpModelUrl from "../../../../resources/models/gltf/A/Triangle-Jump.glb?url";

// =====================================================================
// Tunable constants — everything visual on the stage starts from here.
// =====================================================================

/** Y of the stage floor; all cards sit just above this. */
const FLOOR_Y = -1.4;
/** Top surface of the cards — the avatar's feet stand on this. */
const CARD_SURFACE_Y = FLOOR_Y + 0.012;
/** Card width along the walking axis (X). Constant so steps feel even. */
const CARD_LENGTH = 3.6;
/** Gap between cards along the walking axis (avatar can fall through here). */
const CARD_GAP = 0.36;
/** Card body height below the walkable top surface. */
const CARD_CUBE_HEIGHT = 12;
/** Fall this far below card tops before respawning on the first card. */
const VOID_RESPAWN_Y = CARD_SURFACE_Y - 5;
/** Blue distance fog — near/far tuned for cracks between card cubes. */
const STAGE_FOG_NEAR = 10;
const STAGE_FOG_FAR = 30;
const STAGE_FOG_COLOR_DARK = "#4a6bb5";
const STAGE_FOG_COLOR_LIGHT = "#8eb0f0";
/** Used until we have a real screenshot to compute the card's aspect. */
const DEFAULT_PAGE_ASPECT = 1.4;
/** Avatar body offset above its feet. */
const AVATAR_HEIGHT = 0.35;
const PRECLICK_RUN_MS = 420;
const MINING_MS = 420;
const MINE_TICK_MS = 180;
const MINE_LETTERS_PER_BATCH = 2;
const PREMOVE_MARK_MS = 140;
const AVATAR_YAW_OFFSET = Math.PI / 2;
/** Delay before walking to a newly spawned card so it renders first. */
const NEW_CARD_WALK_DELAY_MS = 80;
const MOVEMENT_SPEED_SCALE = 0.6;
/** Arrow-key walk speed in stage units per second. */
const ARROW_MOVE_SPEED = 2.4 * MOVEMENT_SPEED_SCALE;
/** Damp factor when walking the avatar toward a card target. */
const AVATAR_WALK_DAMP = 3.5 * MOVEMENT_SPEED_SCALE;
const ARROW_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const JUMP_VELOCITY = 3.2;
const GRAVITY = 11;
const GROUND_CONTACT_EPSILON = 0.02;
const AVATAR_CLIP_FPS = 30;
/** Skip lead-in frames so the loop starts on a clean pose (companion START_FRAME). */
const AVATAR_CLIP_START_FRAME = 1;
const AVATAR_LOOP_END_TRIM_FRAMES = 2;
/** Locomotion clips trim lead-in/out; idle/thinking play the full clip for a clean loop. */
type AvatarLoopProfile = { startFrame: number; endTrimFrames: number };
const AVATAR_LOCOMOTION_LOOP: AvatarLoopProfile = {
  startFrame: AVATAR_CLIP_START_FRAME,
  endTrimFrames: AVATAR_LOOP_END_TRIM_FRAMES,
};
const AVATAR_SUBTLE_LOOP: AvatarLoopProfile = {
  startFrame: 0,
  endTrimFrames: 0,
};
/** Local offset from avatar root to approximate head (for talk camera look-at). */
const AVATAR_HEAD_LOCAL = new THREE.Vector3(0, 0.42, 0);
/** Visual center of the avatar (camera look-at in talk mode). */
const AVATAR_VISUAL_CENTER_LOCAL = new THREE.Vector3(0, 0.02, 0);
/** Speech-bubble apex on the avatar's left (-X), outside the mesh toward screen-left. */
const AVATAR_SPEECH_APEX_LOCAL = new THREE.Vector3(0.12, 0.1, 0);
/** Extra leftward screen offset for the triangle apex (left point). */
const SPEECH_TRIANGLE_APEX_NDC_X_OFFSET = 0.06;
/** Avatar faces -Z (toward the talk camera on +Z) in talk mode. */
const AVATAR_TALK_YAW = 0;
/** Camera in front-above the avatar (+Z / +Y). Higher Y keeps the model in frame; smaller Z zooms in. */
const TALK_CAMERA_OFFSET = new THREE.Vector3(0, 0.85, 3.35);
/** NDC X for the speech-triangle base on the right edge of the stage canvas. */
const SPEECH_TRIANGLE_EDGE_NDC_X = 1;
const SPEECH_TRIANGLE_NDC_Y_SPREAD = 0.055;
/** Extra downward screen offset for the triangle apex only (left point). */
const SPEECH_TRIANGLE_APEX_NDC_Y_OFFSET = 0.16;
/** Default camera aim — lower Y shifts cards toward the top of the viewport. */
const CAMERA_DEFAULT_POSITION = new THREE.Vector3(0, 10, 6.35);
const CAMERA_LOOK_AT_Y = -1.48;
const DEFAULT_LOOK_AT = new THREE.Vector3(0, CAMERA_LOOK_AT_Y, 0);

type Thumbnails = Record<string, { dataUrl: string; aspect: number }>;
type StageCardLayoutEntry = { card: Card; x: number; depthZ: number; aspect: number };

// =====================================================================
// <StageApp> — the root component. Owns IPC + the <Canvas>.
//   Stage data model:
//     - one card per visited page (each navigation = new card)
//     - the avatar stands on the *active* card (the page the user is on)
//     - clicking any card re-visits it (its tab, navigating if needed)
// =====================================================================

export const StageApp: React.FC = () => {
  const { isDarkMode } = useDarkMode();
  const stageFocusRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const clickAtAvatarRef = useRef<(() => void) | null>(null);
  const promptInputFocusedRef = useRef(false);
  const cardCountRef = useRef(0);
  const pressedArrowKeysRef = useRef<Set<string>>(new Set());
  const jumpRequestedRef = useRef(false);

  const focusStage = useCallback((): void => {
    stageFocusRef.current?.focus();
  }, []);
  const [state, setState] = useState<StageState>({ cards: [], activeCardId: null });
  const [thumbnails, setThumbnails] = useState<Thumbnails>({});
  const [zoom, setZoom] = useState(1.2);
  const [miningEnabled, setMiningEnabled] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatRequestActive, setChatRequestActive] = useState(false);
  const [skyColors, setSkyColors] = useState<SkyGradientColors>(() =>
    getSkyFallback(isDarkMode)
  );
  const talkMode = sidebarOpen;
  const activeThumbnailUrl = state.activeCardId
    ? thumbnails[state.activeCardId]?.dataUrl
    : undefined;
  const headWorldRef = useRef(new THREE.Vector3(0, -0.55, 0));
  const avatarCenterWorldRef = useRef(new THREE.Vector3(0, -0.75, 0));
  const avatarSpeechApexWorldRef = useRef(new THREE.Vector3(0, -0.75, 0));
  const lookTargetRef = useRef(new THREE.Vector3(0, CAMERA_LOOK_AT_Y, 0));

  const handlePromptSubmit = (): void => {
    const text = prompt.trim();
    if (!text) return;

    const api = window.stageAPI;
    if (!api) return;

    setPrompt("");
    void api.openSidebar();
    void api.sendChatMessage({
      message: text,
      messageId: Date.now().toString(),
    });
  };

  const handlePromptKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    handlePromptSubmit();
  };

  const handleStageKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "Enter") return;
    if (sidebarOpen || promptInputFocusedRef.current) return;
    if (state.cards.length === 0) return;
    e.preventDefault();
    promptInputRef.current?.focus();
  };

  const handleToggleSidebar = (): void => {
    const api = window.stageAPI;
    if (!api) return;
    void (sidebarOpen ? api.closeSidebar() : api.openSidebar());
  };

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkMode);
  }, [isDarkMode]);

  useEffect(() => {
    let cancelled = false;
    if (!activeThumbnailUrl) {
      setSkyColors(getSkyFallback(isDarkMode));
      return;
    }
    void extractSkyColorsFromDataUrl(activeThumbnailUrl, isDarkMode).then((colors) => {
      if (!cancelled) setSkyColors(colors);
    });
    return () => {
      cancelled = true;
    };
  }, [activeThumbnailUrl, isDarkMode]);

  useEffect(() => {
    const api = window.stageAPI;
    if (!api) return;
    void api.getState().then((s) => {
      setState(s);
      focusStage();
    });
    void api.getSidebarVisible().then((visible) => {
      setSidebarOpen(visible);
      if (visible) setMiningEnabled(false);
    });
    const offSidebar = api.onSidebarVisibility((visible) => {
      setSidebarOpen(visible);
      if (visible) setMiningEnabled(false);
    });
    const offFocus = api.onFocus(focusStage);
    const offState = api.onState((next) => {
      if (next.cards.length !== cardCountRef.current) {
        cardCountRef.current = next.cards.length;
        focusStage();
      }
      setState(next);
    });
    const offThumb = api.onThumbnail((event: ThumbnailEvent) => {
      const aspect =
        event.height > 0 ? event.width / event.height : DEFAULT_PAGE_ASPECT;
      setThumbnails((prev) => ({
        ...prev,
        [event.cardId]: { dataUrl: event.dataUrl, aspect },
      }));
    });
    const offChatRequest = api.onChatRequestActive((active) => {
      setChatRequestActive(active);
    });
    return () => {
      offSidebar();
      offFocus();
      offState();
      offThumb();
      offChatRequest();
    };
  }, [focusStage]);

  useEffect(() => {
    focusStage();
  }, [focusStage]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "+" || e.key === "=" || e.key === "NumpadAdd") {
        e.preventDefault();
        setZoom((z) => THREE.MathUtils.clamp(Number((z + 0.1).toFixed(2)), 0.6, 2.2));
        return;
      }
      if (e.key === "-" || e.key === "_" || e.key === "NumpadSubtract") {
        e.preventDefault();
        setZoom((z) => THREE.MathUtils.clamp(Number((z - 0.1).toFixed(2)), 0.6, 2.2));
        return;
      }
      if (e.code === "Space" || e.key === " ") {
        if (promptInputFocusedRef.current || talkMode) return;
        e.preventDefault();
        jumpRequestedRef.current = true;
        return;
      }
      if (!ARROW_KEYS.has(e.key)) return;
      if (promptInputFocusedRef.current) return;
      e.preventDefault();
      pressedArrowKeysRef.current.add(e.key);
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (!ARROW_KEYS.has(e.key)) return;
      if (promptInputFocusedRef.current) return;
      e.preventDefault();
      pressedArrowKeysRef.current.delete(e.key);
    };
    const clearHeldKeys = (): void => {
      pressedArrowKeysRef.current.clear();
      jumpRequestedRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearHeldKeys);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearHeldKeys);
    };
  }, [talkMode]);

  const skyGradientStyle = {
    background: `linear-gradient(180deg, ${skyColors.top} 0%, ${skyColors.bottom} 62%)`,
  } as const;

  return (
    <div
      ref={stageFocusRef}
      tabIndex={0}
      className="relative w-full h-full outline-none"
      style={skyGradientStyle}
      onKeyDown={handleStageKeyDown}
      onPointerDown={() => stageFocusRef.current?.focus()}
    >
      {/*
        Camera framing:
          - position [0, 10, 6.35], lookAt(0, CAMERA_LOOK_AT_Y, 0)
          - 30° from straight down: atan(6.35 / 11) ≈ 30°
          - FOV 18° flattens perspective so the runway feels near-axonometric
        The <Scene> below keeps the avatar pinned at world X=0 by translating
        the whole stage group — so this static lookAt always "looks at the
        agent" without any per-frame camera math.
      */}
      <Canvas
        camera={{ position: [0, 10, 6.35], fov: 18, near: 0.1, far: 200 }}
        onCreated={({ camera }) => camera.lookAt(DEFAULT_LOOK_AT)}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <CameraRig
          zoom={zoom}
          talkMode={talkMode}
          avatarCenterWorldRef={avatarCenterWorldRef}
          lookTargetRef={lookTargetRef}
        />
        <StageSkyGradient topColor={skyColors.top} bottomColor={skyColors.bottom} />
        <fog
          attach="fog"
          args={[
            isDarkMode ? STAGE_FOG_COLOR_DARK : STAGE_FOG_COLOR_LIGHT,
            STAGE_FOG_NEAR,
            STAGE_FOG_FAR,
          ]}
        />
        <ambientLight intensity={1.05} />
        <directionalLight position={[2, 6, 4]} intensity={1.45} />
        <directionalLight position={[-3, 4, 2]} intensity={0.55} color="#9aa6ff" />
        <Scene
          cards={state.cards}
          activeCardId={state.activeCardId}
          thumbnails={thumbnails}
          isDarkMode={isDarkMode}
          pressedArrowKeysRef={pressedArrowKeysRef}
          jumpRequestedRef={jumpRequestedRef}
          miningEnabled={miningEnabled}
          talkMode={talkMode}
          chatRequestActive={chatRequestActive}
          headWorldRef={headWorldRef}
          avatarCenterWorldRef={avatarCenterWorldRef}
          avatarSpeechApexWorldRef={avatarSpeechApexWorldRef}
          clickAtAvatarRef={clickAtAvatarRef}
        />
        <GizmoHelper alignment="top-right" margin={[80, 80]}>
          <SignedAxisGizmo isDarkMode={isDarkMode} />
        </GizmoHelper>
      </Canvas>

      {state.cards.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-sm text-[rgb(var(--muted-foreground))]">
          Visit a page to populate the stage
        </div>
      )}

      {!sidebarOpen && (
        <div className="absolute bottom-4 left-1/2 z-10 flex w-[min(32rem,calc(100%-6rem))] -translate-x-1/2 items-center gap-1 rounded-2xl border border-gray-400 bg-[rgb(var(--background))]/92 p-1 shadow-lg backdrop-blur-sm">
          <input
            ref={promptInputRef}
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handlePromptKeyDown}
            onFocus={() => {
              promptInputFocusedRef.current = true;
              pressedArrowKeysRef.current.clear();
            }}
            onBlur={() => {
              promptInputFocusedRef.current = false;
            }}
            placeholder="Ask the agent…"
            disabled={state.cards.length === 0}
            className="min-w-0 flex-1 rounded-xl bg-transparent py-3 pl-4 pr-2 text-sm text-[rgb(var(--foreground))] placeholder:text-[#888] outline-none disabled:opacity-40"
            aria-label="Prompt"
          />
          <button
            type="button"
            onClick={handlePromptSubmit}
            disabled={state.cards.length === 0 || !prompt.trim()}
            aria-label="Send message"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black text-white transition hover:opacity-80 disabled:pointer-events-none disabled:opacity-50"
          >
            <ArrowUp className="size-5" aria-hidden />
          </button>
        </div>
      )}

      {!sidebarOpen && (
        <button
          type="button"
          aria-label={miningEnabled ? "Disable mining" : "Enable mining"}
          title={miningEnabled ? "Disable mining" : "Enable mining"}
          disabled={state.cards.length === 0}
          className={`absolute bottom-4 left-4 z-10 flex h-11 w-11 items-center justify-center rounded-xl border shadow-md backdrop-blur-sm transition disabled:pointer-events-none disabled:opacity-40 ${
            miningEnabled
              ? "border-red-600 bg-red-500 text-white hover:bg-red-400"
              : "border-[rgb(var(--border))] bg-[rgb(var(--background))]/90 text-[rgb(var(--foreground))] hover:bg-[rgb(var(--muted))]"
          }`}
          onClick={() => setMiningEnabled((v) => !v)}
        >
          <span aria-hidden>⛏</span>
        </button>
      )}

      <button
        type="button"
        aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        className="absolute bottom-4 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))]/90 text-[rgb(var(--foreground))] shadow-md backdrop-blur-sm transition hover:bg-[rgb(var(--muted))]"
        onClick={handleToggleSidebar}
      >
        {sidebarOpen ? (
          <PanelRightClose className="size-5" aria-hidden />
        ) : (
          <PanelRight className="size-5" aria-hidden />
        )}
      </button>
    </div>
  );
};

const CameraRig: React.FC<{
  zoom: number;
  talkMode: boolean;
  avatarCenterWorldRef: React.RefObject<THREE.Vector3>;
  lookTargetRef: React.MutableRefObject<THREE.Vector3>;
}> = ({ zoom, talkMode, avatarCenterWorldRef, lookTargetRef }) => {
  const { camera } = useThree();
  const positionTarget = useRef(CAMERA_DEFAULT_POSITION.clone());
  useFrame((_, delta) => {
    const anchor = avatarCenterWorldRef.current;
    const defaultPos = CAMERA_DEFAULT_POSITION.clone().multiplyScalar(1 / zoom);
    const talkPos = anchor.clone().add(TALK_CAMERA_OFFSET);
    const desiredPos = talkMode ? talkPos : defaultPos;
    const desiredLook = talkMode ? anchor.clone() : DEFAULT_LOOK_AT;

    const t = 1 - Math.exp(-8 * delta);
    positionTarget.current.copy(desiredPos);
    camera.position.lerp(positionTarget.current, t);
    lookTargetRef.current.lerp(desiredLook, t);
    camera.lookAt(lookTargetRef.current);
  });
  return null;
};

/** Filled triangle from the avatar (screen-aligned) to the right edge of the canvas. */
const SpeechBubbleTriangle: React.FC<{
  avatarSpeechApexWorldRef: React.RefObject<THREE.Vector3>;
  visible: boolean;
  isDarkMode: boolean;
}> = ({ avatarSpeechApexWorldRef, visible, isDarkMode }) => {
  const { camera } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const positions = useMemo(() => new Float32Array(9), []);
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  const outlineVecs = useRef([
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
    new THREE.Vector3(),
  ]);
  const edgeScratchA = useRef(new THREE.Vector3());
  const edgeScratchB = useRef(new THREE.Vector3());
  const apexScratch = useRef(new THREE.Vector3());
  const fillColor = isDarkMode ? "#141414" : "#ffffff";
  const outlineColor = isDarkMode ? "#5c5c68" : "#b4b4be";

  const outlineLine = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const mat = new THREE.LineBasicMaterial({
      color: outlineColor,
      depthWrite: true,
      depthTest: true,
    });
    return new THREE.Line(geo, mat);
  }, [outlineColor]);

  useEffect(() => {
    outlineLine.material.color.set(outlineColor);
  }, [outlineColor, outlineLine]);

  const anchorNdcScratch = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!visible) return;
    const anchor = avatarSpeechApexWorldRef.current;
    const planeY = anchor.y;
    anchorNdcScratch.current.copy(anchor).project(camera);
    const edgeY = THREE.MathUtils.clamp(anchorNdcScratch.current.y, -0.92, 0.92);
    const apexNdcY = THREE.MathUtils.clamp(
      edgeY - SPEECH_TRIANGLE_APEX_NDC_Y_OFFSET,
      -0.92,
      0.92
    );
    const apexNdcX = THREE.MathUtils.clamp(
      anchorNdcScratch.current.x - SPEECH_TRIANGLE_APEX_NDC_X_OFFSET,
      -1,
      1
    );
    const apex = ndcToWorldOnPlane(
      camera,
      apexNdcX,
      apexNdcY,
      planeY,
      apexScratch.current
    );
    const b1 = ndcToWorldOnPlane(
      camera,
      SPEECH_TRIANGLE_EDGE_NDC_X,
      edgeY - SPEECH_TRIANGLE_NDC_Y_SPREAD,
      planeY,
      edgeScratchA.current
    );
    const b2 = ndcToWorldOnPlane(
      camera,
      SPEECH_TRIANGLE_EDGE_NDC_X,
      edgeY + SPEECH_TRIANGLE_NDC_Y_SPREAD,
      planeY,
      edgeScratchB.current
    );

    positions[0] = apex.x;
    positions[1] = apex.y;
    positions[2] = apex.z;
    positions[3] = b1.x;
    positions[4] = planeY;
    positions[5] = b1.z;
    positions[6] = b2.x;
    positions[7] = planeY;
    positions[8] = b2.z;

    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();

    const [p0, p1, p2, p3] = outlineVecs.current;
    p0.copy(apex);
    p1.copy(b1);
    p2.copy(b2);
    p3.copy(apex);
    outlineLine.geometry.setFromPoints(outlineVecs.current);
  });

  if (!visible) return null;

  return (
    <group>
      <mesh ref={meshRef} geometry={geometry} renderOrder={10}>
        <meshBasicMaterial
          color={fillColor}
          side={THREE.DoubleSide}
          depthWrite
          depthTest
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
          toneMapped={false}
        />
      </mesh>
      <primitive object={outlineLine} renderOrder={11} />
    </group>
  );
};

/** Match @react-three/drei GizmoViewport root scale so HUD size is consistent. */
const GIZMO_SCALE = 40;
const GIZMO_AXIS_LENGTH = 1;
const GIZMO_LABEL_OFFSET = 0.18;

const SignedAxisGizmo: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => {
  const negativeOpacity = isDarkMode ? 0.4 : 0.5;
  const labelColor = isDarkMode ? "#f5f5fa" : "#1a1a1f";
  return (
    <group scale={GIZMO_SCALE}>
      <SignedAxis
        axis="x"
        color="#ff4d4f"
        labelColor={labelColor}
        negativeOpacity={negativeOpacity}
      />
      <SignedAxis
        axis="y"
        color="#52c41a"
        labelColor={labelColor}
        negativeOpacity={negativeOpacity}
      />
      <SignedAxis
        axis="z"
        color="#1677ff"
        labelColor={labelColor}
        negativeOpacity={negativeOpacity}
      />
    </group>
  );
};

interface SignedAxisProps {
  axis: "x" | "y" | "z";
  color: string;
  labelColor: string;
  negativeOpacity: number;
}

const SignedAxis: React.FC<SignedAxisProps> = ({
  axis,
  color,
  labelColor,
  negativeOpacity,
}) => {
  const positive: [number, number, number] =
    axis === "x"
      ? [GIZMO_AXIS_LENGTH, 0, 0]
      : axis === "y"
        ? [0, GIZMO_AXIS_LENGTH, 0]
        : [0, 0, GIZMO_AXIS_LENGTH];
  const negative: [number, number, number] =
    axis === "x"
      ? [-GIZMO_AXIS_LENGTH, 0, 0]
      : axis === "y"
        ? [0, -GIZMO_AXIS_LENGTH, 0]
        : [0, 0, -GIZMO_AXIS_LENGTH];
  const plusLabelPos: [number, number, number] =
    axis === "x"
      ? [GIZMO_AXIS_LENGTH + GIZMO_LABEL_OFFSET, 0, 0]
      : axis === "y"
        ? [0, GIZMO_AXIS_LENGTH + GIZMO_LABEL_OFFSET, 0]
        : [0, 0, GIZMO_AXIS_LENGTH + GIZMO_LABEL_OFFSET];
  const minusLabelPos: [number, number, number] =
    axis === "x"
      ? [-GIZMO_AXIS_LENGTH - GIZMO_LABEL_OFFSET, 0, 0]
      : axis === "y"
        ? [0, -GIZMO_AXIS_LENGTH - GIZMO_LABEL_OFFSET, 0]
        : [0, 0, -GIZMO_AXIS_LENGTH - GIZMO_LABEL_OFFSET];

  return (
    <group>
      <Line points={[[0, 0, 0], positive]} color={color} lineWidth={3} />
      <Line
        points={[[0, 0, 0], negative]}
        color={color}
        transparent
        opacity={negativeOpacity}
        lineWidth={3}
      />
      <Text position={plusLabelPos} fontSize={0.28} color={labelColor} anchorX="center" anchorY="middle">
        +{axis.toUpperCase()}
      </Text>
      <Text
        position={minusLabelPos}
        fontSize={0.24}
        color={labelColor}
        fillOpacity={negativeOpacity}
        anchorX="center"
        anchorY="middle"
      >
        -{axis.toUpperCase()}
      </Text>
    </group>
  );
};

// =====================================================================
// <Scene> — lays out the cards in chronological order and pans the group
// so the avatar is always centered at world X = 0 (the camera focal point).
// =====================================================================

interface SceneProps {
  cards: Card[];
  activeCardId: string | null;
  thumbnails: Thumbnails;
  isDarkMode: boolean;
  pressedArrowKeysRef: React.RefObject<Set<string>>;
  jumpRequestedRef: React.MutableRefObject<boolean>;
  miningEnabled: boolean;
  talkMode: boolean;
  chatRequestActive: boolean;
  headWorldRef: React.MutableRefObject<THREE.Vector3>;
  avatarCenterWorldRef: React.MutableRefObject<THREE.Vector3>;
  avatarSpeechApexWorldRef: React.MutableRefObject<THREE.Vector3>;
  clickAtAvatarRef: React.MutableRefObject<(() => void) | null>;
}

const Scene: React.FC<SceneProps> = ({
  cards,
  activeCardId,
  thumbnails,
  isDarkMode,
  pressedArrowKeysRef,
  jumpRequestedRef,
  miningEnabled,
  talkMode,
  chatRequestActive,
  headWorldRef,
  avatarCenterWorldRef,
  avatarSpeechApexWorldRef,
  clickAtAvatarRef,
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const avatarRef = useRef<THREE.Group>(null);
  const [preClickTarget, setPreClickTarget] = useState<{ x: number; z: number } | null>(null);
  const [manualTarget, setManualTarget] = useState<{ x: number; z: number } | null>(null);
  const [navTarget, setNavTarget] = useState<{ x: number; z: number }>({ x: 0, z: 0 });
  const [isMining, setIsMining] = useState(false);
  const preMoveTimerRef = useRef<number | null>(null);
  const preClickTimerRef = useRef<number | null>(null);
  const miningTimerRef = useRef<number | null>(null);
  const mineIntervalRef = useRef<number | null>(null);
  const prevActiveCardIdRef = useRef<string | null>(null);
  const knownCardIdsRef = useRef<Set<string>>(new Set());
  const keyboardTabSyncCardRef = useRef<string | null>(null);
  const navWalkTimerRef = useRef<number | null>(null);
  const navTargetRef = useRef(navTarget);
  navTargetRef.current = navTarget;
  const avatarPosRef = useRef({ x: 0, z: 0 });
  const layoutRef = useRef<StageCardLayoutEntry[]>([]);
  const miningEnabledRef = useRef(miningEnabled);
  miningEnabledRef.current = miningEnabled;
  const activeCardIdRef = useRef<string | null>(activeCardId);
  activeCardIdRef.current = activeCardId;

  const layout = useMemo(() => {
    // Order chronologically so the user reads their history left → right.
    const ordered = [...cards].sort((a, b) => a.visitedAt - b.visitedAt);
    const stride = CARD_LENGTH + CARD_GAP;
    return ordered.map((card, i) => {
      const aspect = thumbnails[card.id]?.aspect ?? DEFAULT_PAGE_ASPECT;
      // Stage thumbnails are now forced to square (1:1) in main, so render
      // cards as square panes too. Keep aspect read for backward compatibility
      // during hot-reload transitions where old payloads may still exist.
      const depthZ = CARD_LENGTH * (1 / Math.max(aspect, 1e-6));
      // Use fixed stageX from main so existing cards never shift when new ones spawn.
      const x = card.stageX ?? i * stride;
      return {
        card,
        x,
        depthZ: THREE.MathUtils.clamp(depthZ, CARD_LENGTH, CARD_LENGTH),
        aspect,
      };
    });
  }, [cards, thumbnails]);
  layoutRef.current = layout;

  const targetX = preClickTarget?.x ?? manualTarget?.x ?? navTarget.x;
  const targetZ = preClickTarget?.z ?? manualTarget?.z ?? navTarget.z;

  const stopDomMining = (): void => {
    if (mineIntervalRef.current !== null) {
      window.clearInterval(mineIntervalRef.current);
      mineIntervalRef.current = null;
    }
    if (miningTimerRef.current !== null) {
      window.clearTimeout(miningTimerRef.current);
      miningTimerRef.current = null;
    }
    setIsMining(false);
    void window.stageAPI?.hideMineRadii();
  };

  const runDomMineTick = (): void => {
    const api = window.stageAPI;
    if (!api) return;
    const { x: ax, z: az } = avatarPosRef.current;
    const persistRadius = miningEnabledRef.current;
    const under = findCardAtStagePosition(ax, az, layoutRef.current);
    if (!under) return;
    const { normX, normY } = avatarToCardNorm(ax, az, under.x, under.aspect);
    void api.mineDom(under.card.id, normX, normY, {
      lettersPerBatch: MINE_LETTERS_PER_BATCH,
      persistRadius,
    });
  };

  const startDomMining = (durationMs: number, tick: () => void = runDomMineTick): void => {
    stopDomMining();
    setIsMining(true);
    tick();
    mineIntervalRef.current = window.setInterval(tick, MINE_TICK_MS);
    if (Number.isFinite(durationMs)) {
      miningTimerRef.current = window.setTimeout(() => {
        stopDomMining();
      }, durationMs);
    }
  };

  useEffect(() => {
    if (miningEnabled) {
      // When enabled, keep mining near the avatar until toggled off.
      startDomMining(Number.POSITIVE_INFINITY);
      return;
    }
    stopDomMining();
  }, [miningEnabled]);

  // Walk to active card center when active tab/card changes or a new active card spawns.
  // Depends on card ids (not layout/thumbnails) so capture refreshes don't cancel the walk timer.
  const cardIdsKey = useMemo(() => cards.map((c) => c.id).join("|"), [cards]);

  useEffect(() => {
    if (!activeCardId) return;

    const isNewActiveCard =
      !knownCardIdsRef.current.has(activeCardId) && cards.some((c) => c.id === activeCardId);

    for (const card of cards) {
      knownCardIdsRef.current.add(card.id);
    }
    prevActiveCardIdRef.current = activeCardId;
    if (keyboardTabSyncCardRef.current === activeCardId) {
      keyboardTabSyncCardRef.current = activeCardId;
    }

    // Only auto-walk to center for newly spawned cards (e.g. link opened in new tab).
    // Card clicks and arrow-key tab switches keep the avatar at its current/clicked position.
    if (!isNewActiveCard) return;

    const scheduleWalkToActiveCard = (): void => {
      if (navWalkTimerRef.current !== null) {
        window.clearTimeout(navWalkTimerRef.current);
      }
      navWalkTimerRef.current = window.setTimeout(() => {
        const loc = layoutRef.current.find((l) => l.card.id === activeCardId);
        if (!loc) {
          navWalkTimerRef.current = null;
          return;
        }
        if (preClickTimerRef.current !== null) {
          window.clearTimeout(preClickTimerRef.current);
          preClickTimerRef.current = null;
        }
        setPreClickTarget(null);
        setManualTarget(null);
        setNavTarget({ x: loc.x, z: 0 });
        navWalkTimerRef.current = null;
      }, NEW_CARD_WALK_DELAY_MS);
    };

    scheduleWalkToActiveCard();
  }, [activeCardId, cardIdsKey]);

  useEffect(() => {
    const offRun = window.stageAPI?.onRunToPoint((event: RunToPointEvent) => {
      const loc = layoutRef.current.find((l) => l.card.id === event.cardId);
      if (!loc) return;
      const imageWidth = loc.aspect >= 1 ? CARD_LENGTH : CARD_LENGTH * loc.aspect;
      const runToX = loc.x + (event.normX - 0.5) * imageWidth;
      const runToZ = (1.0 - event.normY - 0.5) * CARD_LENGTH;
      if (preMoveTimerRef.current !== null) window.clearTimeout(preMoveTimerRef.current);
      if (preClickTimerRef.current !== null) window.clearTimeout(preClickTimerRef.current);
      if (!miningEnabledRef.current) {
        stopDomMining();
      }
      setPreClickTarget({ x: runToX, z: runToZ });
      preClickTimerRef.current = window.setTimeout(() => {
        setPreClickTarget(null);
        if (activeCardIdRef.current === event.cardId) {
          setManualTarget({ x: runToX, z: runToZ });
        }
        if (event.mineAfter && !miningEnabledRef.current) {
          const { cardId, normX, normY } = event;
          startDomMining(MINING_MS, () => {
            void window.stageAPI?.mineDom(cardId, normX, normY, {
              lettersPerBatch: MINE_LETTERS_PER_BATCH,
              persistRadius: false,
            });
          });
        }
        preClickTimerRef.current = null;
      }, PREMOVE_MARK_MS + PRECLICK_RUN_MS);
    });
    return () => {
      if (preMoveTimerRef.current !== null) {
        window.clearTimeout(preMoveTimerRef.current);
      }
      if (preClickTimerRef.current !== null) {
        window.clearTimeout(preClickTimerRef.current);
      }
      if (navWalkTimerRef.current !== null) {
        window.clearTimeout(navWalkTimerRef.current);
      }
      offRun?.();
    };
  }, []);

  const handleCardClick = (
    cardId: string,
    _isActive: boolean,
    normX: number,
    normY: number,
    runToX: number,
    runToZ: number
  ): void => {
    if (talkMode) return;

    const clearPendingMovement = (): void => {
      if (preMoveTimerRef.current !== null) {
        window.clearTimeout(preMoveTimerRef.current);
        preMoveTimerRef.current = null;
      }
      if (preClickTimerRef.current !== null) {
        window.clearTimeout(preClickTimerRef.current);
        preClickTimerRef.current = null;
      }
      if (miningTimerRef.current !== null) {
        window.clearTimeout(miningTimerRef.current);
        miningTimerRef.current = null;
      }
      if (!miningEnabledRef.current && mineIntervalRef.current !== null) {
        window.clearInterval(mineIntervalRef.current);
        mineIntervalRef.current = null;
      }
      if (navWalkTimerRef.current !== null) {
        window.clearTimeout(navWalkTimerRef.current);
        navWalkTimerRef.current = null;
      }
      if (!miningEnabledRef.current) {
        setIsMining(false);
      }
    };

    clearPendingMovement();
    // Clicking while already walking should immediately cancel old target
    // and route the avatar to the newly clicked point.
    setManualTarget(null);
    setPreClickTarget({ x: runToX, z: runToZ });
    void window.stageAPI?.clickCard(cardId, normX, normY);
    preClickTimerRef.current = window.setTimeout(() => {
      setPreClickTarget(null);
      if (activeCardIdRef.current === cardId) {
        setManualTarget({ x: runToX, z: runToZ });
      }
      preClickTimerRef.current = null;
    }, MINING_MS);
  };

  const handleCardClickRef = useRef(handleCardClick);
  handleCardClickRef.current = handleCardClick;

  const clickAtAvatar = useCallback((): void => {
    const { x, z } = avatarPosRef.current;
    const under = findCardAtStagePosition(x, z, layoutRef.current);
    if (!under) return;
    const { normX, normY } = avatarToCardNorm(x, z, under.x, under.aspect);
    handleCardClickRef.current(
      under.card.id,
      under.card.id === activeCardIdRef.current,
      normX,
      normY,
      x,
      z
    );
  }, []);

  useEffect(() => {
    clickAtAvatarRef.current = clickAtAvatar;
    return () => {
      clickAtAvatarRef.current = null;
    };
  }, [clickAtAvatar, clickAtAvatarRef]);

  const headScratch = useRef(new THREE.Vector3());
  const centerScratch = useRef(new THREE.Vector3());
  const speechApexScratch = useRef(new THREE.Vector3());

  useFrame(() => {
    if (groupRef.current && avatarRef.current) {
      groupRef.current.position.x = -avatarRef.current.position.x;
      headScratch.current.copy(AVATAR_HEAD_LOCAL);
      avatarRef.current.localToWorld(headScratch.current);
      headWorldRef.current.copy(headScratch.current);
      centerScratch.current.copy(AVATAR_VISUAL_CENTER_LOCAL);
      avatarRef.current.localToWorld(centerScratch.current);
      avatarCenterWorldRef.current.copy(centerScratch.current);
      speechApexScratch.current.copy(AVATAR_SPEECH_APEX_LOCAL);
      avatarRef.current.localToWorld(speechApexScratch.current);
      avatarSpeechApexWorldRef.current.copy(speechApexScratch.current);
    }
  });

  return (
    <>
    <group ref={groupRef}>
      {layout.map(({ card, x, aspect }) => (
        <CardMesh
          key={card.id}
          x={x}
          imageAspect={aspect}
          title={card.title || hostname(card.url) || "Loading…"}
          isActive={card.id === activeCardId}
          isGhost={!card.active}
          thumbnail={thumbnails[card.id]?.dataUrl}
          isDarkMode={isDarkMode}
          cardId={card.id}
          showTitle={!talkMode}
          clickable={!talkMode}
          onClick={(normX, normY, runToX, runToZ, isActive) =>
            handleCardClick(card.id, isActive, normX, normY, runToX, runToZ)
          }
          onScroll={(normX, normY, deltaY) =>
            void window.stageAPI?.scrollCard(card.id, normX, normY, deltaY)
          }
        />
      ))}

      <Avatar
        ref={avatarRef}
        targetX={targetX}
        targetZ={targetZ}
        mode={
          talkMode
            ? chatRequestActive
              ? "thinking"
              : "idle"
            : isMining
              ? "mining"
              : "running"
        }
        talkMode={talkMode}
        pressedArrowKeysRef={pressedArrowKeysRef}
        jumpRequestedRef={jumpRequestedRef}
        layoutRef={layoutRef}
        onLand={clickAtAvatar}
        onVoidRespawn={() => {
          const first = layoutRef.current[0];
          if (!first) return;
          pressedArrowKeysRef.current.clear();
          jumpRequestedRef.current = false;
          setManualTarget({ x: first.x, z: 0 });
          setPreClickTarget(null);
          setNavTarget({ x: first.x, z: 0 });
        }}
        onPositionChange={(x, z) => {
          avatarPosRef.current = { x, z };
          if (pressedArrowKeysRef.current.size === 0) return;

          const under = findCardAtStagePosition(x, z, layoutRef.current);
          if (!under) {
            keyboardTabSyncCardRef.current = null;
            return;
          }
          if (under.card.id === activeCardIdRef.current) {
            keyboardTabSyncCardRef.current = under.card.id;
            return;
          }
          if (keyboardTabSyncCardRef.current === under.card.id) return;

          keyboardTabSyncCardRef.current = under.card.id;
          void window.stageAPI?.activateCard(under.card.id);
        }}
        onKeyboardMoveStart={() => {
          setPreClickTarget(null);
        }}
        onKeyboardMoveEnd={() => {
          const { x, z } = avatarPosRef.current;
          setManualTarget({ x, z });
          const under = findCardAtStagePosition(x, z, layoutRef.current);
          if (!under || under.card.id === activeCardIdRef.current) return;
          keyboardTabSyncCardRef.current = under.card.id;
          void window.stageAPI?.activateCard(under.card.id);
        }}
      />
    </group>

    <SpeechBubbleTriangle
      avatarSpeechApexWorldRef={avatarSpeechApexWorldRef}
      visible={talkMode}
      isDarkMode={isDarkMode}
    />
    </>
  );
};

// =====================================================================
// <CardMesh> — tall cube with the page screenshot on the walkable top face.
//   Ghost cards (their tab has moved on or closed) render dimmer to hint
//   that clicking them will re-load the URL.
// =====================================================================

interface CardMeshProps {
  cardId: string;
  x: number;
  imageAspect: number;
  title: string;
  isActive: boolean;
  isGhost: boolean;
  thumbnail: string | undefined;
  isDarkMode: boolean;
  showTitle: boolean;
  clickable: boolean;
  onClick: (
    normX: number,
    normY: number,
    runToX: number,
    runToZ: number,
    isActive: boolean
  ) => void;
  onScroll: (normX: number, normY: number, deltaY: number) => void;
}

const CardMesh: React.FC<CardMeshProps> = ({
  cardId,
  x,
  imageAspect,
  title,
  isActive,
  isGhost,
  thumbnail,
  isDarkMode,
  showTitle,
  clickable,
  onClick,
  onScroll,
}) => {
  const texture = useImageTexture(thumbnail);
  const interactionRef = useRef<THREE.Mesh>(null);
  const border = isDarkMode ? "#000000" : "#ffffff";
  const cardBase = isDarkMode ? "#000000" : "#ffffff";
  const opacity = isGhost ? 0.55 : 1;
  const imageWidth = imageAspect >= 1 ? CARD_LENGTH : CARD_LENGTH * imageAspect;
  const imageDepth = imageAspect >= 1 ? CARD_LENGTH / imageAspect : CARD_LENGTH;

  const projectPointToCard = (
    e: ThreeEvent<PointerEvent | WheelEvent>
  ): { normX: number; normY: number; localX: number; localZ: number } | null => {
    const plane = interactionRef.current;
    if (!plane) return null;
    const local = plane.worldToLocal(e.point.clone());
    // Plane geometry is XY before rotation; after rotating -PI/2 around X the
    // card depth axis maps to local Y (not local Z).
    const cardNormX = THREE.MathUtils.clamp(local.x / CARD_LENGTH + 0.5, 0, 1);
    const cardNormDepth = THREE.MathUtils.clamp(local.y / CARD_LENGTH + 0.5, 0, 1);

    const imageNormW = imageWidth / CARD_LENGTH;
    const padX = (1 - imageNormW) / 2;
    const normX = THREE.MathUtils.clamp((cardNormX - padX) / imageNormW, 0, 1);
    // Invert depth so +card Z (toward camera) maps to lower normY on the page.
    const normY = THREE.MathUtils.clamp(1.0 - cardNormDepth, 0, 1);
    return { normX, normY, localX: local.x, localZ: local.y };
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>): void => {
    if (!clickable || e.button !== 0) return;
    e.stopPropagation();
    const mapped = projectPointToCard(e);
    if (!mapped) return;
    const runToX = x + mapped.localX;
    // local.y runs opposite group +Z (near/camera side); negate for marker/avatar Z.
    const runToZ = -mapped.localZ;
    onClick(mapped.normX, mapped.normY, runToX, runToZ, isActive);
  };

  const handleWheel = (e: ThreeEvent<WheelEvent>): void => {
    e.stopPropagation();
    const mapped = projectPointToCard(e);
    if (!mapped) return;
    onScroll(mapped.normX, mapped.normY, e.deltaY);
  };

  return (
    <group position={[x, CARD_SURFACE_Y, 0]}>
      {/* Tall card body — top face is y = 0 (walk surface). */}
      <mesh position={[0, -CARD_CUBE_HEIGHT / 2, 0]}>
        <boxGeometry args={[CARD_LENGTH, CARD_CUBE_HEIGHT, CARD_LENGTH]} />
        <meshStandardMaterial
          color={cardBase}
          roughness={0.9}
          metalness={0.02}
          transparent
          opacity={opacity}
        />
      </mesh>

      {/* Outer border frame, slightly larger than the screenshot. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CARD_LENGTH + 0.06, CARD_LENGTH + 0.06]} />
        <meshBasicMaterial color={border} toneMapped={false} transparent opacity={opacity} />
      </mesh>

      {/* Full-card interaction plane so clicks work across whole pane, including
          letterboxed regions when the image is contain-fit. */}
      <mesh
        ref={interactionRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.006, 0]}
        onPointerDown={clickable ? handlePointerDown : undefined}
        onWheel={handleWheel}
      >
        <planeGeometry args={[CARD_LENGTH, CARD_LENGTH]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* The screenshot fits inside the square card without clipping. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0.005, 0]}
        onPointerDown={clickable ? handlePointerDown : undefined}
        onWheel={handleWheel}
        userData={{ cardId }}
      >
        <planeGeometry args={[imageWidth, imageDepth]} />
        {texture ? (
          <meshBasicMaterial
            map={texture}
            color="#ffffff"
            side={THREE.DoubleSide}
            toneMapped={false}
            transparent
            opacity={opacity}
          />
        ) : (
          <meshBasicMaterial
            color={cardBase}
            side={THREE.DoubleSide}
            transparent
            opacity={opacity}
          />
        )}
      </mesh>

      {showTitle ? (
        <Html
          position={[0, 0.012, -CARD_LENGTH / 2 - 0.15]}
          rotation={[-Math.PI / 2, 0, 0]}
          transform
          center
          distanceFactor={6}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          <div
            className="stage-card-title"
            style={{
              color: isDarkMode ? "#f5f5fa" : "#1a1a1f",
              opacity: isGhost ? 0.7 : 1,
              maxWidth: `${CARD_LENGTH * 105}px`,
            }}
          >
            {title.length > 40 ? `${title.slice(0, 40)}…` : title}
          </div>
        </Html>
      ) : null}
    </group>
  );
};

// =====================================================================
// <Avatar> — the bobbing blueberry mascot. Walks toward `targetX`.
// =====================================================================

type AvatarLocomotionMode = "running" | "mining" | "idle" | "thinking";
type AvatarDisplayMode = AvatarLocomotionMode | "jumping";

interface AvatarProps {
  targetX: number;
  targetZ: number;
  mode: AvatarLocomotionMode;
  talkMode: boolean;
  pressedArrowKeysRef: React.RefObject<Set<string>>;
  jumpRequestedRef: React.MutableRefObject<boolean>;
  layoutRef: React.RefObject<StageCardLayoutEntry[]>;
  onLand: () => void;
  onVoidRespawn: () => void;
  onPositionChange: (x: number, z: number) => void;
  onKeyboardMoveStart: () => void;
  onKeyboardMoveEnd: () => void;
}

const Avatar = React.forwardRef(function Avatar(
  {
    targetX,
    targetZ,
    mode,
    talkMode,
    pressedArrowKeysRef,
    jumpRequestedRef,
    layoutRef,
    onLand,
    onVoidRespawn,
    onPositionChange,
    onKeyboardMoveStart,
    onKeyboardMoveEnd,
  }: AvatarProps,
  forwardedRef: React.ForwardedRef<THREE.Group>
) {
  const root = useRef<THREE.Group>(null);
  useImperativeHandle(forwardedRef, () => root.current as THREE.Group, []);
  const [runGltf, setRunGltf] = useState<AvatarGltf | null>(null);
  const [mineGltf, setMineGltf] = useState<AvatarGltf | null>(null);
  const [idleGltf, setIdleGltf] = useState<AvatarGltf | null>(null);
  const [thinkingGltf, setThinkingGltf] = useState<AvatarGltf | null>(null);
  const [jumpGltf, setJumpGltf] = useState<AvatarGltf | null>(null);
  const prevX = useRef(targetX);
  const prevZ = useRef(targetZ);
  const targetXRef = useRef(targetX);
  const targetZRef = useRef(targetZ);
  const wasKeyboardMovingRef = useRef(false);
  const justRespawnedRef = useRef(false);
  const groundY = CARD_SURFACE_Y + AVATAR_HEIGHT;
  const verticalY = useRef(groundY);
  const verticalVelocity = useRef(0);
  const [isAirborne, setIsAirborne] = useState(false);
  const wasAirborneRef = useRef(false);
  const pendingJumpClickRef = useRef(false);

  useEffect(() => {
    targetXRef.current = targetX;
    targetZRef.current = targetZ;
  }, [targetX, targetZ]);

  const respawnAtFirstCard = useCallback((): void => {
    const first = layoutRef.current?.[0];
    if (!first || !root.current) return;
    const x = first.x;
    const z = 0;
    prevX.current = x;
    prevZ.current = z;
    targetXRef.current = x;
    targetZRef.current = z;
    root.current.position.set(x, groundY, z);
    root.current.rotation.z = 0;
    verticalY.current = groundY;
    verticalVelocity.current = 0;
    pendingJumpClickRef.current = false;
    wasAirborneRef.current = false;
    justRespawnedRef.current = true;
    setIsAirborne(false);
    onVoidRespawn();
    onPositionChange(x, z);
  }, [groundY, layoutRef, onVoidRespawn, onPositionChange]);

  useEffect(() => {
    const loader = new GLTFLoader();
    let cancelled = false;
    void Promise.all([
      loader.loadAsync(triangleModelUrl),
      loader.loadAsync(triangleMiningModelUrl),
      loader.loadAsync(triangleIdleModelUrl),
      loader.loadAsync(triangleThinkingModelUrl),
      loader.loadAsync(triangleJumpModelUrl),
    ])
      .then(([runLoaded, mineLoaded, idleLoaded, thinkingLoaded, jumpLoaded]) => {
        if (cancelled) return;
        setRunGltf({ scene: runLoaded.scene, animations: runLoaded.animations });
        setMineGltf({ scene: mineLoaded.scene, animations: mineLoaded.animations });
        setIdleGltf({ scene: idleLoaded.scene, animations: idleLoaded.animations });
        setThinkingGltf({
          scene: thinkingLoaded.scene,
          animations: thinkingLoaded.animations,
        });
        setJumpGltf({ scene: jumpLoaded.scene, animations: jumpLoaded.animations });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!talkMode) return;
    verticalY.current = groundY;
    verticalVelocity.current = 0;
    setIsAirborne(false);
    wasAirborneRef.current = false;
    pendingJumpClickRef.current = false;
  }, [talkMode, groundY]);

  useFrame((_, delta) => {
    if (!root.current) return;
    const keys = pressedArrowKeysRef.current;
    const keyboardMoving = !talkMode && keys.size > 0;

    if (keyboardMoving && !wasKeyboardMovingRef.current) {
      onKeyboardMoveStart();
    } else if (!keyboardMoving && wasKeyboardMovingRef.current) {
      onKeyboardMoveEnd();
    }
    wasKeyboardMovingRef.current = keyboardMoving;

    let next = prevX.current;
    let nextDepth = prevZ.current;
    const hadJustRespawned = justRespawnedRef.current;
    if (hadJustRespawned) {
      justRespawnedRef.current = false;
      next = prevX.current;
      nextDepth = prevZ.current;
    } else if (talkMode) {
      next = prevX.current;
      nextDepth = prevZ.current;
    } else if (keyboardMoving) {
      let dirX = 0;
      let dirZ = 0;
      if (keys.has("ArrowUp")) dirZ -= 1;
      if (keys.has("ArrowDown")) dirZ += 1;
      if (keys.has("ArrowLeft")) dirX -= 1;
      if (keys.has("ArrowRight")) dirX += 1;
      const mag = Math.hypot(dirX, dirZ);
      if (mag > 0) {
        const step = (ARROW_MOVE_SPEED * delta) / mag;
        next = prevX.current + dirX * step;
        nextDepth = prevZ.current + dirZ * step;
      }
    } else {
      const prev = prevX.current;
      next = THREE.MathUtils.damp(prev, targetXRef.current, AVATAR_WALK_DAMP, delta);
      const prevDepth = prevZ.current;
      nextDepth = THREE.MathUtils.damp(prevDepth, targetZRef.current, AVATAR_WALK_DAMP, delta);
    }

    const velocityX = hadJustRespawned
      ? 0
      : (next - prevX.current) / Math.max(delta, 1e-4);
    const velocityZ = hadJustRespawned
      ? 0
      : (nextDepth - prevZ.current) / Math.max(delta, 1e-4);
    prevX.current = next;
    prevZ.current = nextDepth;
    root.current.position.x = next;
    root.current.position.z = nextDepth;

    const onCard =
      findCardAtStagePosition(next, nextDepth, layoutRef.current ?? []) !== null;
    const groundedOnCard =
      onCard &&
      verticalVelocity.current <= 0 &&
      verticalY.current <= groundY + GROUND_CONTACT_EPSILON;

    if (!talkMode) {
      if (jumpRequestedRef.current) {
        jumpRequestedRef.current = false;
        if (groundedOnCard) {
          verticalVelocity.current = JUMP_VELOCITY;
          pendingJumpClickRef.current = true;
        }
      }
      if (onCard) {
        if (!groundedOnCard || verticalVelocity.current > 0) {
          verticalVelocity.current -= GRAVITY * delta;
          verticalY.current += verticalVelocity.current * delta;
        }
        if (verticalY.current <= groundY) {
          verticalY.current = groundY;
          verticalVelocity.current = 0;
        }
      } else {
        pendingJumpClickRef.current = false;
        verticalVelocity.current -= GRAVITY * delta;
        verticalY.current += verticalVelocity.current * delta;
      }
      if (verticalY.current < VOID_RESPAWN_Y) {
        respawnAtFirstCard();
      }
    } else {
      verticalY.current = groundY;
      verticalVelocity.current = 0;
    }

    root.current.position.y = verticalY.current;
    const airborneNow =
      !talkMode &&
      (verticalY.current > groundY + GROUND_CONTACT_EPSILON ||
        verticalVelocity.current > 0.05 ||
        !onCard);
    // Detect landing after physics — pre-physics groundedOnCard is still false on the
    // frame verticalY snaps to groundY, so we must use post-physics airborneNow.
    if (wasAirborneRef.current && !airborneNow && pendingJumpClickRef.current) {
      pendingJumpClickRef.current = false;
      onLand();
    }
    wasAirborneRef.current = airborneNow;
    if (airborneNow !== isAirborne) {
      setIsAirborne(airborneNow);
    }

    onPositionChange(next, nextDepth);

    const speed = Math.hypot(velocityX, velocityZ);
    const walking = !talkMode && speed > 0.01;
    const targetYaw = talkMode
      ? AVATAR_TALK_YAW
      : walking
        ? Math.atan2(-velocityZ, velocityX) + AVATAR_YAW_OFFSET
        : root.current.rotation.y;
    // dampAngle is unavailable on some three versions, so we damp shortest-angle delta manually.
    const yawDelta = THREE.MathUtils.euclideanModulo(
      targetYaw - root.current.rotation.y + Math.PI,
      Math.PI * 2
    ) - Math.PI;
    root.current.rotation.y = THREE.MathUtils.damp(
      root.current.rotation.y,
      root.current.rotation.y + yawDelta,
      12,
      delta
    );
    root.current.rotation.z = THREE.MathUtils.damp(root.current.rotation.z, 0, 8, delta);
  });

  const displayMode: AvatarDisplayMode = isAirborne ? "jumping" : mode;

  return (
    <group ref={root}>
      {runGltf ? (
        <AvatarModelLayer
          gltf={runGltf}
          active={displayMode === "running"}
          timeScale={1.2}
          loopProfile={AVATAR_LOCOMOTION_LOOP}
        />
      ) : null}
      {mineGltf ? (
        <AvatarModelLayer
          gltf={mineGltf}
          active={displayMode === "mining"}
          timeScale={1.15}
          loopProfile={AVATAR_LOCOMOTION_LOOP}
        />
      ) : null}
      {idleGltf ? (
        <AvatarModelLayer
          gltf={idleGltf}
          active={displayMode === "idle"}
          timeScale={1}
          loopProfile={AVATAR_SUBTLE_LOOP}
        />
      ) : null}
      {thinkingGltf ? (
        <AvatarModelLayer
          gltf={thinkingGltf}
          active={displayMode === "thinking"}
          timeScale={1}
          loopProfile={AVATAR_SUBTLE_LOOP}
        />
      ) : null}
      {jumpGltf ? (
        <AvatarModelLayer
          gltf={jumpGltf}
          active={displayMode === "jumping"}
          timeScale={1}
          loopProfile={AVATAR_SUBTLE_LOOP}
          playOnce
        />
      ) : null}
    </group>
  );
});

type AvatarGltf = {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
};

interface AvatarModelLayerProps {
  gltf: AvatarGltf;
  active: boolean;
  timeScale: number;
  loopProfile: AvatarLoopProfile;
  playOnce?: boolean;
}

/** One avatar clip layer — stays mounted; visibility toggles without remount flash. */
const AvatarModelLayer: React.FC<AvatarModelLayerProps> = ({
  gltf,
  active,
  timeScale,
  loopProfile,
  playOnce = false,
}) => {
  const sceneClone = useMemo(
    () => clone(gltf.scene) as THREE.Group,
    [gltf]
  );
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<THREE.AnimationAction[]>([]);
  const bootedRef = useRef(false);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(sceneClone);
    const actions: THREE.AnimationAction[] = [];
    for (const sourceClip of gltf.animations) {
      const loopClip = trimAvatarLoopClip(
        stripBrowTracks(sourceClip),
        loopProfile
      );
      const action = mixer.clipAction(loopClip);
      action.setLoop(playOnce ? THREE.LoopOnce : THREE.LoopRepeat, playOnce ? 1 : Infinity);
      action.clampWhenFinished = playOnce;
      action.play();
      actions.push(action);
    }
    mixerRef.current = mixer;
    actionsRef.current = actions;
    bootedRef.current = true;
    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
      actionsRef.current = [];
      bootedRef.current = false;
    };
  }, [gltf, sceneClone, loopProfile, playOnce]);

  useEffect(() => {
    if (!bootedRef.current || !mixerRef.current) return;
    mixerRef.current.timeScale = active ? timeScale : 0;
  }, [active, timeScale]);

  useEffect(() => {
    const becameActive = active && !wasActiveRef.current;
    wasActiveRef.current = active;
    if (!becameActive) return;
    const mixer = mixerRef.current;
    if (!mixer) return;
    mixer.setTime(0);
    for (const action of actionsRef.current) {
      action.reset();
      action.play();
    }
  }, [active]);

  useFrame((_, delta) => {
    if (active) {
      mixerRef.current?.update(delta);
    }
  });

  const modelProps = {
    position: [0, -0.34, 0] as [number, number, number],
    scale: 1.9,
    rotation: [-Math.PI / 2, 0, 0] as [number, number, number],
  };

  useEffect(() => {
    sceneClone.visible = active;
  }, [active, sceneClone]);

  return <primitive object={sceneClone} {...modelProps} />;
};

function stripBrowTracks(clip: THREE.AnimationClip): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => !t.name.toLowerCase().includes("brow"));
  if (tracks.length === clip.tracks.length) return clip;
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

function trimAvatarLoopClip(
  clip: THREE.AnimationClip,
  profile: AvatarLoopProfile
): THREE.AnimationClip {
  if (profile.startFrame === 0 && profile.endTrimFrames === 0) {
    return clip;
  }
  const totalFrames = Math.floor(clip.duration * AVATAR_CLIP_FPS);
  const endFrame = totalFrames - profile.endTrimFrames;
  if (endFrame <= profile.startFrame + 1) return clip;
  return THREE.AnimationUtils.subclip(
    clip,
    `${clip.name || "avatar"}-loop`,
    profile.startFrame,
    endFrame,
    AVATAR_CLIP_FPS
  );
}

// =====================================================================
// Helpers
// =====================================================================

function useImageTexture(dataUrl: string | undefined): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!dataUrl) {
      setTexture(null);
      return;
    }
    const loader = new THREE.TextureLoader();
    let disposed = false;
    loader.load(
      dataUrl,
      (tex) => {
        if (disposed) {
          tex.dispose();
          return;
        }
        // capturePage data is upside-down with this floor-plane mapping unless
        // we flip Y in the texture.
        tex.flipY = true;
        tex.colorSpace = THREE.SRGBColorSpace;
        // Thumbnails are often NPOT (e.g. 360x239). On some GL paths, NPOT
        // textures with mipmaps/default minFilter can become incomplete/black.
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.needsUpdate = true;
        setTexture((prev) => {
          prev?.dispose();
          return tex;
        });
      },
      undefined,
      () => {
        if (!disposed) setTexture(null);
      }
    );
    return () => {
      disposed = true;
    };
  }, [dataUrl]);
  return texture;
}

function findCardAtStagePosition(
  avatarX: number,
  avatarZ: number,
  layout: { card: Card; x: number; aspect?: number }[]
): { card: Card; x: number; aspect: number } | null {
  if (layout.length === 0) return null;
  const half = CARD_LENGTH / 2;
  for (const entry of layout) {
    if (Math.abs(avatarX - entry.x) > half) continue;
    if (Math.abs(avatarZ) > half) continue;
    return { card: entry.card, x: entry.x, aspect: entry.aspect ?? DEFAULT_PAGE_ASPECT };
  }
  return null;
}

/** Raycast from NDC through the camera onto the horizontal plane at `planeY`. */
function ndcToWorldOnPlane(
  camera: THREE.Camera,
  ndcX: number,
  ndcY: number,
  planeY: number,
  target: THREE.Vector3
): THREE.Vector3 {
  const ndc = new THREE.Vector3(ndcX, ndcY, 0.5);
  ndc.unproject(camera);
  const dir = ndc.sub(camera.position).normalize();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
  const hit = new THREE.Ray(camera.position, dir).intersectPlane(plane, target);
  return hit ?? target.copy(ndc);
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Map avatar stage coords to normalized coords on a card image (matches CardMesh). */
function avatarToCardNorm(
  avatarX: number,
  avatarZ: number,
  cardX: number,
  imageAspect: number
): { normX: number; normY: number } {
  const imageWidth = imageAspect >= 1 ? CARD_LENGTH : CARD_LENGTH * imageAspect;
  const localX = avatarX - cardX;
  const localZ = -avatarZ;
  const cardNormX = THREE.MathUtils.clamp(localX / CARD_LENGTH + 0.5, 0, 1);
  const cardNormDepth = THREE.MathUtils.clamp(localZ / CARD_LENGTH + 0.5, 0, 1);
  const imageNormW = imageWidth / CARD_LENGTH;
  const padX = (1 - imageNormW) / 2;
  const normX = THREE.MathUtils.clamp((cardNormX - padX) / imageNormW, 0, 1);
  const normY = THREE.MathUtils.clamp(1.0 - cardNormDepth, 0, 1);
  return { normX, normY };
}
