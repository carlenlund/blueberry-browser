import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export type SkyGradientColors = { top: string; bottom: string };

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

export function getSkyFallback(isDarkMode: boolean): SkyGradientColors {
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

/** Pull saturated-ish means from top/bottom bands of the thumbnail. */
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

/** Extract two sky gradient stops from a page thumbnail (top = zenith, bottom = horizon). */
export async function extractSkyColorsFromDataUrl(
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

interface StageSkyGradientProps {
  topColor: string;
  bottomColor: string;
}

/** World-space gradient dome — samples active-card palette, lerps on change. */
export const StageSkyGradient: React.FC<StageSkyGradientProps> = ({
  topColor,
  bottomColor,
}) => {
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
