import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` otherwise auto-injects a managed "agent-rules" block into
  // CLAUDE.md / AGENTS.md. We keep the repo free of agent-directed content
  // (it will be reviewed by an AI agent), so we opt out.
  agentRules: false,
};

export default nextConfig;
