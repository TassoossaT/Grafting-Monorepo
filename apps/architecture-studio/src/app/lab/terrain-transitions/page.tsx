import Link from "next/link";
import TerrainTransitionsClient from "./transitions-client.tsx";

export default function TerrainTransitionsPage() {
  return (
    <div>
      <div style={{ padding: "8px 12px" }}>
        <Link href="/lab/trials">&larr; Back to trials</Link>
      </div>
      <TerrainTransitionsClient />
    </div>
  );
}
