import React, { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  SPEECH_TRIANGLE_APEX_NDC_X_OFFSET,
  SPEECH_TRIANGLE_APEX_NDC_Y_OFFSET,
  SPEECH_TRIANGLE_EDGE_NDC_X,
  SPEECH_TRIANGLE_NDC_Y_SPREAD,
} from "../stageConstants";
import { ndcToWorldOnPlane } from "../stageLayout";

export const SpeechBubbleTriangle: React.FC<{
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
