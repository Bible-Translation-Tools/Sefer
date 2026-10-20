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

const nodesOf = (html: string): readonly Node[] => [
  ...parser.parseFromString(html, "text/html").body.childNodes,
];

export interface MarkdownProps {
  readonly text: string;
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
