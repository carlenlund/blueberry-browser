import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import triangleModelUrl from "../../../../../resources/models/gltf/A/Triangle-running.glb?url";
import triangleMiningModelUrl from "../../../../../resources/models/gltf/A/Triangle-mining.glb?url";
import triangleIdleModelUrl from "../../../../../resources/models/gltf/A/Triangle-idle.glb?url";
import triangleThinkingModelUrl from "../../../../../resources/models/gltf/A/Triangle-thinking.glb?url";
import triangleJumpModelUrl from "../../../../../resources/models/gltf/A/Triangle-Jump.glb?url";
import {
  ARROW_MOVE_SPEED,
  AVATAR_CLIP_FPS,
  AVATAR_LOCOMOTION_LOOP,
  AVATAR_SUBTLE_LOOP,
  AVATAR_TALK_YAW,
  AVATAR_WALK_DAMP,
  AVATAR_YAW_OFFSET,
  AVATAR_HEIGHT,
  CARD_LENGTH,
  CARD_SURFACE_Y,
  DEFAULT_PAGE_ASPECT,
  GROUND_CONTACT_EPSILON,
  GRAVITY,
  JUMP_VELOCITY,
  VOID_RESPAWN_Y,
  type AvatarLoopProfile,
} from "../stageConstants";
import type { Card, StageCardLayoutEntry } from "../stageTypes";

export function findCardAtStagePosition(
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

type AvatarGltf = {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
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
  const sceneClone = useMemo(() => clone(gltf.scene) as THREE.Group, [gltf]);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const actionsRef = useRef<THREE.AnimationAction[]>([]);
  const bootedRef = useRef(false);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(sceneClone);
    const actions: THREE.AnimationAction[] = [];
    for (const sourceClip of gltf.animations) {
      const loopClip = trimAvatarLoopClip(stripBrowTracks(sourceClip), loopProfile);
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

export type AvatarLocomotionMode = "running" | "mining" | "idle" | "thinking";
type AvatarDisplayMode = AvatarLocomotionMode | "jumping";

export interface AvatarProps {
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

export const Avatar = forwardRef<THREE.Group, AvatarProps>(function Avatar(
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
  },
  forwardedRef
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
  const voidFallingRef = useRef(false);
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
    voidFallingRef.current = false;
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

  // Run before Scene counter-scroll so group offset matches this frame's avatar X.
  useFrame((_, delta) => {
    if (!root.current) return;
    const keys = pressedArrowKeysRef.current;
    const voidFalling = voidFallingRef.current;
    const keyboardMoving = !talkMode && !voidFalling && keys.size > 0;

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
    } else if (voidFalling) {
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
      if (!voidFalling && !onCard && verticalY.current < groundY - GROUND_CONTACT_EPSILON) {
        voidFallingRef.current = true;
        keys?.clear();
        jumpRequestedRef.current = false;
      }
      const inVoidFall = voidFallingRef.current;

      if (jumpRequestedRef.current) {
        jumpRequestedRef.current = false;
        if (!inVoidFall && groundedOnCard) {
          verticalVelocity.current = JUMP_VELOCITY;
          pendingJumpClickRef.current = true;
        }
      }
      if (onCard && !inVoidFall) {
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
    const yawDelta =
      THREE.MathUtils.euclideanModulo(
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
  }, 0);

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
