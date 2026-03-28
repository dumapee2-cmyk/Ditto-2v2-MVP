/**
 * Run an async operation with a timeout that actually cancels the underlying request
 * via AbortController. The factory receives an AbortSignal to pass to the SDK.
 */
export async function withTimeout<T>(
  factory: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await factory(controller.signal);
    return result;
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}
