// Generated from checked JSDoc by npm run types. Do not edit.
/** Discover a caller-provided safeParse contract without executing it.
 * @template {Record<string, unknown>} T
 * @param {unknown} options @returns {import('./types.d.mts').SafeParseSchema<T> | null}
 */
export declare function schemaFromOptions<T extends Record<string, unknown>>(
  options: unknown,
): import("./types.d.mts").SafeParseSchema<T> | null;
