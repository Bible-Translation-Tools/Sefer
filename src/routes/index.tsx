import { createFileRoute } from "@tanstack/solid-router";

function Home() {
  return (
    <main>
      <h1>Sefer</h1>
      <p>Local-first scripture editing, beginning with exact source text.</p>
    </main>
  );
}

export const Route = createFileRoute("/")({
  head: () => ({ meta: [{ title: "Sefer" }] }),
  component: Home,
});
