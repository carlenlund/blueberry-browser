import React, { useEffect, useRef, useState } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import {
  CARD_CUBE_HEIGHT,
  CARD_LENGTH,
  CARD_SURFACE_Y,
} from "../stageConstants";

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
        tex.flipY = true;
        tex.colorSpace = THREE.SRGBColorSpace;
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

export interface CardMeshProps {
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

export const CardMesh: React.FC<CardMeshProps> = ({
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
    const cardNormX = THREE.MathUtils.clamp(local.x / CARD_LENGTH + 0.5, 0, 1);
    const cardNormDepth = THREE.MathUtils.clamp(local.y / CARD_LENGTH + 0.5, 0, 1);

    const imageNormW = imageWidth / CARD_LENGTH;
    const padX = (1 - imageNormW) / 2;
    const normX = THREE.MathUtils.clamp((cardNormX - padX) / imageNormW, 0, 1);
    const normY = THREE.MathUtils.clamp(1.0 - cardNormDepth, 0, 1);
    return { normX, normY, localX: local.x, localZ: local.y };
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>): void => {
    if (!clickable || e.button !== 0) return;
    e.stopPropagation();
    const mapped = projectPointToCard(e);
    if (!mapped) return;
    const runToX = x + mapped.localX;
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

      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[CARD_LENGTH + 0.06, CARD_LENGTH + 0.06]} />
        <meshBasicMaterial color={border} toneMapped={false} transparent opacity={opacity} />
      </mesh>

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
