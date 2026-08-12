import Link from "next/link";
import VttBrushClient from "./vtt-brush-client.tsx";

export default function VttBrushPage() {
  return (
    <div>
      <div style={{ padding: "8px 12px" }}>
        <Link href="/lab/trials">&larr; Back to trials</Link>
      </div>
      <VttBrushClient />
    </div>
  );
}
