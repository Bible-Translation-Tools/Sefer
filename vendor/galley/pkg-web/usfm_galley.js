/* @ts-self-types="./usfm_galley.d.ts" */

/**
 * The corpus, resident: one [`Expediter`], one Pantry, one snapshot out.
 *
 * One per project, not per document. Books go in whole by caller id and come
 * back as one complete publication; the Pantry inside owns the chunk cache,
 * so the onion methods read the same warm chunks the analysis does.
 */
export class Galley {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GalleyFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_galley_free(ptr, 0);
    }
    /**
     * A copy of the knobs the next [`publish`](Self::publish) judges with.
     * @returns {Knobs}
     */
    config() {
        const ret = wasm.galley_config(this.__wbg_ptr);
        return Knobs.__wrap(ret);
    }
    /**
     * Cached chunk units. Zero for a one-chapter book: galley does not cache
     * what it cannot reuse.
     * @returns {number}
     */
    entryCount() {
        const ret = wasm.galley_entryCount(this.__wbg_ptr);
        return ret;
    }
    /**
     * Books rescanned for sites rather than replaying cached rows.
     * @returns {number}
     */
    lastLocated() {
        const ret = wasm.galley_lastLocated(this.__wbg_ptr);
        return ret;
    }
    /**
     * Chapters mapped by the last [`publish`](Self::publish).
     * @returns {number}
     */
    lastMapped() {
        const ret = wasm.galley_lastMapped(this.__wbg_ptr);
        return ret;
    }
    /**
     * Targets re-paired against their declared source.
     * @returns {number}
     */
    lastPaired() {
        const ret = wasm.galley_lastPaired(this.__wbg_ptr);
        return ret;
    }
    /**
     * Of those, the ones that kept an observation and re-walked only part.
     * @returns {number}
     */
    lastRemapped() {
        const ret = wasm.galley_lastRemapped(this.__wbg_ptr);
        return ret;
    }
    /**
     * Declared sources the source-copy lane would have read and could not,
     * because they were registered while `knobs.source_copy` was off and so
     * kept no word lane.
     *
     * Nonzero after turning the lane on means "re-send those references'
     * text", not "nothing was found".
     * @returns {number}
     */
    lastWordlessReferences() {
        const ret = wasm.galley_lastWordlessReferences(this.__wbg_ptr);
        return ret;
    }
    /**
     * Chunk units computed rather than reused, cumulative.
     * @returns {number}
     */
    misses() {
        const ret = wasm.galley_misses(this.__wbg_ptr);
        return ret;
    }
    /**
     * `budgetBytes` bounds resident products; omit it for 16 MB.
     * @param {number | null} [budget_bytes]
     */
    constructor(budget_bytes) {
        const ret = wasm.galley_new(!isLikeNone(budget_bytes), isLikeNone(budget_bytes) ? 0 : budget_bytes);
        this.__wbg_ptr = ret;
        GalleyFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * The book, plated — the same buffer `onion_wasm::parse` returns, with
     * the lex, the tree and the lint walk reused for every chunk whose bytes
     * did not change.
     *
     * Read it with the same `reader.ts` the stateless door's output uses:
     * nothing here is a new rendering, only a cheaper route to the same bytes.
     * @param {string} text
     * @param {boolean} diagnostics
     * @param {boolean} toc
     * @param {boolean} utf16
     * @returns {Uint8Array}
     */
    parse(text, diagnostics, toc, utf16) {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.galley_parse(this.__wbg_ptr, ptr0, len0, diagnostics, toc, utf16);
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * One complete corpus publication over every target, in canonical book
     * order, in raw-book UTF-16 — the buffer `FindingsSnapshot.open` reads.
     *
     * A snapshot replaces the previous one whole; row positions are valid
     * only inside the buffer they came from.
     * @returns {Uint8Array}
     */
    publish() {
        const ret = wasm.galley_publish(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Drop a book, its text, and its cached rows. `false` when the id was
     * never registered.
     * @param {string} id
     * @returns {boolean}
     */
    remove(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.galley_remove(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Resident bytes across the whole handle: the Pantry's texts and
     * products, and the Expediter's own cached rows.
     * @returns {number}
     */
    residentBytes() {
        const ret = wasm.galley_residentBytes(this.__wbg_ptr);
        return ret;
    }
    /**
     * Replaces them. No chapter is remapped and no book refolded — judging
     * reads the config, mapping does not — so a knob flip costs a re-judge.
     * @param {Knobs} knobs
     */
    setConfig(knobs) {
        _assertClass(knobs, Knobs);
        var ptr0 = knobs.__destroy_into_raw();
        wasm.galley_setConfig(this.__wbg_ptr, ptr0);
    }
    /**
     * The structure recipe's text, the verse-text mask's sibling.
     * @param {string} text
     * @returns {string}
     */
    structureText(text) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.galley_structureText(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * Register or replace one whole book under the caller's `id`, as a
     * target: it keeps its text, and it publishes findings.
     *
     * Returns the `\id` line's canonical book code — `"MRK"` — which is what
     * orders the publication. Idempotent: the same text costs a checksum.
     *
     * `text` must be LF-normalized, the contract every door here documents.
     * @param {string} id
     * @param {string} text
     * @returns {string}
     */
    update(id, text) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.galley_update(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * The same, as a declared source: one projected grapheme length per
     * verse and no text at all, so a reference costs a fraction of a target.
     *
     * A reference publishes no findings of its own; it is the denominator
     * the length lane compares a target's verses against.
     * @param {string} id
     * @param {string} text
     * @returns {string}
     */
    updateReference(id, text) {
        let deferred4_0;
        let deferred4_1;
        try {
            const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.galley_updateReference(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            var ptr3 = ret[0];
            var len3 = ret[1];
            if (ret[3]) {
                ptr3 = 0; len3 = 0;
                throw takeFromExternrefTable0(ret[2]);
            }
            deferred4_0 = ptr3;
            deferred4_1 = len3;
            return getStringFromWasm0(ptr3, len3);
        } finally {
            wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
        }
    }
    /**
     * The verse text alone, as one string — the reading a downstream text
     * consumer wants, off the same reused ingredients.
     *
     * TODO: this DISCARDS the mask. `Mask` carries `ranges`/`starts` — the map
     * from a masked offset back to the source — and sous needs it to report a
     * finding against the unmasked document. Returning the text alone means
     * whatever consumes this cannot get back.
     * @param {string} text
     * @returns {string}
     */
    verseText(text) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.galley_verseText(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
}
if (Symbol.dispose) Galley.prototype[Symbol.dispose] = Galley.prototype.free;

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
    static __wrap(ptr) {
        const obj = Object.create(Knobs.prototype);
        obj.__wbg_ptr = ptr;
        KnobsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        KnobsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_knobs_free(ptr, 0);
    }
    /**
     * @returns {boolean}
     */
    get casing() {
        const ret = wasm.__wbg_get_knobs_casing(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get doubled() {
        const ret = wasm.__wbg_get_knobs_doubled(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get doubles_productive_bp() {
        const ret = wasm.__wbg_get_knobs_doubles_productive_bp(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get exact_neighbor() {
        const ret = wasm.__wbg_get_knobs_exact_neighbor(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get lengths_enabled() {
        const ret = wasm.__wbg_get_knobs_lengths_enabled(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get letter_runs() {
        const ret = wasm.__wbg_get_knobs_letter_runs(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get min_verses() {
        const ret = wasm.__wbg_get_knobs_min_verses(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    get placement() {
        const ret = wasm.__wbg_get_knobs_placement(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get pooled_neighbor() {
        const ret = wasm.__wbg_get_knobs_pooled_neighbor(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get presence() {
        const ret = wasm.__wbg_get_knobs_presence(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get rarity() {
        const ret = wasm.__wbg_get_knobs_rarity(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get run_shape() {
        const ret = wasm.__wbg_get_knobs_run_shape(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get sentence_start_upper_bp() {
        const ret = wasm.__wbg_get_knobs_sentence_start_upper_bp(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get sentence_start() {
        const ret = wasm.__wbg_get_knobs_sentence_start(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get source_copy_min_run() {
        const ret = wasm.__wbg_get_knobs_source_copy_min_run(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    get source_copy() {
        const ret = wasm.__wbg_get_knobs_source_copy(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get support_floor() {
        const ret = wasm.__wbg_get_knobs_support_floor(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get terminal_upper_share_bp() {
        const ret = wasm.__wbg_get_knobs_terminal_upper_share_bp(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get word_length_sigma() {
        const ret = wasm.__wbg_get_knobs_word_length_sigma(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {boolean}
     */
    get word_length() {
        const ret = wasm.__wbg_get_knobs_word_length(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get word_support_floor() {
        const ret = wasm.__wbg_get_knobs_word_support_floor(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get z_long() {
        const ret = wasm.__wbg_get_knobs_z_long(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get z_short() {
        const ret = wasm.__wbg_get_knobs_z_short(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {boolean} arg0
     */
    set casing(arg0) {
        wasm.__wbg_set_knobs_casing(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set doubled(arg0) {
        wasm.__wbg_set_knobs_doubled(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set doubles_productive_bp(arg0) {
        wasm.__wbg_set_knobs_doubles_productive_bp(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set exact_neighbor(arg0) {
        wasm.__wbg_set_knobs_exact_neighbor(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set lengths_enabled(arg0) {
        wasm.__wbg_set_knobs_lengths_enabled(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set letter_runs(arg0) {
        wasm.__wbg_set_knobs_letter_runs(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set min_verses(arg0) {
        wasm.__wbg_set_knobs_min_verses(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set placement(arg0) {
        wasm.__wbg_set_knobs_placement(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set pooled_neighbor(arg0) {
        wasm.__wbg_set_knobs_pooled_neighbor(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set presence(arg0) {
        wasm.__wbg_set_knobs_presence(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set rarity(arg0) {
        wasm.__wbg_set_knobs_rarity(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set run_shape(arg0) {
        wasm.__wbg_set_knobs_run_shape(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set sentence_start_upper_bp(arg0) {
        wasm.__wbg_set_knobs_sentence_start_upper_bp(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set sentence_start(arg0) {
        wasm.__wbg_set_knobs_sentence_start(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set source_copy_min_run(arg0) {
        wasm.__wbg_set_knobs_source_copy_min_run(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set source_copy(arg0) {
        wasm.__wbg_set_knobs_source_copy(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set support_floor(arg0) {
        wasm.__wbg_set_knobs_support_floor(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set terminal_upper_share_bp(arg0) {
        wasm.__wbg_set_knobs_terminal_upper_share_bp(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set word_length_sigma(arg0) {
        wasm.__wbg_set_knobs_word_length_sigma(this.__wbg_ptr, arg0);
    }
    /**
     * @param {boolean} arg0
     */
    set word_length(arg0) {
        wasm.__wbg_set_knobs_word_length(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set word_support_floor(arg0) {
        wasm.__wbg_set_knobs_word_support_floor(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set z_long(arg0) {
        wasm.__wbg_set_knobs_z_long(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set z_short(arg0) {
        wasm.__wbg_set_knobs_z_short(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) Knobs.prototype[Symbol.dispose] = Knobs.prototype.free;
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_408e67f47ca7b58b: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg___wbindgen_throw_bb96b2010945f0bc: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./usfm_galley_bg.js": import0,
    };
}

const GalleyFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_galley_free(ptr, 1));
const KnobsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_knobs_free(ptr, 1));

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('usfm_galley_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
