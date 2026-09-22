/**
 * Minimal, safe markdown renderer for policy prose (body_md). Handles the small
 * subset we author — **bold**, paragraphs, and `- ` bullet lists — and escapes
 * HTML first so operator-authored text can't inject markup. No dependency.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(s: string): string {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

/** Render a small markdown subset to an HTML string. */
export function renderMarkdownLite(md: string): string {
  const blocks = md.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split("\n");
      const isList = lines.every((l) => /^\s*-\s+/.test(l));
      if (isList) {
        const items = lines
          .map((l) => `<li>${inline(l.replace(/^\s*-\s+/, ""))}</li>`)
          .join("");
        return `<ul>${items}</ul>`;
      }
      return `<p>${lines.map(inline).join("<br/>")}</p>`;
    })
    .join("");
}
