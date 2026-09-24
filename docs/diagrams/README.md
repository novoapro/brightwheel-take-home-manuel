# Architecture diagrams

Editable [Excalidraw](https://excalidraw.com) sources for the Front Desk architecture, each rendered to a PNG that the [top-level README](../../README.md#architecture) and the turn-in doc embed.

| View | Source | Render |
|---|---|---|
| System architecture | [`01-system-architecture.excalidraw`](01-system-architecture.excalidraw) | `01-system-architecture.png` |
| Answer sequence | [`02-answer-sequence.excalidraw`](02-answer-sequence.excalidraw) | `02-answer-sequence.png` |
| Database schema (ERD) | [`03-database-schema.excalidraw`](03-database-schema.excalidraw) | `03-database-schema.png` |
| Deployment | [`04-deployment.excalidraw`](04-deployment.excalidraw) | `04-deployment.png` |

## Editing

Open any `.excalidraw` file at [excalidraw.com](https://excalidraw.com) (File → Open) or with the **Excalidraw** VS Code extension, edit, and re-export the PNG (same filename, 2× scale, white background) so the embeds stay in sync.

Colour is semantic and consistent across the set: **blue** = app / services / data, **purple** = the AI model, **amber** = the guardrail decision, **green** = a grounded answer / config, **orange** = the human relay.
