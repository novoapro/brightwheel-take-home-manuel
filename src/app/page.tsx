import FrontDesk from "@/components/FrontDesk";
import { getDb } from "@/lib/db";
import { getCenter } from "@/lib/repo/center";

// Reads the seeded center on the server, then hands off to the chat client.
export const dynamic = "force-dynamic";

export default function Home() {
  const center = getCenter(getDb());
  return <FrontDesk centerName={center?.name ?? "Little Acorns Front Desk"} />;
}
