/**
 * Prompt: model returns compact JS that runs locally instead of emitting huge JSON (faster, smaller reply).
 */
export const DOM_MAP_TRANSFORM_PROMPT = `You receive a JSON file (schema blueberry-dom-map-v4) after the line "--- DOM map JSON ---".
Do **not** print the entire flattened structure yourself. Instead output **short JavaScript** the client runs locally to build the flattened result from \`input\`.

Requirements:
- Reply with **exactly one** fenced block: open with \`\`\`javascript and close with \`\`\`.
- The block must evaluate to **a callable** with signature **\`(input, H) => { ... }\`** (**recommended**). \`H\` is injected and **page-agnostic**. **Legacy** \`(input) => …\` with arity 1 is still supported, but the script must not rely on deep \`k[0].k[1]\` style paths. Return **exactly one** of these shapes (pick **layoutKind** from the DOM map semantics — see below):

  • **Unified (preferred):**
  \`{ ok: true, schema: "blueberry-dom-map-overlay", layoutKind: "feed"|"article"|"discussion", pageTitle: input.pageTitle ?? "", url: input.url ?? "", note: "short", items: [ ... ] }\`.
  • **Legacy feed-only** (\`schema: "blueberry-dom-map-flattened"\`) is still accepted and treated like \`layoutKind: "feed"\`.

- **Choosing layoutKind**
  • **feed** — primary content is **many homogeneous rows** (listings, search results, timelines, Reddit/HN **front**/new/comments **list views**): each row is a card with optional link/title/metadata.
  • **article** — one main **readable document** (headings + prose): flatten to **reading order**.
  • **discussion** — **threaded replies** where **parent→child matters** (forums, **HN/Reddit single-thread pages**): flatten to nested nodes with \`username\`/\`user\` + **\`text\`** (**or** \`body\`/\`content\`) + \`children[]\`/ \`replies\`.
  • **Hard rule — HN item URLs:** If \`input.url\` (string) matches **news.ycombinator.com** with a path/query containing **\`item?\`** and **\`id=\`** (\`/item?id=…\`), the page is a **story + comments thread**, **not** a listing feed. Prefer **\`layoutKind: "discussion"\`**. Treat the long **homepage HN recipe** below as **wrong** here unless the exported tree genuinely has **no** comment subtrees (**\`comtr\`**, **\`commtext\`**, etc.—see **HN item-thread** bullets).

- **items shapes (must match layoutKind)**  
  • **feed:** same as flattened rows (**scalar fields**, \`title\`, \`url\`/\`link\`/\`href\` for the **primary** story; \`commentsUrl\` for the **discussion thread** when it differs—e.g. Reddit outbound **\`content-href\`** vs subreddit **\`permalink\`**, HN **\`item?id=\`** story vs **comments** link in the meta row; optional \`score\`, \`username\`, \`comments\` (label/count text), etc.; optional shallow \`subitems\`; **never** raw walker nodes in \`items\`).  
  • **article:** array of blocks:
    \`{ type, text? }\` for prose/headings (\`h1\`–\`h3\`, \`p\`, \`li\`, \`blockquote\`);
    \`{ type: "img", src, alt?, text? or caption? }\` for images (\`src\` also accepted as \`image\` / \`img\`);
    \`{ type: "a", text, href }\` or any block with \`href\` / \`url\` / \`link\` to make **links** clickable.
    Use one block per figure/paragraph; resolve relative URLs against \`input.url\`.
  • **discussion:** array of roots \`{ username?: string, user?: string, text: string, children?: DiscussionNode[] }\`; **nested** replies go in \`children\`; every node should have usable \`text\` (omit noise).

- Example return for unified feed (omit \`schema: "blueberry-dom-map-flattened"\` — use overlay + layoutKind):

  \`\`\`javascript
  (input, H) => {
    ...
    return { ok: true, schema: "blueberry-dom-map-overlay", layoutKind: "feed", pageTitle: input.pageTitle, url: input.url, note: "HN", items };
  }
  \`\`\`
- **Subtree scope vs whole tree:** Multi-rail / company layouts may isolate the feed behind **\`data-test-id\`**, urn-like attrs, or a recurring card class — **then \`region = findPreorder(...)\`; \`collect(region, row)\`** is right. Feeds whose rows are **spread across **\`input.tree\`**** (many subreddits, card-heavy sites) often have **no** such single container—use **\`H.collect(input.tree, rowPredicate)\`** or you get **too few rows** (often **exactly one**). **Never** reuse a subtree clause from another domain unless **this JSON** contains the same marker. If **\`findPreorder\`** returns nothing, guard and fall back (or collect globally).
- Repeating HTML often appears as **multiple sibling rows** (\`tr\` after \`tr\`, card after card, …). Metadata is **not** always \`children[3]\` on the same row — use \`H.collect\` in **document order** or \`H.walkPreorder\` to find the **next** matching block; do not assume a fixed number of cells per row.
- **Ancestor \`<tr>\` trap (single-item bug):** A **wrapper** row can contain **many** descendants (e.g. HN wraps the listings table inside \`<tr id="bigbox">\`). Conditions like “same \`tr\` subtree has both \`titleline\` and \`subtext\`” match **that wrapper**, and \`findPreorder\` then returns only the **first** title + first subtext in the whole listing → output with **exactly one** item. Prefer **paired sibling rows** (\`allTr[i]\` + metadata on \`allTr[i + 1]\`) or classify **leaf story rows** (e.g. \`athing\`), not a shared ancestor row.
- **Hacker News (news.ycombinator.com) — use this recipe:** **\`const allTr = H.collect(input.tree, (x) => H.tag(x) === 'tr')\`**, then scan by index. Rows with class **\`athing\`** are **title rows**; **\`score\`**, **\`hnuser\`**, comments live almost always on the **next** sibling **\`tr\`** (look at **\`allTr[i + 1]\`**, bounds-check—**not** under the **\`athing\`** row). Story **\`<a>\`**: inside the **\`athing\`** row, **\`findPreorder\`** finds nodes in preorder—the **upvote** link (**\`href\`** starts with **\`vote?\`**) comes **before** the headline **\`<a>\`**, so require **\`href\`** and exclude **\`vote?\`** and **\`from?\`** (site link). Never use **\`H.textIncludes(n, 'vote|hide')\`** to mean “vote or hide” (that’s the **literal** characters **\`vote|hide\`**). **\`titleline\`** is usually a **\`span\`**; find it then the story anchor inside **or** rely on href filtering alone. **\`H.text(n)\`** only returns that node’s own **\`x\`** (no deep text)—for points you need the actual **\`.score\`** span**,** not the whole **\`subtext\`** cell. Common bugs: (**1**) **\`H.cls(x, 'athing').length\`** — two-arg **\`H.cls\`** returns a **boolean**, so **\`.length\`** is **always** falsy ⇒ **zero items**. Use **\`H.hasClass(x, 'athing')\`** or bare **\`H.cls(x, 'athing')\`** in predicates. (**2**) **\`findPreorder(athingRow, (n) => H.cls(n, 'subtext'))\`** usually finds **nothing**—wrong row. (**3**) Using **\`H.text(subtextContainer)\`** for score ⇒ **empty**—use **\`findPreorder(metaRow, (n) => H.cls(n, 'score'))\`** then **\`H.text\`** on that node.
- **HN item thread pages (\`/item?id=\`) — REQUIRED shape:** These are **not** rows of unrelated stories — **never** emit **feed** consisting only of rows whose **primary** URL is **\`vote?\`** (upvote arrows) or **empty** titles. Prefer **discussion** (\`schema: blueberry-dom-map-overlay\`, **\`layoutKind: "discussion"\`**). Walk **comment** rows (**\`tr\`** rows that include class **\`comtr\`** or contain **\`commtext\`** / **\`span.commtext\`** in the walker): (**1**) username from **\`a.hnuser\`** / **\`span.hnuser\`** (**\`H.text\`** on that node); (**2**) **\`text\`** = full comment body (**\`H.findPreorder\`** for **\`span\`** or **\`div\`** whose class list includes **\`commtext\`**, or match **\`td\`** **\`indent\`**—then concatenate visible **\`x\`** in reading order, or preorder **leaf** sentences under that subtree). Omit vote-only nodes. **\`children\`/threading:** HN nests replies via indented **\`<td>\`** / inner tables—infer parent/child using **indent width** (**\`ind\`** in **attrs** /\`style\`/cell **\`width\`**) **or** tree nesting depth; **if unsure**, emit a **flat** array of **\`{ username, text }\`** (still **\`discussion\`**, **not feed**).
- **Not every feed is \`<table>\` rows:** Card / social feeds (e.g. Reddit: \`shreddit-*\`, \`faceplate-*\`, lots of \`div\`) may contain **zero** \`tr\` nodes — \`H.collect(input.tree, (x) => H.tag(x) === 'tr')\` is then **empty** and HN-only class names never match. Base logic on **tags and \`href\` patterns present in this JSON** (e.g. story links under \`a\` with \`/comments/\` in \`href\`). Check \`input.meta\` (\`nodesEmitted\`, caps): a **small** map often means most posts were **never captured** (virtualization, scroll, node budget) — **empty \`items\`** can mean **incomplete DOM export**, not only a wrong loop.
- **Reddit thread (old / classic \`thing.comment\`):** The post row is \`thing\` + **\`link\`**; each **comment** is \`thing\` + **\`comment\`** with **\`data-type: "comment"\`**. Body text is **not** on \`usertext-body\`’s own \`x\` — it sits on child **\`p\` / \`li\` / \`pre\`**. Use **\`H.collect(usertextBody, n => ['p','li','pre'].includes(H.tag(n)))\`** → **\`H.textOrEmpty\`**, or **\`H.textSubtree(usertextBody)\`**. Replies nest under **\`.child\` → \`.sitetable.listing\`**; mirror that in **\`children\`** when possible. (The client may **overwrite** LLM output with a deterministic parser when the URL is a \`/r/…/comments/…\` thread and the tree matches classic markup.)
- **Reddit (\`shreddit-post\` and similar):** Story URLs often live on the **host’s attr object** only: **\`permalink\`** and **\`content-href\`** (**not** descendant \`<a>\` attrs). Read with **\`(H.attrs(post)||{})['permalink']\`** / **\`['content-href']\`** (argument is **the walker row** \`post\`, **never** \`post.a\` — \`H.attrs(post.a)\` **always breaks**: it resolves \`(post.a).a\`, i.e. \`undefined\`). Headline: first preorder **\`<a>\`** with non-empty **\`x\`**, preferably **\`i\`** starting **\`__bb_nav__\`**. Emit **only** scalars (**\`title\`**, **\`url\`**); **never** push the raw \`shreddit-post\` walker. Prefer **absolute** outbound **\`content-href\`** when \`http(s):\`, else **\`permalink\`** (discussion); resolve relatives with **\`new URL(…, input.url)\`**. When **\`content-href\`** is an **external article** but **\`permalink\`** is the on-Reddit thread, set **\`url\`** to the article (or primary tap target) and **\`commentsUrl\`** to **\`permalink\`** (or **\`/comments/\`** thread URL) so both links appear in the feed overlay.
- **Fingerprint stubs (\`h: 1\`):** On **visible-only** exports, **posts present in DOM but missing from the emitted tree** appear as minimal \`h:1\` stubs (attrs only), **prepended** on the root’s **\`k\`**, **deduped** against \`data-post-id\`, \`data-ks-id\`, \`/comments/\` \`href\` already present anywhere in the map. **Visibility is not required** for a stub — only that the post’s identity was **not already captured** in serialization.
- **\`H.textIncludes\`:** substring test only — it is **not** a regex. \`H.textIncludes(n, 'vote|hide')\` looks for the literal characters \`vote|hide\`, not “vote or hide”.
- **\`H\` (read carefully — common mistakes throw or produce **hundreds of junk rows**):**  
  • **\`H.cls(n)\` with one argument** always returns an **array**; **empty \`[]\` is still truthy** in JS — **never** write \`if (H.cls(n)) { … }\` as a filter — that matches **every tree node** (“garbage output”). Use \`if (H.hasClass(n, 'Class'))\` or two-arg form **\`if (H.cls(n, 'Class'))\`** ⇒ **boolean**  
  • \`H.cls(n, 'Class')\` is synonymous with \`hasClass\` (for common LLM mistakes)  
  • Use document order for the full list: **\`const allTr = H.collect(input.tree, (x) => H.tag(x) === 'tr')\`**; from the current headline row, advance in \`allTr\` until you find a sibling row that holds metadata (e.g. a \`subtext\` cell) — **do not** assume score/username live in the same preorder sweep that only starts from a headline node  
  • \`H.tag(n) === 'a'\`; \`H.attr(n,'href')\` or \`H.attrs(n)\`; \`H.text(n)\`, \`H.textOrEmpty\`, \`H.textIncludes\`, **\`H.textSubtree(root, joiner?)\`** (every \`x\` in the subtree, preorder — use for **Reddit** \`usertext-body\` when \`H.text\` on that node is empty)
  • **First arg to \`attr\`/search must be the walker node** (\`{t,z,a,k,w,...}\`) — never \`node.a\` (the attrs object). Wrong: \`H.attr(post.a, 'href')\`. Right: \`H.attr(post, 'href')\` or **\`(H.attrs(post)||{})['content-href']\`**.  
  • \`H.findPreorder(rootNode, predicate)\` searches **only under that root** — don’t expect score/user inside the same preorder as the headline row if they live on the **next sibling row**
  • **Hollow hosts (\`k\` empty):** SPA / WC sometimes store navigable URLs **only on the host’s attr object**. The scanner prepends synthetic \`a\` nodes (\`i\` prefix \`__bb_nav__\`) when no descendant already exposes that URL; **order prefers path-relative \`/\` URLs, then same-host \`http(s)\`, then outbound.** Synthetic anchors **copy the host’s \`c\` classes** so \`H.cls\` predicates on the primary link behave like the card. For tier-0 (/…) links, \`x\` is the host’s direct text when present; otherwise a **generic last-path-segment** label (underscores/hyphens → spaces). When the export also has a node with both \`data-post-id\` and \`aria-label\`, the scanner **fills a longer \`x\` on the primary path \`a\`** wherever that id matches the host’s \`i\`.
  • **Headline URL:** class \`titleline\` is almost always on a **span**; the useful \`<a href>\` is usually a **descendant**, not tagged with \`titleline\` — predicates like \`tag==='a' && cls(_, 'titleline')\` often match **nothing**. First find span \`.titleline\`, then **\`findPreorder\` inside that span** for an \`<a>\` whose \`href\` is not vote/hide/flag noise. **Source domain:** often an anchor with \`from?site=\` and inner span \`sitestr\`.
  • **LinkedIn-style feeds:** Copy blocks are misleading—**\`title\`** / long body text nodes are easy while the **canonical \`href\`** hides on nested **\`a\`** tags (\`/posts/\`, **\`/feed/update/\`**, **\`ugcPost\`**, or synthetic **\`__bb_nav__\`** under the update). If **\`url\`** would be **\`""\`**, drill into each feed row/card with **\`findPreorder\`** for **\`a\`** + **non-noise href** instead of flattening empty links.
- **Flattened rows = plain JSON, not walkers:** Push **scalar fields only** (**\`title\`**, **\`url\`**, **\`score\`**, **\`username\`**). **Never** \`push\` raw map **nodes** (objects carrying **\`t\`**, **\`z\`**, **\`k\`**, **\`w\`**) into **\`items\`**—that repeats huge subtrees and breaks the flattened schema (**wrong for HN and any site**). Derive strings/URLs via **\`H.text\`** / **\`H.attr\`** then discard the node reference.
- **Emitted fields and JSON:** \`JSON.stringify\` drops keys whose values are \`undefined\`; always wire \`title\` and URL fields from the nodes you read; the feed honors **\`url\`**, **\`link\`**, or **\`href\`**. (**HN thread:** Never use **\`vote?\`** URLs as **\`url\`** / primary link field inside **discussion** roots—omit **href** unless it is **real navigable discussion content** (**\`item?id=\`** reply links are OK.)
- **URL strings:** Relative paths (\`/comments/…\`, \`/page\`) must be resolved with \`new URL(href, input.url || locationOrigin)\`; if \`href\` is missing, \`new URL(undefined, …)\` becomes the literal segment \`"undefined"\` (broken URLs).
- Be defensive: missing branches via optional chaining or early \`return\`; don’t crash on one uneven row.
- Depth at most two for **feed** rows: each \`items\` entry may have shallow \`subitems\` (no nested subitems inside subitems).
- Discussion trees use **\`children\`** (nested); article uses **\`type\` + \`text\`** blocks—not walker nodes.
- **No** \`summary\` key on objects in \`items\` (omit entirely).
- Only \`input.tree\` data via \`H\`; **no** \`fetch\`/network, no \`import\`, no extra \`eval\` on strings.
- Feeds with many structurally similar rows: return **one \`items\` entry per row**, not a small sample.

Example skeleton inside the block:

\`\`\`javascript
(input, H) => {
  const allTr = H.collect(input.tree, (x) => H.tag(x) === "tr");
  const items = [];
  const base = input.url || "https://news.ycombinator.com/";
  function storyHrefOk(h) {
    if (!h || typeof h !== "string") return false;
    const s = h.trim();
    return s && !s.startsWith("vote?") && !s.startsWith("from?");
  }
  for (let i = 0; i + 1 < allTr.length; i++) {
    const titleRow = allTr[i];
    if (!H.hasClass(titleRow, "athing")) continue;
    const metaRow = allTr[i + 1];
    const link = H.findPreorder(titleRow, (n) =>
      H.tag(n) === "a" && storyHrefOk(H.attr(n, "href"))
    );
    if (!link) continue;
    const scoreN = H.findPreorder(metaRow, (n) => H.cls(n, "score"));
    const userN = H.findPreorder(metaRow, (n) => H.cls(n, "hnuser"));
    const commentsN = H.findPreorder(metaRow, (n) =>
      H.tag(n) === "a" && H.textIncludes(n, "comment")
    );
    const commentsHrefRaw = commentsN ? H.attr(commentsN, "href") : undefined;
    const storyU = new URL(H.attr(link, "href").trim(), base).href;
    const commentsU =
      commentsHrefRaw && typeof commentsHrefRaw === "string"
        ? new URL(commentsHrefRaw.trim(), base).href
        : undefined;
    items.push({
      title: H.textOrEmpty(link),
      url: storyU,
      score: scoreN ? H.textOrEmpty(scoreN) : undefined,
      username: userN ? H.textOrEmpty(userN) : undefined,
      comments: commentsN ? H.textOrEmpty(commentsN) : undefined,
      commentsUrl:
        commentsU && commentsU !== storyU ? commentsU : undefined,
    });
  }
  return { ok: true, schema: "blueberry-dom-map-overlay", layoutKind: "feed", pageTitle: input.pageTitle, url: input.url, note: "HN", items };
}

// Note: \`/item?id=…\` HN THREAD pages MUST use layoutKind:"discussion" and comtr/commtext — not this skeleton.
\`\`\`
`
