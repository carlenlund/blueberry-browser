import * as THREE from "three";
import type { Card } from "./stageTypes";
import { CARD_LENGTH, DEFAULT_PAGE_ASPECT } from "./stageConstants";

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

/** Raycast from NDC through the camera onto the horizontal plane at `planeY`. */
export function ndcToWorldOnPlane(
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

export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Map avatar stage coords to normalized coords on a card image (matches CardMesh). */
export function avatarToCardNorm(
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
