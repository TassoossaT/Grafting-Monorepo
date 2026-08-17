import Link from "next/link";
import SurfaceTransformationsClient from "./surface-transformations-client.tsx";

/** Phase A contract laboratory; it intentionally has no runtime integration. */
export default function SurfaceTransformationsPage() {
  return (
    <main style={{ padding: 12 }}>
      <Link href="/lab">&larr; Back to lab</Link>
      <SurfaceTransformationsClient />
    </main>
  );
}
