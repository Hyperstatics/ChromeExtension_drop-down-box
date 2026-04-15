async function fetchSuggestions(query) {
  const url = new URL('https://suggestqueries.google.com/complete/search');
  url.searchParams.set('output', 'toolbar');
  url.searchParams.set('hl', 'en');
  url.searchParams.set('q', query);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'application/xml');

  const suggestions = [];
  const elements = doc.querySelectorAll('suggestion');
  elements.forEach((el) => {
    const data = el.getAttribute('data');
    if (data) suggestions.push(data);
  });

  return suggestions;
}

const collectForm = document.getElementById('collectForm');
const mainQuery = document.getElementById('mainQuery');
const depthInput = document.getElementById('depthInput');
const delayInput = document.getElementById('delayInput');
const resultsSection = document.getElementById('resultsSection');
const resultsList = document.getElementById('resultsList');
const resultCount = document.getElementById('resultCount');
const copyBtn = document.getElementById('copyBtn');
const exportBtn = document.getElementById('exportBtn');
const stopBtn = document.getElementById('stopBtn');
const apiNoFilter = document.getElementById('apiNoFilter');
const pageNoFilter = document.getElementById('pageNoFilter');

let currentResults = [];
let abortController = null;

function renderResults(items) {
  currentResults = items;
  resultsList.replaceChildren();
  resultCount.textContent = items.length;

  if (items.length === 0) {
    resultsSection.style.display = 'none';
    return;
  }

  items.forEach((item) => {
    const li = document.createElement('li');
    li.textContent = item;
    resultsList.appendChild(li);
  });

  resultsSection.style.display = 'flex';
}

function updateStatus(text) {
  const statusBar = document.getElementById('statusBar');
  const statusText = document.getElementById('statusText');
  statusText.textContent = text;
  statusBar.style.display = 'flex';
}

function setLoading(isLoading) {
  collectForm.querySelector('.primary-btn').disabled = isLoading;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

collectForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mainKeyword = mainQuery.value.trim();
  const maxDepth = parseInt(depthInput.value, 10) || 1;
  let baseDelay = parseFloat(delayInput.value) * 1000 || 2500;
  if (!mainKeyword) return;

  abortController = new AbortController();
  const { signal } = abortController;

  setLoading(true);
  stopBtn.style.display = 'inline-block';
  renderResults([]);

  const results = new Set();
  const processed = new Set();
  const queue = [];
  let consecutiveErrors = 0;

  queue.push({ query: mainKeyword, depth: 0 });
  const mainKeywordLower = mainKeyword.toLowerCase();

  while (queue.length > 0) {
    if (signal.aborted) {
      updateStatus('已停止');
      break;
    }

    const { query, depth } = queue.shift();

    if (processed.has(query)) continue;
    processed.add(query);

    updateStatus(`[深度 ${depth}] 正在处理: ${query} | 已收集 ${results.size} 条 | 延迟 ${(baseDelay / 1000).toFixed(1)}s`);

    let suggestions = [];
    let success = false;

    try {
      suggestions = await fetchSuggestions(query);
      success = true;
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      console.error(`处理 "${query}" 失败:`, err);
    }

    if (success) {
      const filtered = apiNoFilter.checked
        ? suggestions
        : suggestions.filter((s) => s.toLowerCase().includes(mainKeywordLower));

      for (const suggestion of filtered) {
        if (!results.has(suggestion)) {
          results.add(suggestion);
          renderResults(Array.from(results));

          if (depth < maxDepth) {
            queue.push({ query: suggestion, depth: depth + 1 });
          }
        }
      }
    }

    if (consecutiveErrors > 0) {
      baseDelay *= 2;
      updateStatus(`请求异常，延迟退避至 ${(baseDelay / 1000).toFixed(1)}s`);
    }

    if (queue.length > 0 && !signal.aborted) {
      await sleep(baseDelay);
    }
  }

  updateStatus(`采集完成! 共收集 ${results.size} 条`);
  stopBtn.style.display = 'none';
  setLoading(false);
  abortController = null;
});

stopBtn.addEventListener('click', () => {
  if (abortController) {
    abortController.abort();
  }
});

copyBtn.addEventListener('click', async () => {
  if (currentResults.length === 0) return;
  const text = currentResults.join('\n');
  try {
    await navigator.clipboard.writeText(text);
    updateStatus('已复制到剪贴板');
  } catch (err) {
    updateStatus('复制失败');
  }
});

exportBtn.addEventListener('click', () => {
  if (currentResults.length === 0) return;

  const csvContent = currentResults.map((r) => `"${r.replace(/"/g, '""')}"`).join('\n');
  const blob = new Blob([ '\uFEFF' + csvContent ], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `suggestions_${new Date().toISOString().slice(0,19).replace(/[:T]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  updateStatus('CSV 已导出');
});

const pageScrapeForm = document.getElementById('pageScrapeForm');
const pageQuery = document.getElementById('pageQuery');

pageScrapeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const keyword = pageQuery.value.trim();
  if (!keyword) return;

  updateStatus('正在从当前页面抓取...');
  pageScrapeForm.querySelector('.primary-btn').disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      target: 'contentScript',
      payload: { action: 'scrapeSuggestions' }
    });

    if (response && response.error) {
      updateStatus(`抓取失败: ${response.error}`);
      renderResults([]);
    } else if (response && Array.isArray(response.suggestions)) {
      const keywordLower = keyword.toLowerCase();
      const filtered = pageNoFilter.checked
        ? response.suggestions
        : response.suggestions.filter((s) => s.toLowerCase().includes(keywordLower));
      renderResults(filtered);
      updateStatus(`抓取完成! 页面建议 ${response.suggestions.length} 条，过滤后 ${filtered.length} 条`);
    } else {
      updateStatus('未获取到建议，请确认 Google 页面已显示下拉框');
      renderResults([]);
    }
  } catch (err) {
    updateStatus(`请求失败: ${err.message}`);
    renderResults([]);
  } finally {
    pageScrapeForm.querySelector('.primary-btn').disabled = false;
  }
});
