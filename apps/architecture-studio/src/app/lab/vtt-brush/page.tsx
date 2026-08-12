import Link from "next/link";
import VttBrushClient from "./vtt-brush-client.tsx";

export default function VttBrushPage() {
  return (
    <div>
      <div style={{ padding: "8px 12px" }}>
        <Link href="/lab">&larr; Back to bench</Link>
      </div>
      <VttBrushClient />
    </div>
  );
}
