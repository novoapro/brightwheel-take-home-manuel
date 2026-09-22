import { describe, it, expect } from "vitest";
import { renderMarkdownLite } from "./markdown";

describe("renderMarkdownLite", () => {
  it("renders bold and paragraphs", () => {
    expect(renderMarkdownLite("Open **7 to 6**.")).toBe(
      "<p>Open <strong>7 to 6</strong>.</p>",
    );
  });

  it("renders a bullet list", () => {
    expect(renderMarkdownLite("- one\n- two")).toBe(
      "<ul><li>one</li><li>two</li></ul>",
    );
  });

  it("separates blocks and keeps single newlines as breaks", () => {
    expect(renderMarkdownLite("a\nb\n\nc")).toBe("<p>a<br/>b</p><p>c</p>");
  });

  it("escapes HTML to prevent injection", () => {
    expect(renderMarkdownLite("<script>alert(1)</script>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
  });
});
