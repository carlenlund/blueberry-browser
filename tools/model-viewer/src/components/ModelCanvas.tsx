import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { SkeletonUtils } from 'three-stdlib'

type ModelCanvasProps = {
  modelPath: string
  playing: boolean
  speed: number
  resetToken: number
}

function ModelInstance({ modelPath, playing, speed, resetToken }: ModelCanvasProps) {
  const { scene, animations } = useGLTF(modelPath)
  // Skinned meshes need SkeletonUtils.clone for animation bindings to work reliably.
  const root = useMemo(() => SkeletonUtils.clone(scene), [scene])
  const mixerRef = useRef<THREE.AnimationMixer | null>(null)

  useEffect(() => {
    const mixer = new THREE.AnimationMixer(root)
    const actions = animations.map((clip) => mixer.clipAction(clip))
    actions.forEach((action) => action.play())

    mixer.timeScale = playing ? speed : 0
    mixerRef.current = mixer

    return () => {
      actions.forEach((action) => action.stop())
      mixer.stopAllAction()
      mixerRef.current = null
    }
  }, [animations, root])

  useEffect(() => {
    if (mixerRef.current) {
      mixerRef.current.timeScale = playing ? speed : 0
    }
  }, [playing, speed])

  useEffect(() => {
    if (mixerRef.current) {
      mixerRef.current.setTime(0)
    }
  }, [resetToken])

  useFrame((_, delta) => {
    if (mixerRef.current) {
      mixerRef.current.update(delta)
    }
  })

  return <primitive object={root} scale={1} />
}

export function ModelCanvas(props: ModelCanvasProps) {
  return (
    <div className="canvas-wrap">
      <Canvas camera={{ position: [0, 1.6, 5], fov: 45 }}>
        <color attach="background" args={['#0b1020']} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[6, 8, 4]} intensity={1.2} />
        <Suspense fallback={null}>
          <ModelInstance {...props} />
        </Suspense>
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  )
}
