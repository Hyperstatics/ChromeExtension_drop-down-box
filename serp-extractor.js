// Extractor adapted from keywords/tools/g-serp-collector.user.js v0.3.1.
// The page script only reads the current Google SERP; the Side Panel owns export actions.
(() => {
  const VERSION = 'extension-1.1.2';
  let lastPayload = null;
  let lastError = null;
  const log = (...args) => console.log('[G SERP]', ...args);
  const logErr = (...args) => console.error('[G SERP]', ...args);
  function trim(s) {
    return (s == null ? "" : String(s)).replace(/\s+/g, " ").trim();
  }

  function safeHost(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return "";
    }
  }

  // Reddit/Quora are folded into "organic" type (per user request), but the
  // readable-text view groups them separately by host for legibility.
  function isDiscussionUrl(url) {
    const h = safeHost(url);
    return h === "reddit.com" || h.endsWith(".reddit.com") || h === "quora.com" || h.endsWith(".quora.com");
  }

  function classify(url) {
    const h = safeHost(url);
    if (h === "youtube.com" || h === "youtu.be" || h.endsWith(".youtube.com")) return "video";
    return "organic";
  }

  // --- field extractors ---

  function getQuery() {
    const el = document.querySelector('input[name="q"], textarea[name="q"]');
    if (el && el.value) return el.value.trim();
    try {
      return new URL(location.href).searchParams.get("q") || "";
    } catch (e) {
      return "";
    }
  }

  // #taw can contain the entire ad block, including text injected by other
  // extensions. Only accept a short correction notice with a search link.
  function getCorrection() {
    let text = "";
    const rso = document.querySelector("#rso");
    const notice = /(these are results for|showing results for|including results for|did you mean|search (?:instead|only) for|mostrando resultados (?:de|para)|quiz[aá]s quisiste decir|buscar (?:en su lugar|solo) por)/i;
    const cands = document.querySelectorAll("div, span, p, a, #rso");
    for (let i = 0; i < cands.length; i++) {
      const el = cands[i];
      if (el === rso) break;
      if (rso && el.contains(rso)) continue;
      const t = trim(el.innerText);
      if (!t || t.length < 10 || t.length > 300 || !notice.test(t)) continue;
      const hasLink = el.tagName === "A"
        ? /\/search\?/.test(el.href) && el.href.includes("q=")
        : !!el.querySelector('a[href*="/search?"][href*="q="]');
      if (!hasLink) continue;
      text = t;
      break;
    }
    if (!text) return null;
    const out = { note: text, corrected: null, original: null };
    let m;
    if ((m = text.match(/(?:These are results for|Showing results for|Including results for|Mostrando resultados (?:de|para))\s*(.+?)(?=\s+Search (?:instead|only) for|\s+Buscar (?:en su lugar|solo) por|$)/i))) {
      out.corrected = m[1].trim();
    }
    if ((m = text.match(/(?:Did you mean|Quiz[aá]s quisiste decir)[:\s]*(.+)/i))) {
      out.corrected = m[1].trim();
    }
    if ((m = text.match(/Search instead for\s*(.+)/i))) {
      out.original = m[1].trim();
    }
    if ((m = text.match(/Search only for\s*(.+)/i))) {
      out.original = m[1].trim();
    }
    if ((m = text.match(/Buscar (?:en su lugar|solo) por\s*(.+)/i))) {
      out.original = m[1].trim();
    }
    return out;
  }

  // Find the description text within a single organic result block.
  // VwiC3b is Google's long-standing snippet class; the others are fallbacks.
  function findDesc(h3) {
    let block = h3.closest("div.N54PNb") || h3.closest("div.MjjYud");
    if (!block) {
      block = h3.parentElement;
      for (let i = 0; i < 3 && block && block.parentElement; i++) block = block.parentElement;
    }
    if (!block) return null;
    const sels = [
      "div.VwiC3b",
      '[style*="-webkit-line-clamp"]',
      "[data-sncf]",
      "[data-snc]",
      ".IsZvec",
      "span.aCOpRe",
    ];
    for (const sel of sels) {
      const el = block.querySelector(sel);
      const t = trim(el && el.innerText);
      if (t) return t;
    }
    return null;
  }

  // Anchor on every <h3> in the results area; climb to its <a href> for the URL.
  // Each item is isolated so one bad node can't abort the whole batch.
  function extractResults(seen) {
    const results = [];
    const h3s = document.querySelectorAll("#rso h3, #main h3");
    log("scanning h3 nodes:", h3s.length);
    h3s.forEach((h3, idx) => {
      try {
        const a = h3.closest("a[href]");
        if (!a) return;
        const href = a.href;
        if (!href || seen.has(href)) return;
        const title = trim(h3.innerText);
        if (!title) return;
        seen.add(href);
        results.push({
          type: classify(href),
          title: title,
          url: href,
          desc: findDesc(h3),
        });
      } catch (e) {
        logErr("result #" + idx + " parse failed:", e);
      }
    });
    return results;
  }

  // --- video carousel + standalone video cards ---
  // Video items live in role="list" carousels and don't use <h3>, so the h3
  // anchor misses them. Title class churns (hmTtFe / V5XKdd / ...), so we
  // fall back to the longest leaf text that isn't duration/source/channel.

  function leafTexts(el) {
    return Array.prototype.filter
      .call(el.querySelectorAll("*"), (e) => e.children.length === 0)
      .map((e) => trim(e.innerText))
      .filter(Boolean);
  }

  function videoTitle(item, a) {
    const hd = item.querySelector('[role="heading"], h3');
    if (trim(hd && hd.innerText)) return trim(hd.innerText);
    const known = item.querySelector("div.hmTtFe, div.V5XKdd, .fcvS3c, .s3v9rd, .R8oyQc");
    if (trim(known && known.innerText)) return trim(known.innerText);
    // Longest content leaf, excluding video metadata.
    let best = "";
    leafTexts(item).forEach((t) => {
      if (/^(?:\d+:\d{2}(?::\d{2})?|YouTube(?:\s*[·•-].*)?|·|\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)$/i.test(t)) return;
      if (t.length > best.length) best = t;
    });
    if (best) return best;
    return trim(a && a.innerText);
  }

  function videoMeta(item) {
    const leaves = leafTexts(item);
    const dur = leaves.find((t) => /^\d+:\d{2}(:\d{2})?$/.test(t));
    const ytIdx = leaves.findIndex((t) => /^YouTube$/i.test(t));
    // leaves layout: [duration, title, "YouTube", "·", channel, ...]
    const channel = ytIdx >= 0 ? leaves[ytIdx + 2] : null;
    const parts = [];
    if (channel) parts.push("YouTube · " + channel);
    if (dur) parts.push(dur);
    return parts.length ? parts.join(" · ") : null;
  }

  function extractVideos(seen) {
    const out = [];
    const YT_SEL = 'a[href*="youtube.com/watch"], a[href*="youtu.be/"], a[href*="m.youtube.com/watch"]';
    // 1. carousels
    const lists = Array.prototype.filter.call(
      document.querySelectorAll('[role="list"]'),
      (l) => l.querySelector(YT_SEL)
    );
    log("video carousels:", lists.length);
    lists.forEach((l) => {
      Array.prototype.forEach.call(l.querySelectorAll('[role="listitem"]'), (item, idx) => {
        try {
          const a = item.querySelector(YT_SEL);
          if (!a || seen.has(a.href)) return;
          const title = videoTitle(item, a);
          if (!title) return;
          seen.add(a.href);
          out.push({ type: "video", title: title, url: a.href, desc: videoMeta(item) });
        } catch (e) {
          logErr("video item #" + idx + " parse failed:", e);
        }
      });
    });
    // 2. standalone video cards not in a carousel and not already captured
    Array.prototype.forEach.call(document.querySelectorAll(YT_SEL), (a) => {
      try {
        if (seen.has(a.href) || a.closest('[role="list"]')) return;
        let blk = a;
        for (let i = 0; i < 4 && blk; i++) {
          if (blk.querySelector('[role="heading"], h3, div.hmTtFe, div.V5XKdd')) break;
          blk = blk.parentElement;
        }
        const hd = blk && blk.querySelector('[role="heading"], h3, div.hmTtFe, div.V5XKdd');
        const title = trim(hd && hd.innerText) || videoTitle(a, a);
        if (!title) return;
        seen.add(a.href);
        out.push({ type: "video", title: title, url: a.href, desc: null });
      } catch (e) {
        logErr("standalone video parse failed:", e);
      }
    });
    return out;
  }

  // --- discussions and forums (reddit / quora) ---
  // Each discussion item is an <a> whose innerText is "<question> Reddit|Quora".
  // Sub-links ("More", thumbnails) have empty text and are skipped.

  function discTitle(a) {
    const t = trim(a.innerText);
    const m = t.match(/^(.+?)\s+(?:Reddit|Quora)\b/i);
    return m ? trim(m[1]) : t;
  }

  function discMeta(a) {
    let blk = a;
    for (let i = 0; i < 6 && blk; i++) {
      const t = trim(blk.innerText);
      if (t.length > 40 && blk.querySelectorAll("a").length <= 3) break;
      blk = blk.parentElement;
    }
    if (!blk) return null;
    const meta = leafTexts(blk).filter((t) =>
      /^(r\/|[\d,]+\+?\s*(comments|answers|posts)|\d+\s+(second|minute|hour|day|week|month|year)s?\s+ago|just now)/i.test(t)
    );
    return meta.length ? meta.join(" · ") : null;
  }

  function extractDiscussions(seen) {
    const out = [];
    const sel = 'a[href*="reddit.com/r/"], a[href*="quora.com"]';
    Array.prototype.forEach.call(document.querySelectorAll(sel), (a, idx) => {
      try {
        const href = a.href;
        if (seen.has(href)) return;
        if (trim(a.innerText).length < 5) return; // skip "More"/thumbnail links
        seen.add(href);
        out.push({ type: "organic", title: discTitle(a), url: href, desc: discMeta(a) });
      } catch (e) {
        logErr("discussion item #" + idx + " parse failed:", e);
      }
    });
    return out;
  }

  function extractPeopleAlsoAsk() {
    const out = [];
    const seen = new Set();
    const pairs = document.querySelectorAll(
      ".related-question-pair, div[jsname='Cpkphb']"
    );
    pairs.forEach((p) => {
      try {
        // first visible line is the question; innerText skips <style>/<script>
        const text = trim(p.innerText).split("\n")[0];
        if (!text || seen.has(text)) return;
        seen.add(text);
        out.push(text);
      } catch (e) {
        logErr("PAA item parse failed:", e);
      }
    });
    return out;
  }

  function extractRelatedSearches() {
    const out = [];
    const seen = new Set();
    const currentQuery = trim(getQuery()).toLowerCase();
    const scopes = ["#botstuff", "#bres"];
    scopes.forEach((sel) => {
      const root = document.querySelector(sel);
      if (!root) return;
      root.querySelectorAll('a[href*="/search?"]').forEach((a) => {
        try {
          const url = new URL(a.href, location.href);
          const query = trim(url.searchParams.get("q"));
          if (url.origin !== location.origin || url.pathname !== "/search" || url.searchParams.has("start") || !query || query.toLowerCase() === currentQuery || seen.has(query)) return;
          seen.add(query);
          out.push(query);
        } catch (e) {
          logErr("related search item parse failed:", e);
        }
      });
    });
    return out;
  }

  // Probe the DOM so a field going empty is diagnosable without DevTools.
  function probeDom() {
    const has = (sel) => {
      try { return !!document.querySelector(sel); } catch (e) { return "err"; }
    };
    const cnt = (sel) => {
      try { return document.querySelectorAll(sel).length; } catch (e) { return -1; }
    };
    return {
      url: location.href,
      readyState: document.readyState,
      rso: has("#rso"),
      rso_h3: cnt("#rso h3"),
      main_h3: cnt("#main h3"),
      div_g: cnt("div.g"),
      MjjYud: cnt("#rso div.MjjYud"),
      yuRUbf: cnt("div.yuRUbf"),
      VwiC3b: cnt("div.VwiC3b"),
      role_list: cnt('[role="list"]'),
      role_list_with_yt: Array.prototype.filter.call(document.querySelectorAll('[role="list"]'), (l) => l.querySelector('a[href*="youtube.com/watch"], a[href*="youtu.be/"]')).length,
      yt_watch_links: cnt('a[href*="youtube.com/watch"], a[href*="youtu.be/"]'),
      reddit_r_links: cnt('a[href*="reddit.com/r/"]'),
      quora_links: cnt('a[href*="quora.com"]'),
      related_question_pair: cnt(".related-question-pair"),
      jsname_Cpkphb: cnt("div[jsname='Cpkphb']"),
      botstuff: has("#botstuff"),
      bres: has("#bres"),
      taw: has("#taw"),
      search_box: has('input[name="q"], textarea[name="q"]'),
    };
  }

  function extractAll() {
    const probe = probeDom();
    log("extract start | DOM probe:", probe);
    const correction = getCorrection();
    const seen = new Set();
    const organic = extractResults(seen);
    const videos = extractVideos(seen);
    const discussions = extractDiscussions(seen);
    const results = organic.concat(videos).concat(discussions);
    const paa = extractPeopleAlsoAsk();
    const related = extractRelatedSearches();
    const payload = {
      query: getQuery(),
      corrected_query: correction ? correction.corrected : null,
      original_query: correction ? correction.original : null,
      correction_note: correction ? correction.note : null,
      page_url: location.href,
      captured_at: new Date().toISOString(),
      results: results,
      people_also_ask: paa,
      related_searches: related,
    };
    let organicN = 0, videoN = 0, discN = 0;
    results.forEach((r) => {
      if (r.type === "video") videoN++;
      else if (isDiscussionUrl(r.url)) discN++;
      else organicN++;
    });
    log("extract done:", {
      results: results.length,
      organic: organicN,
      video: videoN,
      discussion: discN,
      desc_null: results.filter((r) => !r.desc).length,
      paa: paa.length,
      related: related.length,
      correction: correction ? correction.corrected : null,
    });
    return payload;
  }

  function statsText(p) {
    let organicN = 0, videoN = 0, discN = 0;
    p.results.forEach((r) => {
      if (r.type === "video") videoN++;
      else if (isDiscussionUrl(r.url)) discN++;
      else organicN++;
    });
    return [
      `结果 ${p.results.length}（网页 ${organicN} · 视频 ${videoN} · 讨论 ${discN}）`,
      `PAA ${p.people_also_ask.length} · 相关搜索 ${p.related_searches.length}`,
    ].join("\n");
  }

  function toReadableText(p) {
    const lines = [];
    lines.push(`搜索词: ${p.query || "(空)"}`);
    if (p.correction_note) {
      lines.push(`修正提示: ${p.correction_note.replace(/\n+/g, " | ")}`);
    }
    lines.push(`页面: ${p.page_url}`);
    lines.push(`抓取时间: ${p.captured_at}`);
    lines.push("");

    const groups = { organic: [], video: [], discussion: [] };
    p.results.forEach((r) => {
      if (r.type === "video") groups.video.push(r);
      else if (isDiscussionUrl(r.url)) groups.discussion.push(r);
      else groups.organic.push(r);
    });

    const titles = {
      organic: "搜索结果",
      video: "YouTube 视频",
      discussion: "讨论和论坛",
    };
    Object.keys(titles).forEach((type) => {
      const list = groups[type];
      if (!list || !list.length) return;
      lines.push(`== ${titles[type]} (${list.length}) ==`);
      list.forEach((r, i) => {
        lines.push(`[${i + 1}] ${r.title}`);
        lines.push(`    ${r.url}`);
        if (r.desc) lines.push(`    ${r.desc}`);
        lines.push("");
      });
    });

    if (p.people_also_ask.length) {
      lines.push("== People Also Ask ==");
      p.people_also_ask.forEach((q) => lines.push(`- ${q}`));
      lines.push("");
    }
    if (p.related_searches.length) {
      lines.push("== 相关搜索 ==");
      p.related_searches.forEach((q) => lines.push(`- ${q}`));
      lines.push("");
    }
    return lines.join("\n");
  }

  function buildDiagnostics() {
    const p = lastPayload;
    return {
      script_version: VERSION,
      captured_at: new Date().toISOString(),
      dom_probe: probeDom(),
      last_extract: p
        ? {
            query: p.query,
            results_count: p.results.length,
            by_type: p.results.reduce((m, r) => {
              const key = r.type === "video" ? "video" : (isDiscussionUrl(r.url) ? "discussion" : "organic");
              m[key] = (m[key] || 0) + 1;
              return m;
            }, {}),
            desc_null: p.results.filter((r) => !r.desc).length,
            paa_count: p.people_also_ask.length,
            related_count: p.related_searches.length,
            corrected_query: p.corrected_query,
            original_query: p.original_query,
            correction_note: p.correction_note,
          }
        : null,
      last_error: lastError,
    };
  }


  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'serpDiagnostics') {
      sendResponse(buildDiagnostics());
      return false;
    }
    if (request.action !== 'extractSerp') return false;
    try {
      lastPayload = extractAll();
      lastError = null;
      sendResponse({ payload: lastPayload, readableText: toReadableText(lastPayload), stats: statsText(lastPayload) });
    } catch (error) {
      lastError = { message: error.message, stack: error.stack, at: new Date().toISOString() };
      logErr('extract failed:', error);
      sendResponse({ error: error.message });
    }
    return false;
  });
})();
