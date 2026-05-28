import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type {
  Card,
  RunToPointEvent,
  Thumbnails,
  StageCardLayoutEntry,
} from "../stageTypes";
import {
  AVATAR_HEAD_LOCAL,
  AVATAR_SPEECH_APEX_LOCAL,
  AVATAR_VISUAL_CENTER_LOCAL,
  CARD_GAP,
  CARD_LENGTH,
  DEFAULT_PAGE_ASPECT,
  MINE_LETTERS_PER_BATCH,
  MINE_TICK_MS,
  MINING_MS,
  NEW_CARD_WALK_DELAY_MS,
  PRECLICK_RUN_MS,
  PREMOVE_MARK_MS,
  SPEECH_TRIANGLE_APEX_NDC_X_OFFSET,
  SPEECH_TRIANGLE_APEX_NDC_Y_OFFSET,
  SPEECH_TRIANGLE_EDGE_NDC_X,
  SPEECH_TRIANGLE_NDC_Y_SPREAD,
} from "../stageConstants";
import { Avatar, findCardAtStagePosition } from "./Avatar";
import { CardMesh } from "./CardMesh";

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

export interface SceneProps {
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

export const Scene: React.FC<SceneProps> = ({
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
      if (navWalkTimerRef.current !== null) {
        window.clearTimeout(navWalkTimerRef.current);
        navWalkTimerRef.current = null;
      }
      if (!miningEnabledRef.current) {
        stopDomMining();
      } else if (miningTimerRef.current !== null) {
        window.clearTimeout(miningTimerRef.current);
        miningTimerRef.current = null;
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

  // After Avatar movement (priority 0) so counter-scroll matches the same frame.
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
  }, 1);

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
