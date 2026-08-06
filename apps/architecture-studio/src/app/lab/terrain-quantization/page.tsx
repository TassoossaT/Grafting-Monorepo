import Link from "next/link";
import QuantizationClient from "./quantization-client.tsx";

export default function TerrainQuantizationPage() {
  return (
    <div>
      <div style={{ padding: "8px 12px" }}>
        <Link href="/lab/trials">&larr; Back to trials</Link>
      </div>
      <QuantizationClient />
    </div>
  );
}
