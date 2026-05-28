import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { GizmoHelper, Line, Text } from "@react-three/drei";
import { ArrowUp, PanelRight, PanelRightClose } from "lucide-react";
import * as THREE from "three";
import { useDarkMode } from "@common/hooks/useDarkMode";
import type { StageState, ThumbnailEvent, Thumbnails } from "./stageTypes";
import {
  ARROW_KEYS,
  CAMERA_LOOK_AT_Y,
  DEFAULT_LOOK_AT,
  DEFAULT_PAGE_ASPECT,
  STAGE_FOG_COLOR_DARK,
  STAGE_FOG_COLOR_LIGHT,
  STAGE_FOG_FAR,
  STAGE_FOG_NEAR,
} from "./stageConstants";
import { CameraRig } from "./components/CameraRig";
import { Scene } from "./components/Scene";

type SkyGradientColors = { top: string; bottom: string };

const SKY_FALLBACK_DARK: SkyGradientColors = { top: "#2d3a5c", bottom: "#121218" };
const SKY_FALLBACK_LIGHT: SkyGradientColors = { top: "#b8cae8", bottom: "#eef1f8" };

const SKY_VERTEX = /* glsl */ `
varying vec3 vWorldPos;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
varying vec3 vWorldPos;
void main() {
  float t = smoothstep(-6.0, 20.0, vWorldPos.y);
  gl_FragColor = vec4(mix(uBottom, uTop, t), 1.0);
}
`;

function getSkyFallback(isDarkMode: boolean): SkyGradientColors {
  return isDarkMode ? SKY_FALLBACK_DARK : SKY_FALLBACK_LIGHT;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("sky color image load failed"));
    img.src = src;
  });
}

function averageRgb(samples: number[][]): [number, number, number] | null {
  if (samples.length === 0) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [sr, sg, sb] of samples) {
    r += sr;
    g += sg;
    b += sb;
  }
  const n = samples.length;
  return [r / n, g / n, b / n];
}

function tuneSkyChannel(
  r: number,
  g: number,
  b: number,
  isDarkMode: boolean,
  band: "top" | "bottom"
): string {
  const c = new THREE.Color(r / 255, g / 255, b / 255);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.s = THREE.MathUtils.clamp(hsl.s * 1.15 + 0.08, 0.12, 0.72);
  if (band === "top") {
    hsl.l = isDarkMode
      ? THREE.MathUtils.clamp(hsl.l * 0.55 + 0.12, 0.14, 0.38)
      : THREE.MathUtils.clamp(hsl.l * 0.85 + 0.22, 0.45, 0.82);
  } else {
    hsl.l = isDarkMode
      ? THREE.MathUtils.clamp(hsl.l * 0.35 + 0.06, 0.06, 0.2)
      : THREE.MathUtils.clamp(hsl.l * 0.7 + 0.18, 0.72, 0.96);
  }
  c.setHSL(hsl.h, hsl.s, hsl.l);
  return `#${c.getHexString()}`;
}

async function extractSkyColorsFromDataUrl(
  dataUrl: string,
  isDarkMode: boolean
): Promise<SkyGradientColors> {
  const fallback = getSkyFallback(isDarkMode);
  try {
    const img = await loadImage(dataUrl);
    const size = 48;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;

    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const topSamples: number[][] = [];
    const bottomSamples: number[][] = [];
    const allSamples: number[][] = [];

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const a = data[i + 3];
        if (a < 100) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        if (lum < 0.04 || lum > 0.97) continue;

        const sample = [r, g, b];
        allSamples.push(sample);
        if (y < size * 0.45) topSamples.push(sample);
        if (y >= size * 0.55) bottomSamples.push(sample);
      }
    }

    const topAvg = averageRgb(topSamples.length > 0 ? topSamples : allSamples);
    const bottomAvg = averageRgb(bottomSamples.length > 0 ? bottomSamples : allSamples);
    if (!topAvg || !bottomAvg) return fallback;

    return {
      top: tuneSkyChannel(topAvg[0], topAvg[1], topAvg[2], isDarkMode, "top"),
      bottom: tuneSkyChannel(bottomAvg[0], bottomAvg[1], bottomAvg[2], isDarkMode, "bottom"),
    };
  } catch {
    return fallback;
  }
}

const StageSkyGradient: React.FC<{
  topColor: string;
  bottomColor: string;
}> = ({ topColor, bottomColor }) => {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const currentTop = useRef(new THREE.Color(topColor));
  const currentBottom = useRef(new THREE.Color(bottomColor));
  const targetTop = useRef(new THREE.Color(topColor));
  const targetBottom = useRef(new THREE.Color(bottomColor));

  const uniforms = useMemo(
    () => ({
      uTop: { value: new THREE.Color(topColor) },
      uBottom: { value: new THREE.Color(bottomColor) },
    }),
    []
  );

  useEffect(() => {
    targetTop.current.set(topColor);
    targetBottom.current.set(bottomColor);
  }, [topColor, bottomColor]);

  useFrame((_, delta) => {
    const mat = materialRef.current;
    if (!mat) return;
    const t = 1 - Math.exp(-3.5 * delta);
    currentTop.current.lerp(targetTop.current, t);
    currentBottom.current.lerp(targetBottom.current, t);
    mat.uniforms.uTop.value.copy(currentTop.current);
    mat.uniforms.uBottom.value.copy(currentBottom.current);
  });

  return (
    <mesh position={[0, 4, 0]} frustumCulled={false} renderOrder={-1000}>
      <sphereGeometry args={[140, 40, 20]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={SKY_VERTEX}
        fragmentShader={SKY_FRAGMENT}
        side={THREE.BackSide}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
};

const GIZMO_SCALE = 40;
const GIZMO_AXIS_LENGTH = 1;
const GIZMO_LABEL_OFFSET = 0.18;

const SignedAxis: React.FC<{
  axis: "x" | "y" | "z";
  color: string;
  labelColor: string;
  negativeOpacity: number;
}> = ({ axis, color, labelColor, negativeOpacity }) => {
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

const StageEmptyHint: React.FC = () => (
  <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-sm text-[rgb(var(--muted-foreground))]">
    Visit a page to populate the stage
  </div>
);

const StagePromptBar: React.FC<{
  promptInputRef: React.RefObject<HTMLInputElement | null>;
  prompt: string;
  onPromptChange: (value: string) => void;
  onPromptKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onPromptFocus: () => void;
  onPromptBlur: () => void;
  onSubmit: () => void;
  disabled: boolean;
  sendDisabled: boolean;
}> = ({
  promptInputRef,
  prompt,
  onPromptChange,
  onPromptKeyDown,
  onPromptFocus,
  onPromptBlur,
  onSubmit,
  disabled,
  sendDisabled,
}) => (
  <div className="absolute bottom-4 left-1/2 z-10 flex w-[min(32rem,calc(100%-6rem))] -translate-x-1/2 items-center gap-1 rounded-2xl border border-gray-400 bg-[rgb(var(--background))]/92 p-1 shadow-lg backdrop-blur-sm">
    <input
      ref={promptInputRef}
      type="text"
      value={prompt}
      onChange={(e) => onPromptChange(e.target.value)}
      onKeyDown={onPromptKeyDown}
      onFocus={onPromptFocus}
      onBlur={onPromptBlur}
      placeholder="Ask the agent…"
      disabled={disabled}
      className="min-w-0 flex-1 rounded-xl bg-transparent py-3 pl-4 pr-2 text-sm text-[rgb(var(--foreground))] placeholder:text-[#888] outline-none disabled:opacity-40"
      aria-label="Prompt"
    />
    <button
      type="button"
      onClick={onSubmit}
      disabled={sendDisabled}
      aria-label="Send message"
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-black text-white transition hover:opacity-80 disabled:pointer-events-none disabled:opacity-50"
    >
      <ArrowUp className="size-5" aria-hidden />
    </button>
  </div>
);

const StageMiningButton: React.FC<{
  miningEnabled: boolean;
  disabled: boolean;
  onToggle: () => void;
}> = ({ miningEnabled, disabled, onToggle }) => (
  <button
    type="button"
    aria-label={miningEnabled ? "Disable mining" : "Enable mining"}
    title={miningEnabled ? "Disable mining" : "Enable mining"}
    disabled={disabled}
    className={`absolute bottom-4 left-4 z-10 flex h-11 w-11 items-center justify-center rounded-xl border shadow-md backdrop-blur-sm transition disabled:pointer-events-none disabled:opacity-40 ${
      miningEnabled
        ? "border-red-600 bg-red-500 text-white hover:bg-red-400"
        : "border-[rgb(var(--border))] bg-[rgb(var(--background))]/90 text-[rgb(var(--foreground))] hover:bg-[rgb(var(--muted))]"
    }`}
    onClick={onToggle}
  >
    <span aria-hidden>⛏</span>
  </button>
);

const StageSidebarToggle: React.FC<{
  sidebarOpen: boolean;
  onToggle: () => void;
}> = ({ sidebarOpen, onToggle }) => (
  <button
    type="button"
    aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
    title={sidebarOpen ? "Close sidebar" : "Open sidebar"}
    className="absolute bottom-4 right-4 z-10 flex h-11 w-11 items-center justify-center rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--background))]/90 text-[rgb(var(--foreground))] shadow-md backdrop-blur-sm transition hover:bg-[rgb(var(--muted))]"
    onClick={onToggle}
  >
    {sidebarOpen ? (
      <PanelRightClose className="size-5" aria-hidden />
    ) : (
      <PanelRight className="size-5" aria-hidden />
    )}
  </button>
);

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
      setThumbnails((prev) => {
        const keep = new Set(next.cards.map((c) => c.id));
        let changed = false;
        const pruned: Thumbnails = {};
        for (const id of keep) {
          if (prev[id]) pruned[id] = prev[id];
        }
        if (Object.keys(pruned).length !== Object.keys(prev).length) {
          changed = true;
        }
        return changed ? pruned : prev;
      });
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

      {state.cards.length === 0 ? <StageEmptyHint /> : null}

      {!sidebarOpen ? (
        <StagePromptBar
          promptInputRef={promptInputRef}
          prompt={prompt}
          onPromptChange={setPrompt}
          onPromptKeyDown={handlePromptKeyDown}
          onPromptFocus={() => {
            promptInputFocusedRef.current = true;
            pressedArrowKeysRef.current.clear();
          }}
          onPromptBlur={() => {
            promptInputFocusedRef.current = false;
          }}
          onSubmit={handlePromptSubmit}
          disabled={state.cards.length === 0}
          sendDisabled={state.cards.length === 0 || !prompt.trim()}
        />
      ) : null}

      {!sidebarOpen ? (
        <StageMiningButton
          miningEnabled={miningEnabled}
          disabled={state.cards.length === 0}
          onToggle={() => setMiningEnabled((v) => !v)}
        />
      ) : null}

      <StageSidebarToggle sidebarOpen={sidebarOpen} onToggle={handleToggleSidebar} />
    </div>
  );
};
