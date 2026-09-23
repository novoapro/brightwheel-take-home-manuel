import FrontDesk from "@/components/FrontDesk";
import { getDb } from "@/lib/db";
import { getCenter } from "@/lib/repo/center";
import { resolveAvailability } from "@/lib/repo/settings";
import { centerDisplayName } from "@/lib/types";

// Reads the seeded center on the server, then hands off to the chat client.
// Everything parent-facing (name, front-desk name, mark, greeting) is tenant
// data — nothing center-specific is hardcoded (analysis/10 §2). Availability +
// the on-duty operator (analysis/11 §4) are read here too so the status pill is
// server-rendered — no flash of the wrong state.
export const dynamic = "force-dynamic";

export default function Home() {
  const db = getDb();
  const center = getCenter(db);
  const settings = resolveAvailability(db);
  return (
    <FrontDesk
      center={{
        name: center?.name ?? "Front Desk",
        displayName: center ? centerDisplayName(center) : "Front Desk",
        logo: center?.logo,
        welcomeMessage: center?.welcome_message,
      }}
      presence={{
        availability: settings.availability,
        operatorName: settings.operator_name,
        awayMessage: settings.away_message,
      }}
    />
  );
}
