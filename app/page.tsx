import { Dashboard } from "@/components/dashboard";
import { getSnapshot } from "@/lib/engine";

export const dynamic = "force-dynamic";

export default async function Page() {
  const initial = await getSnapshot();
  return <Dashboard initial={initial} />;
}
