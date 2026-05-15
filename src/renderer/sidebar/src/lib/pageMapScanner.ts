/**
 * Injected into the active tab via executeJavaScript.
 * Full DOM snapshot for LLM: structure + text + passive/active (z:a|p).
 * Noise tags removed; visible-only mode skips subtrees failing layout visibility (SPA feeds often worse than raw outerHTML parity).
 */

export type PageMapScannerOpts = {
  /** When true: skip computed-style visibility filter (still omits SKIP_TAG). Closer to `outerHTML`/markup completeness for virtualized feeds. Larger JSON; may include off-screen placeholders. */
  includeHidden?: boolean
}

/** Build runnable scanner script. Default matches historical behavior (visible subtree only). */
export function buildPageMapScannerScript(
  opts: PageMapScannerOpts = {},
): string {
  const skipInvisible =
    opts.includeHidden === true ? 'false /* include hidden DOM */' : 'true'

  return `(function () {
  try {
    var SKIP_INVISIBLE = ${skipInvisible};
    var SCHEMA = "blueberry-dom-map-v4";
    var PAGE_HOST_LOWER = "";
    try {
      PAGE_HOST_LOWER = String(location.hostname || "").toLowerCase();
    } catch (eOrigin) {}
    var MAX_NODES = 32000;
    var MAX_DEPTH = 48;
    var MAX_CHILD_PER_NODE = 200;
    var MAX_FINGERPRINT_STUBS = 384;
    /** Candidate elements checked for stubs; feed posts must come early (Reddit floods [data-post-id]) */
    var MAX_FINGERPRINT_CANDIDATES_SCAN = 12000;


    var MAX_CLASSES = 28;
    var MAX_ATTR_VAL = 400;
    var MAX_DIRECT_TEXT = 6000;
    var MAX_DATA_ATTRS = 12;

    var SKIP_TAG = {
      SCRIPT: 1,
      STYLE: 1,
      NOSCRIPT: 1,
      TEMPLATE: 1,
      LINK: 1,
      META: 1,
      BASE: 1,
      BR: 1,
      WBR: 1,
    };

    function isVisible(el) {
      var style = window.getComputedStyle(el);
      var rect = el.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity) > 0 &&
        rect.width > 0 &&
        rect.height > 0
      );
    }

    function kindOf(el) {
      var T = el.tagName.toUpperCase();
      if (T === "A" && el.hasAttribute("href")) return "a";
      if (
        /^(BUTTON|INPUT|SELECT|TEXTAREA|OPTION)$/.test(T)
      )
        return "a";
      if (el.isContentEditable || el.getAttribute("contenteditable") === "true")
        return "a";
      var r = el.getAttribute("role") || "";
      if (
        /^(button|link|textbox|searchbox|checkbox|radio|switch|tab|menuitem|combobox|listbox|slider|spinbutton|search)$/.test(
          r,
        )
      )
        return "a";
      var tb = el.getAttribute("tabindex");
      if (tb !== null && tb !== "-1" && tb !== "") return "a";
      return "p";
    }

    function attrAllowed(name) {
      var n = name.toLowerCase();
      if (n === "id" || n === "class") return false;
      if (/^aria-/.test(n) || /^data-/.test(n)) return true;
      var allow = {
        role: 1,
        href: 1,
        src: 1,
        srcset: 1,
        sizes: 1,
        alt: 1,
        title: 1,
        type: 1,
        name: 1,
        placeholder: 1,
        for: 1,
        action: 1,
        method: 1,
        enctype: 1,
        value: 1,
        datetime: 1,
        tabindex: 1,
        contenteditable: 1,
        disabled: 1,
        readonly: 1,
        checked: 1,
        selected: 1,
        rel: 1,
        target: 1,
        scope: 1,
        colspan: 1,
        rowspan: 1,
        maxlength: 1,
        minlength: 1,
        pattern: 1,
        autocomplete: 1,
        rows: 1,
        cols: 1,
        step: 1,
        min: 1,
        max: 1,
        cite: 1,
        span: 1,
        loading: 1,
        decoding: 1,
        poster: 1,
        controls: 1,
        preload: 1,
        accept: 1,
        multiple: 1,
        required: 1,
        novalidate: 1,
        open: 1,
        media: 1,
        crossorigin: 1,
        referrerpolicy: 1,
        lang: 1,
        permalink: 1,
        "content-href": 1,
      };
      return allow.hasOwnProperty(n);
    }

    function pickAttrs(el) {
      var out = {};
      var dc = 0;
      var i;
      var a;
      var n;
      var v;
      for (i = 0; i < el.attributes.length; i++) {
        a = el.attributes[i];
        n = a.name.toLowerCase();
        if (!attrAllowed(n)) continue;
        if (n.indexOf("data-") === 0) {
          if (dc >= MAX_DATA_ATTRS) continue;
          dc++;
        }
        v = String(a.value || "");
        if (v.length > MAX_ATTR_VAL) v = v.slice(0, MAX_ATTR_VAL - 3) + "...";
        out[n] = v;
      }
      return out;
    }

    function clip(s, n) {
      s = String(s || "");
      return s.length > n ? s.slice(0, n - 3) + "..." : s;
    }

    /** URL-shaped attribute strings (SPA / WC often put href-like data on host attrs only). */
    var MAX_NAV_URL_SYNTH_CHILDREN = 8;

    function looksLikeNavigateUrl(s) {
      s = String(s || "").trim();
      if (!s) return false;
      var low = s.toLowerCase();
      if (low.indexOf("javascript:") === 0) return false;
      if (low.indexOf("data:") === 0) return false;
      if (low.indexOf("vbscript:") === 0) return false;
      if (s.indexOf("mailto:") === 0) return false;
      if (s.indexOf("tel:") === 0) return false;
      if (s.length > MAX_ATTR_VAL) return false;
      if (s.charCodeAt(0) === 47) return true;
      return /^https?:\\/\\//i.test(s);
    }

    function urlAttrSyntheticSortKey(name) {
      var n = String(name || "").toLowerCase();
      if (n === "href") return "\\x00\\x00\\x00" + name;
      if (n.indexOf("href") >= 0) return "\\x00\\x00\\x01" + name;
      if (n === "src" || n === "action" || n === "cite") return "\\x00\\x00\\x02" + name;
      if (n.indexOf("url") >= 0) return "\\x00\\x01" + name;
      return "\\x01" + name;
    }

    function subtreeHrefSet(kids, out, depth) {
      if (!Array.isArray(kids) || !kids.length || depth > 48) return;
      var iq;
      for (iq = 0; iq < kids.length; iq++) {
        var nx = kids[iq];
        if (!nx || typeof nx !== "object") continue;
        if (nx.t === "a" && nx.a && typeof nx.a.href === "string" && nx.a.href)
          out["h:" + nx.a.href] = 1;
        subtreeHrefSet(nx.k, out, depth + 1);
        subtreeHrefSet(nx.w, out, depth + 1);
      }
    }

    /** Lower tier = prepend first — site-relative (/…) before same-host https before outbound. Generic. */
    function synthNavHrefTier(val) {
      var s = String(val || "").trim();
      if (!s) return 9;
      if (s.charCodeAt(0) === 47) return 0;
      if (/^https?:\\/\\//i.test(s)) {
        try {
          var host = String(new URL(s).hostname || "").toLowerCase();
          if (PAGE_HOST_LOWER && host === PAGE_HOST_LOWER) return 1;
        } catch (eT1) {}
        return 2;
      }
      return 5;
    }

    function labelFromSlashPathHref(hrefVal) {
      var s = String(hrefVal || "").trim();
      if (!s || s.charCodeAt(0) !== 47) return "";
      try {
        var pathOnly = String(s.split(/[?#]/)[0] || "").replace(/\\/+$/, "");
        var segs = pathOnly.split("/").filter(Boolean);
        if (!segs.length) return "";
        var tail = segs[segs.length - 1];
        if (!tail || /^[0-9a-f]{24,}$/i.test(tail)) return "";
        tail = decodeURIComponent(tail.replace(/\\+/g, "%20"));
        var pretty = String(tail)
          .replace(/[-_\\.]+/g, " ")
          .replace(/\\s+/g, " ")
          .trim();
        if (pretty.length < 8) return "";
        return clip(pretty, MAX_DIRECT_TEXT);
      } catch (eLbl) {
        return "";
      }
    }

    function injectNavAnchorChildrenFromAttrs(o, budget) {
      if (!o || typeof o.a !== "object" || !o.a) return;
      var keys = Object.keys(o.a);
      if (!keys.length) return;
      var have = {};
      subtreeHrefSet(o.k, have, 0);
      subtreeHrefSet(o.w, have, 0);
      var existingCount = Array.isArray(o.k) ? o.k.length : 0;
      var synthAllow = Math.min(
        MAX_NAV_URL_SYNTH_CHILDREN,
        Math.max(0, MAX_CHILD_PER_NODE - existingCount),
      );
      var candidates = [];
      var ki;
      for (ki = 0; ki < keys.length; ki++) {
        var kkey = keys[ki];
        var vval = o.a[kkey];
        if (typeof vval !== "string" || !vval) continue;
        if (!looksLikeNavigateUrl(vval)) continue;
        candidates.push({
          kk: kkey,
          vv: vval,
          tier: synthNavHrefTier(vval),
          atr: urlAttrSyntheticSortKey(kkey),
        });
      }
      candidates.sort(function (ca, cb) {
        if (ca.tier !== cb.tier) return ca.tier - cb.tier;
        if (ca.atr !== cb.atr) return ca.atr < cb.atr ? -1 : 1;
        return ca.kk < cb.kk ? -1 : ca.kk > cb.kk ? 1 : 0;
      });
      var synth = [];
      var kj;
      for (kj = 0; kj < candidates.length && synth.length < synthAllow; kj++) {
        var kk = candidates[kj].kk;
        var vv = candidates[kj].vv;
        if (have["h:" + vv]) continue;
        have["h:" + vv] = 1;
        if (budget) {
          if (budget.emit >= MAX_NODES) {
            budget.truncated = true;
            break;
          }
          budget.emit++;
        }
        var synthIdx = synth.length + 1;
        var nx = {
          t: "a",
          z: "a",
          h: 1,
          i: clip("__bb_nav__" + String(synthIdx), 200),
          a: { href: clip(vv, MAX_ATTR_VAL) },
        };
        if (Array.isArray(o.c) && o.c.length > 0) {
          nx.c = o.c.slice(0, MAX_CLASSES);
        }
        var vxTier = synthNavHrefTier(vv);
        var hostXTrim =
          typeof o.x === "string" ? o.x.replace(/^\\s+|\\s+$/g, "") : "";
        if (vxTier === 0 && hostXTrim.length > 0) {
          nx.x = clip(hostXTrim, MAX_DIRECT_TEXT);
        } else if (vxTier === 0) {
          var fromPath = labelFromSlashPathHref(vv);
          if (fromPath.length > 0) nx.x = fromPath;
        }
        synth.push(nx);
      }
      if (!synth.length) return;
      var tail = Array.isArray(o.k) ? o.k : [];
      o.k = synth.concat(tail);
    }

    function directTextChunks(el) {
      var t = "";
      var ch = el.childNodes;
      var i;
      for (i = 0; i < ch.length; i++) {
        if (ch[i].nodeType === 3) {
          t += ch[i].nodeValue || "";
        }
      }
      return t.replace(/\\s+/g, " ").trim();
    }

    function passesStructuralFingerprint(el) {
      var T = String(el.tagName || "").toUpperCase();
      var dp = el.getAttribute("data-post-id");
      if (dp) {
        var dps = String(dp);
        if (/^t2_/i.test(dps)) return false;
        if (/^t[0-9]+_/i.test(dps)) return true;
      }
      var ksidDom = el.getAttribute("data-ks-id");
      if (ksidDom) {
        var ksd = String(ksidDom);
        if (/^t2_/i.test(ksd)) return false;
        if (/^t[0-9]+_/i.test(ksd)) return true;
      }
      var perm = String(el.getAttribute("permalink") || "");
      if (perm.indexOf("/comments/") >= 0) return true;
      var chref = String(el.getAttribute("content-href") || "");
      if (chref.indexOf("/comments/") >= 0) return true;
      if (T === "A") {
        var href = String(el.getAttribute("href") || "");
        if (href.indexOf("/comments/") >= 0) return true;
      }
      return false;
    }

    function buildStructuralStub(el) {
      var o = {
        t: el.tagName.toLowerCase(),
        z: kindOf(el),
        h: 1,
      };
      if (el.id) o.i = clip(el.id, 200);
      if (el.className && typeof el.className === "string") {
        var cls2 = el.className
          .trim()
          .split(/\\s+/)
          .filter(Boolean)
          .slice(0, MAX_CLASSES);
        if (cls2.length) o.c = cls2;
      }
      var attrs = pickAttrs(el);
      if (Object.keys(attrs).length) o.a = attrs;
      var dt2 = directTextChunks(el);
      if (dt2.length > 0) {
        o.x = clip(dt2, MAX_DIRECT_TEXT);
      }
      injectNavAnchorChildrenFromAttrs(o, null);
      return o;
    }

    function stubDedupeKey(el) {
      var dp = el.getAttribute("data-post-id");
      if (dp) return "id:" + String(dp).trim();
      var ks = el.getAttribute("data-ks-id");
      var kss = ks != null ? String(ks).trim() : "";
      if (
        kss &&
        /^t[0-9]+_/i.test(kss) &&
        !/^t2_/i.test(kss)
      )
        return "id:" + kss;
      var perm = String(el.getAttribute("permalink") || "").trim();
      if (perm.indexOf("/comments/") >= 0)
        return "p:" + perm.split(/[?#]/)[0];
      var chref = String(el.getAttribute("content-href") || "").trim();
      if (chref.indexOf("/comments/") >= 0)
        return "c:" + chref.split(/[?#]/)[0];
      if (String(el.tagName || "").toUpperCase() === "A") {
        var href = String(el.getAttribute("href") || "").trim();
        if (href.indexOf("/comments/") >= 0)
          return "a:" + href.split(/[?#]/)[0];
      }
      return "";
    }

    function emittedFingerprintHit(attrs, emitted) {
      if (!attrs) return;
      var dp = attrs["data-post-id"];
      if (dp) {
        var dpu = String(dp).trim();
        if (!/^t2_/i.test(dpu)) emitted["id:" + dpu] = 1;
      }
      var ksid = attrs["data-ks-id"];
      if (ksid) {
        var ksu = String(ksid).trim();
        if (/^t[0-9]+_/i.test(ksu) && !/^t2_/i.test(ksu)) emitted["id:" + ksu] = 1;
      }
      var perm = String(attrs["permalink"] || "").trim();
      if (perm.indexOf("/comments/") >= 0)
        emitted["p:" + perm.split(/[?#]/)[0]] = 1;
      var chrf = String(attrs["content-href"] || "").trim();
      if (chrf.indexOf("/comments/") >= 0)
        emitted["c:" + chrf.split(/[?#]/)[0]] = 1;
      var href = String(attrs["href"] || "").trim();
      if (href.indexOf("/comments/") >= 0)
        emitted["a:" + href.split(/[?#]/)[0]] = 1;
    }

    function markEmittedFingerprintKeysInTree(nd, emitted) {
      if (!nd || typeof nd !== "object") return;
      emittedFingerprintHit(nd.a, emitted);
      var ch = nd.k;
      var i;
      if (Array.isArray(ch))
        for (i = 0; i < ch.length; i++) markEmittedFingerprintKeysInTree(ch[i], emitted);
      var sh = nd.w;
      if (Array.isArray(sh))
        for (i = 0; i < sh.length; i++) markEmittedFingerprintKeysInTree(sh[i], emitted);
    }

    function gatherInvisibleFingerprintStubs(root, emittedKeys, seenKeys, out, ctr, cap) {
      function pushUnique(bucket, elx) {
        var q;
        for (q = 0; q < bucket.length; q++) if (bucket[q] === elx) return;
        bucket.push(elx);
      }
      function addSel(selStr, bucket) {
        try {
          var nlu = root.querySelectorAll(selStr);
          var u;
          for (u = 0; u < nlu.length; u++) pushUnique(bucket, nlu[u]);
        } catch (eGather) {}
      }
      var uniq = [];
      addSel('shreddit-feed article[data-post-id]', uniq);
      addSel('[id="i18n-shreddit-feed-content"] article[data-post-id]', uniq);
      addSel('article[data-post-id]', uniq);
      addSel("[data-post-id^='t3_']", uniq);
      addSel("[data-post-id]", uniq);
      addSel('a[href*="/comments/"]', uniq);
      addSel("[permalink*='/comments/']", uniq);
      addSel("[content-href*='/comments/']", uniq);
      ctr.steps = uniq.length;
      var scan = Math.min(uniq.length, MAX_FINGERPRINT_CANDIDATES_SCAN);
      if (uniq.length > MAX_FINGERPRINT_CANDIDATES_SCAN)
        ctr.truncatedBySteps = true;
      var i;
      for (i = 0; i < scan && out.length < cap; i++) {
        var el = uniq[i];
        var tnU = String(el.tagName || "").toUpperCase();
        if (SKIP_TAG[tnU]) continue;
        if (!passesStructuralFingerprint(el)) continue;
        var key = stubDedupeKey(el);
        if (!key || seenKeys[key]) continue;
        if (emittedKeys[key]) continue;
        seenKeys[key] = 1;
        out.push(buildStructuralStub(el));
      }
    }

    function serialize(el, depth, budget) {
      if (depth > MAX_DEPTH) {
        budget.truncatedDepth = true;
        return null;
      }
      if (budget.emit >= MAX_NODES) {
        budget.truncated = true;
        return null;
      }
      var tnU = String(el.tagName || "").toUpperCase();
      if (SKIP_TAG[tnU]) return null;
      if (SKIP_INVISIBLE && !isVisible(el)) {
        budget.skippedHidden++;
        return null;
      }

      budget.emit++;

      var o = {
        t: el.tagName.toLowerCase(),
        z: kindOf(el),
      };
      if (el.id) o.i = clip(el.id, 200);

      if (el.className && typeof el.className === "string") {
        var cls = el.className
          .trim()
          .split(/\\s+/)
          .filter(Boolean)
          .slice(0, MAX_CLASSES);
        if (cls.length) o.c = cls;
      }

      var attrs = pickAttrs(el);
      if (Object.keys(attrs).length) o.a = attrs;

      var dt = directTextChunks(el);
      if (dt.length > 0) {
        o.x = clip(dt, MAX_DIRECT_TEXT);
      }

      var kids = [];
      var rawKids = el.children;
      var j;
      for (j = 0; j < rawKids.length; j++) {
        var sub = serialize(rawKids[j], depth + 1, budget);
        if (sub) kids.push(sub);
      }

      if (kids.length > MAX_CHILD_PER_NODE) {
        o.o = kids.length - MAX_CHILD_PER_NODE;
        kids = kids.slice(0, MAX_CHILD_PER_NODE);
      }
      if (kids.length) o.k = kids;

      if (el.shadowRoot) {
        var sh = [];
        var sr = el.shadowRoot;
        var list = sr.children;
        for (j = 0; j < list.length; j++) {
          var sx = serialize(list[j], depth + 1, budget);
          if (sx) sh.push(sx);
        }
        if (sh.length) o.w = sh;
      }

      injectNavAnchorChildrenFromAttrs(o, budget);

      return o;
    }

    /** Virtualized rows often keep a full title in aria-label on a compact ancestor (data-post-id). */
    function collectPidAriaLabels(nd, out, depth) {
      if (!nd || typeof nd !== "object" || depth > 96) return;
      var aa = nd.a;
      if (aa && typeof aa === "object") {
        var dpi = aa["data-post-id"];
        var aria = aa["aria-label"];
        if (dpi && aria) {
          var dps = String(dpi).trim();
          var als = clip(String(aria).trim(), MAX_DIRECT_TEXT);
          if (dps && als) {
            if (!out[dps] || als.length > String(out[dps]).length) out[dps] = als;
          }
        }
      }
      var ch = nd.k;
      var i;
      if (Array.isArray(ch))
        for (i = 0; i < ch.length; i++) collectPidAriaLabels(ch[i], out, depth + 1);
      var sw = nd.w;
      if (Array.isArray(sw))
        for (i = 0; i < sw.length; i++) collectPidAriaLabels(sw[i], out, depth + 1);
    }

    function applyPidAriaToSynthNav(nd, byPid, depth) {
      if (!nd || typeof nd !== "object" || depth > 96) return;
      var pid = nd.i != null ? String(nd.i).trim() : "";
      var rich = pid && byPid[pid] ? String(byPid[pid]) : "";
      if (rich && Array.isArray(nd.k) && nd.k.length > 0) {
        var q;
        for (q = 0; q < nd.k.length; q++) {
          var ax = nd.k[q];
          if (!ax || typeof ax !== "object" || ax.t !== "a") continue;
          var hrf = ax.a && typeof ax.a.href === "string" ? ax.a.href : "";
          if (!hrf || hrf.charCodeAt(0) !== 47) continue;
          var curLen =
            typeof ax.x === "string" ? ax.x.replace(/^\\s+|\\s+$/g, "").length : 0;
          if (rich.length > curLen) ax.x = rich;
          break;
        }
      }
      var ch2 = nd.k;
      var j2;
      if (Array.isArray(ch2))
        for (j2 = 0; j2 < ch2.length; j2++) applyPidAriaToSynthNav(ch2[j2], byPid, depth + 1);
      var sw2 = nd.w;
      if (Array.isArray(sw2))
        for (j2 = 0; j2 < sw2.length; j2++) applyPidAriaToSynthNav(sw2[j2], byPid, depth + 1);
    }

    function mergePostIdAriaOntoSynthNavAnchors(rt) {
      var m = {};
      collectPidAriaLabels(rt, m, 0);
      applyPidAriaToSynthNav(rt, m, 0);
    }

    function pickRoot() {
      var m = document.querySelector("main");
      if (m && isVisible(m)) return { el: m, label: "main" };
      m = document.querySelector('[role="main"]');
      if (m && isVisible(m)) return { el: m, label: "role-main" };
      m = document.body;
      if (m) return { el: m, label: "body" };
      return null;
    }

    var budget = {
      emit: 0,
      truncated: false,
      truncatedDepth: false,
      skippedHidden: 0,
      structuralStub: 0,
    };
    var pr = pickRoot();
    if (!pr || !pr.el) {
      return { ok: false, error: "No document root to scan" };
    }

    var huntTruncByStepsApprox = false;
    var fingerprintAppendTruncatedApprox = false;
    var fingerprintStubCapUsed = MAX_FINGERPRINT_STUBS;

    var tree = serialize(pr.el, 0, budget);
    if (!tree) {
      return { ok: false, error: "Serialization produced no visible tree." };
    }

    mergePostIdAriaOntoSynthNavAnchors(tree);

    if (SKIP_INVISIBLE) {
      var emittedFp = {};
      markEmittedFingerprintKeysInTree(tree, emittedFp);
      var seenFp = {};
      var fpCollected = [];
      var fpCtr = { steps: 0, truncatedBySteps: false };
      gatherInvisibleFingerprintStubs(
        pr.el,
        emittedFp,
        seenFp,
        fpCollected,
        fpCtr,
        MAX_FINGERPRINT_STUBS,
      );
      huntTruncByStepsApprox = !!fpCtr.truncatedBySteps;
      var fpAllow = Math.max(
        0,
        Math.min(
          fpCollected.length,
          MAX_FINGERPRINT_STUBS,
          MAX_NODES - budget.emit,
        ),
      );
      fingerprintAppendTruncatedApprox = fpCollected.length > fpAllow;
      var fpChosen = fpCollected.slice(0, fpAllow);
      budget.emit += fpChosen.length;
      budget.structuralStub += fpChosen.length;
      if (fpChosen.length > 0) {
        var existingK = Array.isArray(tree.k) ? tree.k : [];
        tree.k = fpChosen.concat(existingK);
      }
      mergePostIdAriaOntoSynthNavAnchors(tree);
    }

    return {
      ok: true,
      schema: SCHEMA,
      pageTitle: clip(document.title || "", 300),
      url: clip(location.href, 512),
      root: pr.label,
      tree: tree,
      meta: {
        nodesEmitted: budget.emit,
        maxDepthCap: MAX_DEPTH,
        maxNodesCap: MAX_NODES,
        truncatedByNodeBudget: budget.truncated,
        truncatedByDepth: budget.truncatedDepth,
        skippedHiddenApprox: budget.skippedHidden,
        visibilityFilter: SKIP_INVISIBLE ? "visible-only" : "include-hidden-structure",
        structuralStubsFromInvisibleApprox: budget.structuralStub,
        fingerprintStubCap: fingerprintStubCapUsed,
        fingerprintHuntTruncatedByStepsApprox: SKIP_INVISIBLE
          ? huntTruncByStepsApprox
          : false,
        fingerprintAppendTruncatedApprox: SKIP_INVISIBLE
          ? fingerprintAppendTruncatedApprox
          : false,
        zMeaning: "z=a active (links, buttons, inputs, roles), z=p passive container/text",
      },
      note:
        "v4: z∈{a,p}; h=1 stubs = fingerprint posts missing from the visible tree (prepend in root k), deduped vs emitted attrs. Capped. Shadow in w[]. " +
          (SKIP_INVISIBLE
            ? "Visible-only plus structural fingerprints (data-post-id, permalink, /comments/ URLs) so SPA feed rows are not lost wholesale."
            : "Includes nodes that fail visibility (SPA virtualized markup); larger output."),
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
    };
  }
})()`
}

/** Visible-subtree preset (backward compatible export). */
export const PAGE_MAP_SCANNER_SCRIPT = buildPageMapScannerScript()
