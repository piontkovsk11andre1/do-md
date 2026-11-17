import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const encoder = new TextEncoder();

/** SHA-256 over UTF-8 strings or exact byte views, identically in every runtime.
 * Keeping this synchronous preserves Virtual's no-await compare-and-swap step.
 */
export function createContentRevision(content) {
  const bytes = typeof content === "string" ? encoder.encode(content) : content;
  return `sha256:${bytesToHex(sha256(bytes))}`;
}
