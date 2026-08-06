import Link from "next/link";
import GenerationClient from "./generation-client.tsx";

export default function HeightmapPage() {
  return (
    <div>
      <div style={{ padding: "8px 12px" }}>
        <Link href="/lab/trials">&larr; Back to trials</Link>
      </div>
      <GenerationClient />
    </div>
  );
}
