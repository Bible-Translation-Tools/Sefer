import wasmUrl from "@wycliffeassociates/scripture-kitchen/docx/web/wasm?url";

// The kitchen's Word and LibreOffice reader: its own wasm module, started the
// first time the import dialog is given a file and never before, so neither
// the module nor its glue is in the main chunk. Desktop runs this same build
// in its webview, so one loader serves both hosts.

export type Docx = typeof import("@wycliffeassociates/scripture-kitchen/docx");

let loading: Promise<Docx> | undefined;

export const loadDocx = (): Promise<Docx> => {
  loading ??= (async () => {
    const docx = await import("@wycliffeassociates/scripture-kitchen/docx");
    await docx.init({ module_or_path: wasmUrl });
    return docx;
  })();
  // A failed start (offline, say) is tried again on the next file.
  loading.catch(() => {
    loading = undefined;
  });
  return loading;
};
