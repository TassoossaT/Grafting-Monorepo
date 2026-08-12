import BenchClient from "./bench-client.tsx";

// Lab is the node bench (DEC-057). Standalone trial pages have been consolidated
// into composable node kinds in the bench registry.
//
// Client-only: the bench mounts a browser canvas and holds authored state that
// has no server counterpart.
export default function LabPage() {
  return <BenchClient />;
}
