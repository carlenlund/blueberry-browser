import React, { useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { GizmoHelper } from "@react-three/drei";
import * as THREE from "three";
import { useDarkMode } from "@common/hooks/useDarkMode";
import type { StageState, ThumbnailEvent, Thumbnails } from "./stageTypes";
import {
  extractSkyColorsFromDataUrl,
  getSkyFallback,
  StageSkyGradient,
  type SkyGradientColors,
} from "./stageSky";
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
import { SignedAxisGizmo } from "./components/SignedAxisGizmo";
import {
  StageEmptyHint,
  StageMiningButton,
  StagePromptBar,
  StageSidebarToggle,
} from "./components/StageHud";

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
