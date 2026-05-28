import { useEffect, useState } from "react";
import * as THREE from "three";

export function useImageTexture(dataUrl: string | undefined): THREE.Texture | null {
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
