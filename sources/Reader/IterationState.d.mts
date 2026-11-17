// Generated from checked JSDoc by npm run types. Do not edit.
/**
 * The first operation decides whether an attempted iteration exists. A miss
 * followed by a later match must not resurrect that attempt. Probe mode becomes
 * required after its first match; explicit optional callbacks stay optional.
 */
export declare class IterationState {
    #private;
    /** Start an isolated attempt. @param {boolean} [requireAfterMatch] */
    begin(requireAfterMatch?: boolean): void;
    /** Record a match and return whether the reader must now become required. */
    match(): boolean;
    /** A first miss is sticky until the whole attempt is restored or restarted. */
    miss(): void;
    get firstFailed(): boolean;
    /** Snapshot the state without exposing independently mutable flags. */
    clone(): IterationState;
}
