// Extractor adapted from keywords/tools/g-serp-collector.user.js v0.3.1.
// The page script only reads the current Google SERP; the Side Panel owns export actions.
(() => {
  const VERSION = 'extension-1.1.6';
  let lastPayload = null;
  let lastError = null;
  const log = (...args) => console.log('[G SERP]', ...args);
  const logErr = (...args) => console.error('[G SERP]', ...args);
  function trim(s) {
    return (s == null ? "" : String(s)).replace(/\s+/g, " ").trim();
  }

  // Read Google-owned text while leaving the user's SEO extensions running.
  const FOREIGN_UI = '.aitdk-site-metrics, .aitdk-site-metrics-container, [class*="aitdk-"], [id*="aitdk-"], .traffic-analysis-container, .simple-data-display, .sitedata-keyword-module, [class*="sitedata-"], [id*="sitedata-"]';
  const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'BR', 'SECTION', 'ARTICLE', 'TABLE', 'TR']);

  function isForeign(el) {
    return !!(el && el.closest && el.closest(FOREIGN_UI));
  }

  function nativeText(root) {
    if (!root || isForeign(root)) return "";
    const parts = [];
    function visit(node) {
      if (node.nodeType === 3) {
        parts.push(node.nodeValue || "");
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node;
      if (el.matches(FOREIGN_UI) || /^(SCRIPT|STYLE|NOSCRIPT|SVG)$/.test(el.tagName) || el.hidden || el.getAttribute('aria-hidden') === 'true' || /display\s*:\s*none/i.test(el.getAttribute('style') || '')) return;
      if (BLOCK_TAGS.has(el.tagName)) parts.push("\n");
      for (const child of el.childNodes) visit(child);
      if (BLOCK_TAGS.has(el.tagName)) parts.push("\n");
    }
    visit(root);
    return parts.join("").replace(/[^\S\n]+/g, " ").split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
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
      if (isForeign(el)) continue;
      const t = trim(nativeText(el));
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
      const t = trim(nativeText(el));
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
        if (isForeign(h3)) return;
        const a = h3.closest("a[href]");
        if (!a) return;
        const href = a.href;
        if (!href || seen.has(href)) return;
        const title = trim(nativeText(h3));
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

  function sectionType(text) {
    const start = text.slice(0, 120);
    if (/sponsored results|resultados patrocinados|anuncios/i.test(start)) return 'sponsored';
    if (/ai overview|vista creada con ia|resumen creado con ia/i.test(start)) return 'ai_overview';
    if (/find related products\s*&\s*services|buscar productos y servicios relacionados/i.test(start)) return 'related_products_services';
    if (/^(videos|vídeos)(?:\n|$)/i.test(start)) return 'videos';
    return 'result';
  }

  function cleanSectionText(text, type) {
    if (type === 'ai_overview') {
      text = text.split(/\n(?:Save to Google Drive|Save to Gmail|Transcribing\.\.\.|Show more)(?:\n|$)/i)[0];
    }
    const lines = text.split('\n').map((line) => line.replace(/Read more$/i, '').trim()).filter((line) =>
      line && !/^(My Ad Center|· Translate this page|Show sponsored resultsHide sponsored results|View all)$/i.test(line)
    );
    const cleaned = [];
    for (let i = 0; i < lines.length; i++) {
      if (i + 1 < lines.length && cleaned.length >= 2 &&
          lines[i] === cleaned[cleaned.length - 2] && lines[i + 1] === cleaned[cleaned.length - 1]) {
        i++;
        continue;
      }
      cleaned.push(lines[i]);
    }
    return cleaned.join('\n');
  }

  function ratingText(root, body) {
    const compact = trim(body);
    if (compact.length < 60 && /\b[0-5][.,]\d\b/.test(compact) &&
        /\(\s*[\d,.]+\s*\)|reviews?|reseñas?|ratings?|stars?|estrellas?/i.test(compact)) return compact;
    const labels = Array.prototype.map.call(root.querySelectorAll('[aria-label]'),
      (el) => trim(el.getAttribute('aria-label'))).filter((label) =>
        /\b[0-5][.,]\d\b/.test(label) && /reviews?|reseñas?|ratings?|stars?|estrellas?/i.test(label));
    if (!labels.length) return null;
    const count = compact.match(/\(\s*[\d,.]+\s*\)/);
    return count && !labels[0].includes(count[0]) ? `${labels[0]} ${count[0]}` : labels[0];
  }

  function sectionLinks(root, type, results) {
    if (type === 'ai_overview' || type === 'related_products_services') return [];
    const links = [];
    const seen = new Set();
    const add = (a) => {
      if (isForeign(a)) return;
      const label = trim(nativeText(a));
      let url = a.href;
      if (!label || !/^https?:/.test(url)) return;
      try {
        const parsed = new URL(url);
        const destination = parsed.searchParams.get('adurl');
        if (destination && /^https?:\/\//.test(destination)) url = destination;
        else if (parsed.hostname.endsWith('google.com') &&
                 (parsed.pathname === '/search' || parsed.pathname === '/aclk')) return;
      } catch (e) { return; }
      if (seen.has(url)) return;
      seen.add(url);
      links.push({ label, url });
    };
    if (type === 'sponsored') {
      const cards = root.querySelectorAll('[data-text-ad]');
      if (cards.length) {
        cards.forEach((card) => {
          Array.prototype.some.call(card.querySelectorAll('a[href]'), (a) => {
            const before = links.length;
            add(a);
            return links.length > before;
          });
        });
      } else {
        const hosts = new Set();
        root.querySelectorAll('a[href]').forEach((a) => {
          const before = links.length;
          add(a);
          if (links.length === before) return;
          const host = safeHost(links[links.length - 1].url);
          if (hosts.has(host)) links.pop();
          else hosts.add(host);
        });
      }
    } else if (type === 'videos') {
      const videoUrls = new Set(results.filter((r) => r.type === 'video').map((r) => r.url));
      root.querySelectorAll('a[href*="youtube.com/watch"], a[href*="youtu.be/"]').forEach((a) => {
        if (videoUrls.has(a.href)) add(a);
      });
    } else {
      const h3 = root.querySelector('h3');
      const primary = h3 && h3.closest('a[href]');
      if (primary) add(primary);
      else {
        const candidate = Array.prototype.find.call(root.querySelectorAll('a[href]'),
          (a) => !isForeign(a) && trim(nativeText(a)).length > 3);
        if (candidate) add(candidate);
      }
    }
    return links;
  }

  // Google mixes native modules with result cards. Keep their page order and
  // text so new SERP modules remain visible even before they have a parser.
  function extractSections(results) {
    const roots = [];
    const taw = document.querySelector('#taw');
    if (taw && /sponsored results|resultados patrocinados|anuncios/i.test(nativeText(taw))) roots.push(taw);
    const rso = document.querySelector('#rso');
    if (rso) {
      const blocks = Array.prototype.filter.call(rso.querySelectorAll('.MjjYud'),
        (el) => !el.parentElement.closest('.MjjYud'));
      roots.push(...(blocks.length ? blocks : rso.children));
    }
    // Featured modules can sit outside #rso, depending on the Google layout.
    const moduleName = /^(sponsored results|resultados patrocinados|ai overview|vista creada con ia|resumen creado con ia|find related products\s*&\s*services|buscar productos y servicios relacionados|videos|vídeos)(?:\s|$)/i;
    document.querySelectorAll('h2, h3, [role="heading"], span, div').forEach((el) => {
      if (isForeign(el) || el.childElementCount > 5 || el.textContent.length > 100 ||
          !moduleName.test(trim(el.textContent)) ||
          Array.prototype.some.call(el.children, (child) => moduleName.test(trim(child.textContent)))) return;
      let block = el.closest('.MjjYud');
      if (!block) {
        block = el;
        for (let i = 0; i < 6 && block.parentElement; i++) {
          block = block.parentElement;
          if (block.querySelectorAll('a[href]').length >= 2 || block.querySelector('[role="list"]')) break;
        }
      }
      if (!roots.some((root) => root.contains(block) || block.contains(root))) roots.push(block);
    });
    roots.sort((a, b) => a === b ? 0 :
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    const out = [];
    roots.forEach((root) => {
      const body = nativeText(root);
      if (body.length < 60 && !root.querySelector('h3')) {
        const rating = ratingText(root, body);
        const previous = out[out.length - 1];
        if (rating && previous && previous.type === 'result' && !previous.text.includes(rating)) {
          previous.text += '\n' + rating;
          return;
        }
      }
      if (body.length < 20) return;
      const type = root === taw ? 'sponsored' : sectionType(body);
      if (type === 'result' && !root.querySelector('h3') &&
          /^(?:AI Mode\n)?All\nVideos\nShort videos\nImages\nForums/i.test(body)) return;
      // #taw can also contain correction notices. Store only its sponsored part.
      const text = root === taw && type === 'sponsored'
        ? body.slice(body.search(/sponsored results|resultados patrocinados|anuncios/i))
        : body;
      const relatedStart = text.search(/(?:^|\n)(?:Find related products\s*&\s*services|Buscar productos y servicios relacionados)(?=\n|$)/i);
      if (type === 'sponsored' && relatedStart > 0) {
        out.push({ type, text: cleanSectionText(text.slice(0, relatedStart), type), links: sectionLinks(root, type, results) });
        out.push({ type: 'related_products_services', text: cleanSectionText(text.slice(relatedStart).trim(), 'related_products_services'), links: [] });
      } else {
        const section = { type, text: cleanSectionText(text, type), links: sectionLinks(root, type, results) };
        if (type === 'result' && !/\b[0-5][.,]\d\b.*\([\d,.]+\)/.test(trim(section.text))) {
          const rating = ratingText(root, body);
          if (rating && !section.text.includes(rating)) section.text += '\n' + rating;
        }
        out.push(section);
      }
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

  function probeResultBlocks() {
    const rso = document.querySelector('#rso');
    if (!rso) return [];
    return Array.prototype.filter.call(rso.querySelectorAll('.MjjYud'),
      (el) => !el.parentElement.closest('.MjjYud')).map((el, index) => ({
        index,
        text_preview: nativeText(el).slice(0, 280),
        rating_labels: Array.prototype.map.call(el.querySelectorAll('[aria-label]'),
          (node) => trim(node.getAttribute('aria-label'))).filter((label) =>
            /reviews?|reseñas?|ratings?|stars?|estrellas?/i.test(label)).slice(0, 6),
        children: Array.prototype.map.call(el.children, (child) => ({
          tag: child.tagName,
          class_name: typeof child.className === 'string' ? child.className.slice(0, 100) : '',
          role: child.getAttribute('role'),
          text_preview: nativeText(child).slice(0, 80),
        })).slice(0, 8),
      }));
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
    const sections = extractSections(results);
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
      serp_sections: sections,
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
      sections: sections.length,
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
      `页面模块 ${p.serp_sections.length}（广告 ${p.serp_sections.filter((s) => s.type === 'sponsored').length}）`,
    ].join("\n");
  }

  function toReadableText(p) {
    const lines = [];
    lines.push(`搜索词: ${p.query || "(空)"}`);
    if (p.correction_note) {
      lines.push(`修正提示: ${p.correction_note.replace(/\n+/g, " | ")}`);
    }
    const page = new URL(p.page_url);
    lines.push(`页面: ${page.origin}${page.pathname}?q=${encodeURIComponent(p.query)}`);
    lines.push(`抓取时间: ${p.captured_at}`);
    lines.push("");

    if (p.serp_sections.length) {
      const labels = {
        sponsored: 'Sponsored Results',
        ai_overview: 'AI Overview',
        related_products_services: 'Find related products & services',
        videos: 'Videos',
        result: '搜索结果及其他模块',
      };
      p.serp_sections.forEach((section, i) => {
        lines.push(`== ${i + 1}. ${labels[section.type]} ==`);
        lines.push(section.text);
        section.links.forEach((link) => lines.push(`- ${link.label}: ${link.url}`));
        lines.push("");
      });
      const sectionUrls = new Set(p.serp_sections.flatMap((section) => section.links.map((link) => link.url)));
      const missed = p.results.filter((result) => !sectionUrls.has(result.url));
      if (missed.length) {
        lines.push('== 其他已识别结果 ==');
        missed.forEach((result) => {
          lines.push(`${result.title}: ${result.url}`);
          if (result.desc) lines.push(result.desc);
        });
        lines.push("");
      }
      if (p.people_also_ask.length) {
        lines.push('== People Also Ask ==');
        p.people_also_ask.forEach((q) => lines.push(`- ${q}`));
        lines.push("");
      }
      if (p.related_searches.length) {
        lines.push('== 相关搜索 ==');
        p.related_searches.forEach((q) => lines.push(`- ${q}`));
        lines.push("");
      }
      return lines.join("\n");
    }

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
      result_blocks: probeResultBlocks(),
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
            sections_count: p.serp_sections.length,
            sections_by_type: p.serp_sections.reduce((m, s) => {
              m[s.type] = (m[s.type] || 0) + 1;
              return m;
            }, {}),
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
