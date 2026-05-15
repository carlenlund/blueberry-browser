/**
 * Fixed prompt bundled with the full DOM map JSON when using “Send to Chat”.
 * Reply must be JSON in a fenced block, max depth 2: items → subitems.
 */
export const DOM_MAP_CHAT_PROMPT = `You receive a JSON export of a webpage’s visible DOM (schema blueberry-dom-map-v4).
Return a single flattened structure with depth at most 2: a list of top-level blocks (like section divs) with child nodes.

Requirements:
- Respond ONLY with one JSON object inside a markdown code fence that begins with \`\`\`json (no prose outside the fence).
- Max depth: exactly two levels: an \`items\` list and, inside each item, a \`subitems\` list. No nested subitems.
- Choose a sensible grouping from the current hierarchy, headings, sections, navigation, forms, and repeating patterns — collapse noisy wrappers but keep semantics.
- **Repeated rows/lists (news feeds, search results, cards, table rows, comments, products):** produce **one top-level \`items\` entry per repeating unit** — not one giant group for the whole list. Headline/link, score, source/domain, time, comment count, etc. become **\`subitems\`** on that row only (one step down, max).
- **Completeness (no cherry-picking):** every distinct repeating entry visible in the input must have **its own \`items\` object**. **Never omit, sample, or summarize** the list as “a subset”, “the first N”, “representative examples”, or fewer rows to shorten the answer. If counts are clear from structure, the number of group rows must match all units of **the same structural shape**. **A handful of rows is not acceptable** when the input reflects a full feed with many structurally similar rows (e.g. 20–30 story rows in the source \`DOM\`; then you need 20–30 \`items\`, not ~5).
- Top level may use coarse page regions when it fits (e.g. header, toolbar), but **not** a single “all the news” blob when the page is an enumerated list of posts.
- Each list row/group row: set **\`title\`** so the row is **identifiable** — e.g. primary link text — not the same generic heading for every row. **Do not include a \`summary\` key** on row objects (\`items\` entries): omit it entirely from JSON.
- **Primary story link for list rows (required when present):** each news/feed row must include at least one \`subitem\` whose \`label\` marks the **story/article link** (e.g. "Title", "Story", "Article"): \`text\` = visible headline and \`a.href\` = **exactly the external or page \`href\` tied to that headline in the source for that row**. **Do not output only the source domain** (“Source”, e.g. yorku.ca) without the main article link when that \`href\` exists in the source tree.
- **Text and language:** all \`text\` and string fields on \`subitems\` must come from the input; if you lack free text, **repeat existing headline or metadata** — **no** invented content and **no** arbitrary language drift away from the page.
- **\`href\` and attributes:** copy \`href\` and meaningful attributes **from the input** (relative or absolute); do not invent or guess URLs.
- Every node must mark passive layout vs active/interactive: field \`z\`: \`"p"\` (passive) or \`"a"\` (active: links, buttons, fields, radio groups, etc.).
- Keep useful content: visible text, labels, roles, short attributes (href, name, placeholder, aria-label, type) where helpful.

Schema for your reply:
{
  "ok": true,
  "schema": "blueberry-dom-map-flattened",
  "pageTitle": "…",
  "url": "…",
  "note": "brief note on grouping choices",
  "items": [
    {
      "id": "optional stable id",
      "title": "section name",
      "z": "p",
      "subitems": [
        { "label": "…", "text": "…", "t": "button", "z": "a", "a": { "href": "…" } }
      ]
    }
  ]
}

Use empty arrays only when nothing applies; keep each list **one row/object at a time**, not merged distinct posts.

**Large or irregular pages:** When the safest approach is exploratory (probe structure, subtree vs whole-tree collect, table vs cards), switching to **“Send JS transform”** in Map is OK: the assistant returns a small runnable \`(input, H)\` snippet tailored to this export rather than emitting a gigantic flat JSON paste.
`
