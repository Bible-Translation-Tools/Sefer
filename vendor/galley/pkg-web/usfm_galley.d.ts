/* tslint:disable */
/* eslint-disable */

/**
 * The corpus, resident: one [`Expediter`], one Pantry, one snapshot out.
 *
 * One per project, not per document. Books go in whole by caller id and come
 * back as one complete publication; the Pantry inside owns the chunk cache,
 * so the onion methods read the same warm chunks the analysis does.
 */
export class Galley {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * A copy of the knobs the next [`publish`](Self::publish) judges with.
     */
    config(): Knobs;
    /**
     * Cached chunk units. Zero for a one-chapter book: galley does not cache
     * what it cannot reuse.
     */
    entryCount(): number;
    /**
     * Books rescanned for sites rather than replaying cached rows.
     */
    lastLocated(): number;
    /**
     * Chapters mapped by the last [`publish`](Self::publish).
     */
    lastMapped(): number;
    /**
     * Targets re-paired against their declared source.
     */
    lastPaired(): number;
    /**
     * Of those, the ones that kept an observation and re-walked only part.
     */
    lastRemapped(): number;
    /**
     * Declared sources the source-copy lane would have read and could not,
     * because they were registered while `knobs.source_copy` was off and so
     * kept no word lane.
     *
     * Nonzero after turning the lane on means "re-send those references'
     * text", not "nothing was found".
     */
    lastWordlessReferences(): number;
    /**
     * Chunk units computed rather than reused, cumulative.
     */
    misses(): number;
    /**
     * `budgetBytes` bounds resident products; omit it for 16 MB.
     */
    constructor(budget_bytes?: number | null);
    /**
     * The book, plated — the same buffer `onion_wasm::parse` returns, with
     * the lex, the tree and the lint walk reused for every chunk whose bytes
     * did not change.
     *
     * Read it with the same `reader.ts` the stateless door's output uses:
     * nothing here is a new rendering, only a cheaper route to the same bytes.
     */
    parse(text: string, diagnostics: boolean, toc: boolean, utf16: boolean): Uint8Array;
    /**
     * One complete corpus publication over every target, in canonical book
     * order, in raw-book UTF-16 — the buffer `FindingsSnapshot.open` reads.
     *
     * A snapshot replaces the previous one whole; row positions are valid
     * only inside the buffer they came from.
     */
    publish(): Uint8Array;
    /**
     * Drop a book, its text, and its cached rows. `false` when the id was
     * never registered.
     */
    remove(id: string): boolean;
    /**
     * Resident bytes across the whole handle: the Pantry's texts and
     * products, and the Expediter's own cached rows.
     */
    residentBytes(): number;
    /**
     * Replaces them. No chapter is remapped and no book refolded — judging
     * reads the config, mapping does not — so a knob flip costs a re-judge.
     */
    setConfig(knobs: Knobs): void;
    /**
     * The structure recipe's text, the verse-text mask's sibling.
     */
    structureText(text: string): string;
    /**
     * Register or replace one whole book under the caller's `id`, as a
     * target: it keeps its text, and it publishes findings.
     *
     * Returns the `\id` line's canonical book code — `"MRK"` — which is what
     * orders the publication. Idempotent: the same text costs a checksum.
     *
     * `text` must be LF-normalized, the contract every door here documents.
     */
    update(id: string, text: string): string;
    /**
     * The same, as a declared source: one projected grapheme length per
     * verse and no text at all, so a reference costs a fraction of a target.
     *
     * A reference publishes no findings of its own; it is the denominator
     * the length lane compares a target's verses against.
     */
    updateReference(id: string, text: string): string;
    /**
     * The verse text alone, as one string — the reading a downstream text
     * consumer wants, off the same reused ingredients.
     *
     * TODO: this DISCARDS the mask. `Mask` carries `ranges`/`starts` — the map
     * from a masked offset back to the source — and sous needs it to report a
     * finding against the unmasked document. Returning the text alone means
     * whatever consumes this cannot get back.
     */
    verseText(text: string): string;
}

/**
 * The judging knobs that cross the wall: every plain scalar of
 * [`JudgingConfig`], flat, so bindgen writes the getters and setters and JS
 * assigns `knobs.casing = false`.
 *
 * Not on the wall: `bands` and `word_bands` (a `Staircase` is a validated
 * ladder, not a plain field), `letters` and `doubles` (tri-state policies),
 * and the roster bounds. They have no plain-field shape and no consumer has
 * asked for them; everything not a knob keeps the current config's value
 * through [`apply`](Knobs::apply), so widening this later breaks nothing.
 */
export class Knobs {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    casing: boolean;
    doubled: boolean;
    doubles_productive_bp: number;
    exact_neighbor: boolean;
    lengths_enabled: boolean;
    letter_runs: boolean;
    min_verses: number;
    placement: boolean;
    pooled_neighbor: boolean;
    presence: boolean;
    rarity: boolean;
    run_shape: boolean;
    sentence_start_upper_bp: number;
    sentence_start: boolean;
    source_copy_min_run: number;
    source_copy: boolean;
    support_floor: number;
    terminal_upper_share_bp: number;
    word_length_sigma: number;
    word_length: boolean;
    word_support_floor: number;
    z_long: number;
    z_short: number;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_galley_free: (a: number, b: number) => void;
    readonly __wbg_get_knobs_casing: (a: number) => number;
    readonly __wbg_get_knobs_doubled: (a: number) => number;
    readonly __wbg_get_knobs_doubles_productive_bp: (a: number) => number;
    readonly __wbg_get_knobs_exact_neighbor: (a: number) => number;
    readonly __wbg_get_knobs_lengths_enabled: (a: number) => number;
    readonly __wbg_get_knobs_letter_runs: (a: number) => number;
    readonly __wbg_get_knobs_min_verses: (a: number) => number;
    readonly __wbg_get_knobs_placement: (a: number) => number;
    readonly __wbg_get_knobs_pooled_neighbor: (a: number) => number;
    readonly __wbg_get_knobs_presence: (a: number) => number;
    readonly __wbg_get_knobs_rarity: (a: number) => number;
    readonly __wbg_get_knobs_run_shape: (a: number) => number;
    readonly __wbg_get_knobs_sentence_start: (a: number) => number;
    readonly __wbg_get_knobs_sentence_start_upper_bp: (a: number) => number;
    readonly __wbg_get_knobs_source_copy: (a: number) => number;
    readonly __wbg_get_knobs_source_copy_min_run: (a: number) => number;
    readonly __wbg_get_knobs_support_floor: (a: number) => number;
    readonly __wbg_get_knobs_terminal_upper_share_bp: (a: number) => number;
    readonly __wbg_get_knobs_word_length: (a: number) => number;
    readonly __wbg_get_knobs_word_length_sigma: (a: number) => number;
    readonly __wbg_get_knobs_word_support_floor: (a: number) => number;
    readonly __wbg_get_knobs_z_long: (a: number) => number;
    readonly __wbg_get_knobs_z_short: (a: number) => number;
    readonly __wbg_knobs_free: (a: number, b: number) => void;
    readonly __wbg_set_knobs_casing: (a: number, b: number) => void;
    readonly __wbg_set_knobs_doubled: (a: number, b: number) => void;
    readonly __wbg_set_knobs_doubles_productive_bp: (a: number, b: number) => void;
    readonly __wbg_set_knobs_exact_neighbor: (a: number, b: number) => void;
    readonly __wbg_set_knobs_lengths_enabled: (a: number, b: number) => void;
    readonly __wbg_set_knobs_letter_runs: (a: number, b: number) => void;
    readonly __wbg_set_knobs_min_verses: (a: number, b: number) => void;
    readonly __wbg_set_knobs_placement: (a: number, b: number) => void;
    readonly __wbg_set_knobs_pooled_neighbor: (a: number, b: number) => void;
    readonly __wbg_set_knobs_presence: (a: number, b: number) => void;
    readonly __wbg_set_knobs_rarity: (a: number, b: number) => void;
    readonly __wbg_set_knobs_run_shape: (a: number, b: number) => void;
    readonly __wbg_set_knobs_sentence_start: (a: number, b: number) => void;
    readonly __wbg_set_knobs_sentence_start_upper_bp: (a: number, b: number) => void;
    readonly __wbg_set_knobs_source_copy: (a: number, b: number) => void;
    readonly __wbg_set_knobs_source_copy_min_run: (a: number, b: number) => void;
    readonly __wbg_set_knobs_support_floor: (a: number, b: number) => void;
    readonly __wbg_set_knobs_terminal_upper_share_bp: (a: number, b: number) => void;
    readonly __wbg_set_knobs_word_length: (a: number, b: number) => void;
    readonly __wbg_set_knobs_word_length_sigma: (a: number, b: number) => void;
    readonly __wbg_set_knobs_word_support_floor: (a: number, b: number) => void;
    readonly __wbg_set_knobs_z_long: (a: number, b: number) => void;
    readonly __wbg_set_knobs_z_short: (a: number, b: number) => void;
    readonly galley_config: (a: number) => number;
    readonly galley_entryCount: (a: number) => number;
    readonly galley_lastLocated: (a: number) => number;
    readonly galley_lastMapped: (a: number) => number;
    readonly galley_lastPaired: (a: number) => number;
    readonly galley_lastRemapped: (a: number) => number;
    readonly galley_lastWordlessReferences: (a: number) => number;
    readonly galley_misses: (a: number) => number;
    readonly galley_new: (a: number, b: number) => number;
    readonly galley_parse: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly galley_publish: (a: number) => [number, number, number, number];
    readonly galley_remove: (a: number, b: number, c: number) => number;
    readonly galley_residentBytes: (a: number) => number;
    readonly galley_setConfig: (a: number, b: number) => void;
    readonly galley_structureText: (a: number, b: number, c: number) => [number, number];
    readonly galley_update: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly galley_updateReference: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly galley_verseText: (a: number, b: number, c: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
