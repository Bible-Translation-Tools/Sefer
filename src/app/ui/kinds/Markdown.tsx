/**
 * A resource's own Markdown — a note's body, its quote — drawn as HTML.
 *
 * The same parser, configured the same way, as the reader that split the
 * notes (`core/resources/kinds/tn/rcHelpMarkdown.ts`): `html: false`, so an
 * author's raw HTML is escaped to text and only markup the parser itself
 * makes (paragraphs, lists, emphasis, links) reaches the page. That is the
 * guarantee that makes the output safe to insert; it is parsed into nodes
 * with `DOMParser` (which runs no script) rather than through `innerHTML`.
 *
 * Links go only to `http(s)`, in a new tab. Anything else — `rc://` links to
 * Translation Academy, a relative link to a sibling chunk — stays as the
 * words it was written as, because Sefer has nothing to open them in yet.
 */

import MarkdownIt from "markdown-it";
import { createEffect, createSignal } from "solid-js";

const markdown = new MarkdownIt({ html: false, linkify: false });

markdown.validateLink = (url: string): boolean => /^https?:\/\//i.test(url);

const openLink = markdown.renderer.rules.link_open;
markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  token?.attrSet("target", "_blank");
  token?.attrSet("rel", "noopener noreferrer");
  return openLink === undefined
    ? self.renderToken(tokens, index, options)
    : openLink(tokens, index, options, env, self);
};

const parser = new DOMParser();

/** The parser's HTML as nodes, ready to put in an element. */
const nodesOf = (html: string): readonly Node[] => [
  ...parser.parseFromString(html, "text/html").body.childNodes,
];

export interface MarkdownProps {
  readonly text: string;
  /** One line of inline Markdown (a heading's words) rather than blocks. */
  readonly inline?: boolean;
  readonly class?: string;
}

export function Markdown(props: MarkdownProps) {
  const [host, setHost] = createSignal<HTMLElement | undefined>(undefined, {
    name: "markdownHost",
  });
  createEffect(
    () => ({
      element: host(),
      html: props.inline === true ? markdown.renderInline(props.text) : markdown.render(props.text),
    }),
    ({ element, html }) => {
      element?.replaceChildren(...nodesOf(html));
    },
  );
  return <div ref={setHost} class={props.class} />;
}
