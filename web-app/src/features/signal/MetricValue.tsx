import type { SignalMetric } from '../../data/signalQuality'
import { Unavailable } from '../../ui/primitives'
import { metricView } from './telemetryView'

/**
 * One RSRP/RSRQ/SINR/RSSI reading: raw value in its own precision, coloured by the
 * single policy (data/signalQuality), with the quality word shown as well so colour is
 * never the only signal. Unknown readings are neutral "Unavailable"; RSSI is neutral.
 * `data-metric` / `data-level` / `data-tone` are stable hooks for the browser specs.
 */
export function MetricValue({ metric, value, word = true }: { metric: SignalMetric; value: unknown; word?: boolean }) {
  const v = metricView(metric, value)
  if (v.text === null) {
    return (
      <span data-metric={metric} data-level="unknown" data-tone="neutral" className="inline-block text-ink3">
        <Unavailable label={`${v.description}`} />
      </span>
    )
  }
  return (
    <span data-metric={metric} data-level={v.level} data-tone={v.tone} className={`inline-flex flex-col ${v.className}`}>
      <span className="tnum font-mono">{v.text}</span>
      {v.word && (word ? <span className="font-sans text-caption font-medium">{v.word}</span> : <span className="sr-only">{v.word}</span>)}
    </span>
  )
}
