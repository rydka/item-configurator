/**
 * Timeout and abort helpers shared by the AI clients. Pure: no Foundry global, nothing runs at import.
 */

/**
 * Run `task(signal)` with a timeout and an optional external signal.
 * @param {number} timeoutMs
 * @param {AbortSignal} [external]
 * @param {function(AbortSignal): Promise<*>} task
 * @returns {Promise<{ value?: *, reason?: "timeout"|"aborted"|"error", error?: string }>}
 */
export async function guarded(timeoutMs, external, task) {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort();
  if ( external?.aborted ) return { reason: "aborted" };
  external?.addEventListener?.("abort", onAbort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    return { value: await task(controller.signal) };
  } catch(err) {
    if ( timedOut ) return { reason: "timeout" };
    if ( external?.aborted || (err?.name === "AbortError") ) return { reason: "aborted" };
    return { reason: "error", error: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
    external?.removeEventListener?.("abort", onAbort);
  }
}

/**
 * Wait `ms`, or reject with an AbortError as soon as `signal` fires.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); };
    if ( signal?.aborted ) return abort();
    const timer = setTimeout(() => { signal?.removeEventListener?.("abort", abort); resolve(); }, ms);
    signal?.addEventListener?.("abort", abort, { once: true });
  });
}
