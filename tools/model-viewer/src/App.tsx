import { useMemo, useState } from 'react'
import { ModelCanvas } from './components/ModelCanvas'
import {
  animations,
  propModels,
  resolveModelPath,
  variants,
  type AnimationName,
  type PropModelName,
  type SelectedModel,
  type Variant
} from './lib/modelPaths'

type ModelMode = 'variant' | 'prop'

export default function App() {
  const [mode, setMode] = useState<ModelMode>('variant')
  const [variant, setVariant] = useState<Variant>('A')
  const [animation, setAnimation] = useState<AnimationName>('idle')
  const [propModel, setPropModel] = useState<PropModelName>('Keyboard')
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [resetToken, setResetToken] = useState(0)

  const selectedModel: SelectedModel = useMemo(() => {
    if (mode === 'prop') {
      return { kind: 'prop', prop: propModel }
    }
    return { kind: 'variant', variant, animation }
  }, [animation, mode, propModel, variant])

  const modelPath = resolveModelPath(selectedModel)

  return (
    <main className="app">
      <header className="toolbar">
        <h1>Blueberry Model Viewer</h1>
        <div className="toolbar-grid">
          <label>
            Mode
            <select value={mode} onChange={(event) => setMode(event.target.value as ModelMode)}>
              <option value="variant">Variant</option>
              <option value="prop">Prop</option>
            </select>
          </label>

          {mode === 'variant' ? (
            <>
              <label>
                Variant
                <select
                  value={variant}
                  onChange={(event) => setVariant(event.target.value as Variant)}
                >
                  {variants.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Animation
                <select
                  value={animation}
                  onChange={(event) => setAnimation(event.target.value as AnimationName)}
                >
                  {animations.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <label>
              Prop model
              <select
                value={propModel}
                onChange={(event) => setPropModel(event.target.value as PropModelName)}
              >
                {propModels.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            Speed {speed.toFixed(1)}x
            <input
              type="range"
              min={0}
              max={3}
              step={0.1}
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            />
          </label>
        </div>

        <div className="buttons">
          <button type="button" onClick={() => setPlaying((value) => !value)}>
            {playing ? 'Pause' : 'Play'}
          </button>
          <button type="button" onClick={() => setResetToken((value) => value + 1)}>
            Reset animation
          </button>
        </div>
        <code>{modelPath}</code>
      </header>

      <ModelCanvas modelPath={modelPath} playing={playing} speed={speed} resetToken={resetToken} />
    </main>
  )
}
