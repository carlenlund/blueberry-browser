import React from "react";
import { Line, Text } from "@react-three/drei";

const GIZMO_SCALE = 40;
const GIZMO_AXIS_LENGTH = 1;
const GIZMO_LABEL_OFFSET = 0.18;

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

export const SignedAxisGizmo: React.FC<{ isDarkMode: boolean }> = ({ isDarkMode }) => {
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
