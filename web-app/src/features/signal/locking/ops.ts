/** One device operation at a time on the locking page: conflicting controls lock while one runs. */
export interface Ops {
  busy: boolean
  /** Runs `fn` unless another operation is in flight (a repeated click cannot start a second one). */
  run: (fn: () => Promise<void>) => Promise<void>
}
