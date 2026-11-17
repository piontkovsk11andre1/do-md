/**
 * The first operation decides whether an attempted iteration exists. A miss
 * followed by a later match must not resurrect that attempt. Probe mode becomes
 * required after its first match; explicit optional callbacks stay optional.
 */
export class IterationState {
  /** @type {'unseen' | 'matched' | 'missed'} */
  #first = "unseen";
  #requireAfterMatch = false;

  /** Start an isolated attempt. @param {boolean} [requireAfterMatch] */
  begin(requireAfterMatch = true) {
    this.#first = "unseen";
    this.#requireAfterMatch = requireAfterMatch;
  }

  /** Record a match and return whether the reader must now become required. */
  match() {
    if (this.#first === "unseen") {
      this.#first = "matched";
    }
    const require = this.#requireAfterMatch;
    this.#requireAfterMatch = false;
    return require;
  }

  /** A first miss is sticky until the whole attempt is restored or restarted. */
  miss() {
    if (this.#first === "unseen") {
      this.#first = "missed";
    }
  }
  get firstFailed() {
    return this.#first === "missed";
  }

  /** Snapshot the state without exposing independently mutable flags. */
  clone() {
    const copy = new IterationState();
    copy.#first = this.#first;
    copy.#requireAfterMatch = this.#requireAfterMatch;
    return copy;
  }
}
