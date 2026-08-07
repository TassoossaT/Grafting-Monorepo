import Link from "next/link";
import IrregularGridClient from "./grid-client.tsx";

export default function IrregularGridPage() {
  return (
    <div>
      <div style={{ padding: "8px 12px" }}>
        <Link href="/lab/trials">&larr; Back to trials</Link>
      </div>
      <IrregularGridClient />
    </div>
  );
}
