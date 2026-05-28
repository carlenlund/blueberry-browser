import React, { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  CAMERA_DEFAULT_POSITION,
  DEFAULT_LOOK_AT,
  TALK_CAMERA_OFFSET,
} from "../stageConstants";

export const CameraRig: React.FC<{
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
