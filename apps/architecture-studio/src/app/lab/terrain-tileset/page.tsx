import Link from "next/link";
import TerrainTilesetClient from "./tileset-client.tsx";

export default function TerrainTilesetPage() {
  return (
    <div>
      <div style={{ padding: "8px 12px" }}>
        <Link href="/lab/trials">&larr; Back to trials</Link>
      </div>
      <TerrainTilesetClient />
    </div>
  );
}
