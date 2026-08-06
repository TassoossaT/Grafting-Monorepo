import BenchClient from "./bench-client.tsx";

// Lab is the node bench (DEC-057). The standalone trial pages that used to be
// the whole of this route now live under /lab/trials; they stay because each
// one still demonstrates its own capture-and-compare workflow, which the bench
// does not replace.
//
// Client-only: the bench mounts a browser canvas and holds authored state that
// has no server counterpart.
export default function LabPage() {
  return <BenchClient />;
}
