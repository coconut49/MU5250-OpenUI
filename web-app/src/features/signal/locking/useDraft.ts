import { useReducer, useState, type Dispatch } from 'react'
import { initDraft, reduceDraft, type DraftAction, type DraftSpec, type DraftState } from './draft'

/**
 * Reducer-backed draft fed by the heartbeat. `tick` changes with every heartbeat payload (new object
 * identity); `obs` is the semantic observation. Each new tick is fed to the reducer, which ignores it
 * when nothing semantically changed. `spec` must be a stable module-level constant.
 */
export function useDraft<O, V>(spec: DraftSpec<O, V>, obs: O, tick: unknown): [DraftState<O, V>, Dispatch<DraftAction<O, V>>] {
  const [state, dispatch] = useReducer(
    (s: DraftState<O, V>, a: DraftAction<O, V>) => reduceDraft(spec, s, a),
    obs,
    (o: O) => initDraft(spec, o),
  )
  const [seen, setSeen] = useState(tick)
  if (seen !== tick) {
    // Adjusting state during render (same pattern as usePoll): React re-runs this render immediately.
    setSeen(tick)
    dispatch({ type: 'observe', obs })
  }
  return [state, dispatch]
}
