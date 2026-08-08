import Link from "next/link";
import StackedTerrainClient from "./terrain-client.tsx";

export default function StackedTerrainPage() {
  return (
    <div>
      <div style={{ padding: "8px 12px" }}>
        <Link href="/lab/trials">&larr; Back to trials</Link>
      </div>
      <StackedTerrainClient />
    </div>
  );
}
