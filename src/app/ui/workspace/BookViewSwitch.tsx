import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { SegmentedControl, Switch } from "../primitives";

type BookView = "reading" | "lines" | "usfm";

/**
 * How the book is shown: Reading, Line by line or USFM where the design
 * surface is on, the USFM switch otherwise. In the editor's action bar
 * (`EditorPanel`).
 */
export function BookViewSwitch(props: { readonly class?: string }) {
  const shell = useShell();
  const bookView = (): BookView => {
    if (shell.mode() === "usfm") return "usfm";
    return shell.lineByLine() ? "lines" : "reading";
  };
  const chooseBookView = (view: BookView): void => {
    shell.setMode(view === "usfm" ? "usfm" : "default");
    if (view !== "usfm") shell.setLineByLine(view === "lines");
  };
  // A build-time switch, not a reactive one: the fragment only keeps the
  // component's single return.
  return (
    <>
      {__SEFER_DESIGN__ ? (
        <span id="editor-view-switch" class={props.class}>
          <SegmentedControl
            size="sm"
            label={t("Show the book as")}
            items={[
              { value: "reading", label: t("Reading") },
              { value: "lines", label: t("Line by line") },
              { value: "usfm", label: t("USFM") },
            ]}
            value={bookView()}
            onChange={chooseBookView}
          />
        </span>
      ) : (
        <Switch
          class={props.class}
          label={t("USFM")}
          checked={shell.mode() === "usfm"}
          onChange={(on) => shell.setMode(on ? "usfm" : "default")}
        />
      )}
    </>
  );
}
