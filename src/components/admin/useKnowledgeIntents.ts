"use client";

import { useEffect, useState } from "react";
import { INTENTS } from "@/lib/types";
import { adminFetch } from "./adminFetch";

/**
 * The live set of knowledge-base categories (core + operator-added), for the
 * relay capture dropdowns. Falls back to the built-in core intents until the
 * fetch resolves (or if it fails), so the control is never empty.
 */
export function useKnowledgeIntents(passcode: string): string[] {
  const [intents, setIntents] = useState<string[]>([...INTENTS]);

  useEffect(() => {
    let alive = true;
    adminFetch("/api/admin/knowledge", passcode)
      .then((r) => r.json())
      .then((d) => {
        if (alive && d.ok && Array.isArray(d.intents) && d.intents.length) {
          setIntents(d.intents);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [passcode]);

  return intents;
}
