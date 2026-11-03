import { renderRich, type Tier } from "#core/findings/messages";
import type { FindingMessage } from "#core/galley";

import { sousWords } from "../../sousWords";
import { Kbd } from "../primitives";

export function SousSentence(props: { readonly message: FindingMessage; readonly tier: Tier }) {
  return (
    <>
      {renderRich(
        props.message,
        props.tier,
        (glyph) => (
          <Kbd>{glyph}</Kbd>
        ),
        sousWords(),
      )}
    </>
  );
}
