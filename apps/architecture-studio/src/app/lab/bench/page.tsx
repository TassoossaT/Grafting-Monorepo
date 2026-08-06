import BenchClient from "./bench-client.tsx";

// Client-only: the bench mounts a browser canvas and holds authored state that
// has no server counterpart yet. It lives beside the existing trials rather
// than replacing /lab, because ADR-0019 keeps the gallery reachable until the
// bench actually evaluates a graph.
export default function BenchPage() {
  return <BenchClient />;
}
