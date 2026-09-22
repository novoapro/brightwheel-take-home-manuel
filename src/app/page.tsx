import FrontDesk from "@/components/FrontDesk";
import { getDb } from "@/lib/db";
import { getCenter } from "@/lib/repo/center";
import { centerDisplayName } from "@/lib/types";

// Reads the seeded center on the server, then hands off to the chat client.
// Everything parent-facing (name, front-desk name, mark, greeting) is tenant
// data — nothing center-specific is hardcoded (analysis/10 §2).
export const dynamic = "force-dynamic";

export default function Home() {
  const center = getCenter(getDb());
  return (
    <FrontDesk
      center={{
        name: center?.name ?? "Front Desk",
        displayName: center ? centerDisplayName(center) : "Front Desk",
        logo: center?.logo,
        welcomeMessage: center?.welcome_message,
      }}
    />
  );
}
