/** Discover a caller-provided safeParse contract without executing it.
 * @template {Record<string, unknown>} T
 * @param {unknown} options @returns {import('./types.d.mts').SafeParseSchema<T> | null}
 */
export function schemaFromOptions(options) {
  if (options == null || typeof options !== "object") {
    return null;
  }
  const candidate = "schema" in options ? options.schema : options;
  if (
    candidate != null &&
    typeof candidate === "object" &&
    "safeParse" in candidate &&
    typeof candidate.safeParse === "function"
  ) {
    return /** @type {import('./types.d.mts').SafeParseSchema<T>} */ (candidate);
  }
  return null;
}
