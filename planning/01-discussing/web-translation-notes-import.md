# Fast Web import for Translation Notes

**Status:** idea to preserve, 2026-09-19. No implementation authorized. The roughly 27,000 note files are a user-reported corpus size, not a benchmark measured in this pass. A count of `en_tn_condensed` on 2026-09-25 found 26,001 verse files and 70 intros, 55,833 notes, 5.75 MB in all; the resource-level discussion (what TN answers, how it is edited) is in [resource kinds](../00-ideas/resource-kinds.md).

## Problem and current evidence

The old editor's Web ZIP/remote-archive path materializes raw notes into OPFS before it knows the final packed shape. [`ZipImportPipeline`](../../../scripture-editor-proto-2/src/core/domain/project/import/ZipImportPipeline.ts) unzips every archive entry and writes each file into a temporary directory, recursively counts/lists that tree, then reads and writes the files again into a managed destination. After classification, [`packTranslationNotesDirectory`](../../../scripture-editor-proto-2/src/core/library/stores/PackedTranslationNotesRepository.ts) walks the managed tree, reads every verse Markdown file, writes per-book JSON, swaps directories, and deletes the raw tree. OPFS `move` is copy/delete in the old Web filesystem, not an atomic rename. The import therefore pays for many small file operations and cleanup on top of ZIP decompression and parsing.

The old editor already has a better **browser folder** path in [`browserImportPipeline.ts`](../../../scripture-editor-proto-2/src/core/domain/project/import/browserImportPipeline.ts): when metadata identifies Translation Notes, it reads the browser `File` objects, gathers entries into per-book data, and writes packed book JSON without first writing each raw verse file to OPFS. ZIP and remote ZIP still go through the generic extract/copy/repack path. This distinction matters: speeding up generic OPFS writes alone leaves the avoidable raw materialization intact.

Sefer's current [Web intake](../../src/platform/web/intake.ts) also expands a selected ZIP into an in-memory file list and then writes every entry to staging. Its current import flow is scoped to scripture; TN is a future resource type. The opportunity is to add a type-aware TN path before repeating v1's per-verse staging cost, while leaving the generic scripture import unchanged.

## Fastest credible paths

**If we control the distributed resource:** pack Translation Notes once before download or publication into the runtime's per-book format (roughly one JSON/binary payload per book, plus metadata and required support files). Web import then validates and writes those few packed outputs. This shifts the 27,000-file reshape out of every user's browser. Keep source provenance and a format version so the packed resource can be checked and replaced deliberately.

**If the input is a raw TN ZIP:** decode archive entries into the same per-book accumulator the folder path uses, validate as entries arrive, and write only the final packed books and required support files to OPFS. Do not extract the raw tree, copy it, then read it again to pack. This is the highest-value local fix under an unchanged upstream archive. A remote ZIP should feed the same path after download; a browser-selected ZIP should feed it after file read. A browser-selected folder already demonstrates the shape, although its parser and duplicate behavior should be reconciled with the archive path rather than copied blindly.

For a large archive, choose an archive reader that can process entries incrementally or in bounded groups if full decompression proves too memory-heavy. Streaming is a memory and responsiveness choice, not a guarantee of faster total import. The simple first probe can use the existing ZIP decoder and direct packing to isolate the OPFS-file-count benefit; add a worker or streaming decoder only if measured decompression/parse time or peak memory warrants it. A worker cannot make tens of thousands of OPFS writes cheap if the pipeline still insists on writing every raw verse.

## Boundary and correctness

The specialized path still needs the same trust boundary as a normal import:

1. Identify the resource from decoded metadata, not a filename or a caller's TN flag. Reject unsupported format/version before publishing it as readable.
2. Normalize the optional common archive root; reject path traversal, absolute paths, duplicate archive names, duplicate semantic book/chapter/verse keys, and invalid UTF-8 or malformed metadata according to a stated policy.
3. Preserve exact Markdown bodies, meaningful support files, provenance, and stable resource identity. Do not silently flatten two notes for one verse into one string if the source format permits multiple entries.
4. Write a new, unregistered output directory; validate that every packed book reopens; publish it to the library index only after completion. On failure, remove that directory. Avoid a 27,000-file directory move as the publication step. Confirm how the current library discovers unindexed directories before relying on this ordering.
5. Keep raw archive retention optional and separately scoped. If the product needs exact source preservation for provenance or re-packing, storing the original ZIP as **one** object is cheaper than extracting every raw note, but it should not become a second mutable runtime source.

The packed shape and source version need a deliberate contract. The old packed form is per-book JSON keyed by chapter and verse; reading a verse is cheap because it loads one book. That may be sufficient. A database per verse or one giant JSON file would trade away this useful read granularity to optimize import and should not be the default.

## Proof before choosing a worker or format

Run one real TN archive through the old generic path and a direct-pack prototype in an isolated browser store. Record elapsed time by download/read, unzip, semantic parse, OPFS writes, validation, and cleanup; count filesystem operations, output bytes, peak memory, and main-thread long tasks. Include a second import, failure halfway through, duplicate/malformed entries, and reopen of representative notes across books. Verify the packed output has the same user-visible note bodies and references as the source.

The decision gate is simple: if direct packing removes the long import, stop. If total elapsed time remains high because ZIP decoding or assembling 27,000 strings blocks the UI, move that bounded transform to a worker. If memory is the problem, process entries incrementally or by book. Only revisit the packed disk format if per-book read performance or storage size supplies a separate reason.
