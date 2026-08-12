import Link from "next/link";
import MeshProceduralClient from "./mesh-procedural-client.tsx";

export default function MeshProceduralPage() {
  return (
    <div>
      <div style={{ padding: "8px 12px" }}>
        <Link href="/lab/trials">&larr; Back to trials</Link>
      </div>
      <MeshProceduralClient />
    </div>
  );
}
