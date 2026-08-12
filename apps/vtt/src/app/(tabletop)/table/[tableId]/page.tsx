import { notFound } from "next/navigation";

import { TabletopEntry } from "./_client/tabletop-entry";

interface TablePageProps {
  readonly params: Promise<{ readonly tableId: string }>;
}

export default async function TablePage({ params }: TablePageProps) {
  const { tableId } = await params;
  if (tableId.trim().length === 0) notFound();

  return <TabletopEntry key={tableId} tableId={tableId} />;
}
