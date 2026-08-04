import Link from "next/link";
import QuantizationClient from "./quantization-client.tsx";

export default function TerrainQuantizationPage() {
  return (
    <div>
      <div style={{ padding: "8px 12px" }}>
        <Link href="/lab">&larr; Back to Lab</Link>
      </div>
      <QuantizationClient />
    </div>
  );
}
