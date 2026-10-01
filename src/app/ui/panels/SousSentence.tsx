/**
 * One of a Sous finding's two sentences, each mark it quotes drawn as a
 * keycap: `<Kbd>;"</Kbd> appears only 2 times.` A mark in quotation marks
 * cannot be read when the mark is one, so kitchen's catalog tags every mark
 * and this is where the tag becomes a `Kbd`.
 *
 * Rendered from the finding's descriptor, never by parsing `message`, which is
 * the same sentence with the marks bare.
 */

import { renderRich, type Tier } from "#core/findings/messages";
import type { FindingMessage } from "#core/galley";

import { Kbd } from "../primitives";

export function SousSentence(props: { readonly message: FindingMessage; readonly tier: Tier }) {
  return (
    <>
      {renderRich(props.message, props.tier, (glyph) => (
        <Kbd>{glyph}</Kbd>
      ))}
    </>
  );
}
