// Generated from checked JSDoc by npm run types. Do not edit.
import { SourceText } from "./SourceText.mjs";
export type Diagnostic = import('./types.d.mts').Diagnostic;
export type DiagnosticLocation = import('./types.d.mts').DiagnosticLocation;
export type SourceLocation = import('./SourceText.mjs').SourceLocation;
export type SourceMapSegment = {
    generatedStart: number;
    generatedEnd: number;
    originalStart: number;
    originalEnd: number;
    kind: 'exact' | 'range';
};
export type MapSource = {
    source: string | null;
    text: string;
};
export type SourceMapDefinition = {
    generated: MapSource;
    original: MapSource;
    segments: readonly SourceMapSegment[];
};
/** @typedef {import('./types.d.mts').Diagnostic} Diagnostic */
/** @typedef {import('./types.d.mts').DiagnosticLocation} DiagnosticLocation */
/** @typedef {import('./SourceText.mjs').SourceLocation} SourceLocation */
/** @typedef {{ generatedStart: number, generatedEnd: number, originalStart: number, originalEnd: number, kind: 'exact' | 'range' }} SourceMapSegment */
/** @typedef {{ source: string | null, text: string }} MapSource */
/** @typedef {{ generated: MapSource, original: MapSource, segments: readonly SourceMapSegment[] }} SourceMapDefinition */
/**
 * Immutable, validated mapping between two sources.
 *
 * Generated segments are sorted, disjoint, half-open ranges. Exact segments
 * preserve character offsets; range segments retain a whole provenance span.
 * Gaps deliberately have no origin. This richer range precision is why the
 * internal format is not a point-only Source Map v3/VLQ table.
 */
export declare class SourceMap {
    #private;
    /** Validate once at construction; mappings can subsequently trust the segments.
     * @param {SourceMapDefinition} definition
     */
    constructor({ generated, original, segments }: SourceMapDefinition);
    get generated(): SourceText;
    get original(): SourceText;
    get segments(): readonly Readonly<SourceMapSegment>[];
    /** Map a point, including EOF only when the final segment reaches it.
     * @param {number} offset @returns {SourceLocation | null}
     */
    mapPosition(offset: number): SourceLocation | null;
    /**
     * Map every covered segment. A gap or backwards origin makes the span unmappable;
     * removed intervening source text broadens precision rather than claiming exactness.
     * @param {{ start: number, end?: number | null }} range @returns {SourceLocation | null}
     */
    mapRange({ start, end }: {
        start: number;
        end?: number | null;
    }): SourceLocation | null;
    /** Compose through a shared source; split exact segments at outer boundaries.
     * @param {SourceMap} outer @returns {SourceMap}
     */
    compose(outer: SourceMap): SourceMap;
}
/** Coordinate convenience for a one-off string. Reuse SourceText for repeated lookups.
 * @param {string} text @param {number} offset
 */
export declare function sourcePoint(text: string, offset: number): {
    offset: number;
    line: number;
    column: number;
};
/** @param {string} text @param {{ line: number, column: number }} point */
export declare function sourceOffset(text: string, { line, column }: {
    line: number;
    column: number;
}): number | null;
/** @param {string | null} source @param {string} text @param {number} start @param {number | null} [end]
 * @param {Partial<Pick<DiagnosticLocation, 'role' | 'relation' | 'precision'>>} [options]
 */
export declare function sourceLocation(source: string | null, text: string, start: number, end?: number | null, options?: Partial<Pick<DiagnosticLocation, 'role' | 'relation' | 'precision'>>): import("./SourceText.mjs").SourceLocation;
/** @param {SourceMapDefinition} definition */
export declare function createSourceMap(definition: SourceMapDefinition): SourceMap;
/** @param {SourceMap} map @param {number} offset */
export declare function mapPosition(map: SourceMap, offset: number): import("./SourceText.mjs").SourceLocation | null;
/** @param {SourceMap} map @param {{ start: number, end?: number | null }} range */
export declare function mapRange(map: SourceMap, range: {
    start: number;
    end?: number | null;
}): import("./SourceText.mjs").SourceLocation | null;
/** @param {SourceMap} inner @param {SourceMap} outer */
export declare function composeSourceMaps(inner: SourceMap, outer: SourceMap): SourceMap;
/** Extend a serialized diagnostic without mutating it or increasing precision.
 * @param {Diagnostic | { toDiagnostic(): Diagnostic }} diagnostic @param {SourceMap} map
 * @param {{ role?: DiagnosticLocation['role'] }} [options] @returns {Diagnostic}
 */
export declare function mapDiagnostic(diagnostic: Diagnostic | {
    toDiagnostic(): Diagnostic;
}, map: SourceMap, { role }?: {
    role?: DiagnosticLocation['role'];
}): Diagnostic;
