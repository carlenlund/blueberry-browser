export const variants = ['A', 'B', 'C'] as const
export const animations = [
  'idle',
  'jump',
  'mining',
  'reading',
  'running',
  'searching',
  'thinking',
  'typing',
  'yessir'
] as const
export const propModels = ['Book', 'Cloud', 'Keyboard', 'Loupe', 'Pickaxe'] as const

export type Variant = (typeof variants)[number]
export type AnimationName = (typeof animations)[number]
export type PropModelName = (typeof propModels)[number]
export type SelectedModel = { kind: 'variant'; variant: Variant; animation: AnimationName } | { kind: 'prop'; prop: PropModelName }

const variantFileStemByAnimation: Record<AnimationName, string> = {
  idle: 'idle',
  jump: 'Jump',
  mining: 'mining',
  reading: 'reading',
  running: 'running',
  searching: 'searching',
  thinking: 'thinking',
  typing: 'typing',
  yessir: 'yessir'
}

const variantPrefix: Record<Variant, string> = {
  A: 'Triangle',
  B: 'Hexagon',
  C: 'Square'
}

export function resolveModelPath(selected: SelectedModel): string {
  if (selected.kind === 'prop') {
    return `${__MODEL_BASE__}/gltf/props/${selected.prop}.glb`
  }

  const prefix = variantPrefix[selected.variant]
  const stem = variantFileStemByAnimation[selected.animation]
  return `${__MODEL_BASE__}/gltf/${selected.variant}/${prefix}-${stem}.glb`
}
