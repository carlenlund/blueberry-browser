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
  const desiredPos = useRef(CAMERA_DEFAULT_POSITION.clone());
  const desiredLook = useRef(DEFAULT_LOOK_AT.clone());

  // After Scene updates avatar world refs (priority 1).
  useFrame((_, delta) => {
    if (talkMode) {
      const anchor = avatarCenterWorldRef.current;
      desiredPos.current.copy(anchor).add(TALK_CAMERA_OFFSET);
      desiredLook.current.copy(anchor);
      const t = 1 - Math.exp(-8 * delta);
      camera.position.lerp(desiredPos.current, t);
      lookTargetRef.current.lerp(desiredLook.current, t);
      camera.lookAt(lookTargetRef.current);
      return;
    }

    desiredPos.current.copy(CAMERA_DEFAULT_POSITION).multiplyScalar(1 / zoom);
    camera.position.copy(desiredPos.current);
    lookTargetRef.current.copy(DEFAULT_LOOK_AT);
    camera.lookAt(lookTargetRef.current);
  }, 2);

  return null;
};
