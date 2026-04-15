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

const simpleForm = document.getElementById('simpleForm');
const simpleQuery = document.getElementById('simpleQuery');
const resultsSection = document.getElementById('resultsSection');
const resultsList = document.getElementById('resultsList');
const resultCount = document.getElementById('resultCount');
const copyBtn = document.getElementById('copyBtn');
const exportBtn = document.getElementById('exportBtn');

let currentResults = [];

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

simpleForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const query = simpleQuery.value.trim();
  if (!query) return;

  setLoading(true, 'simple');
  updateStatus('正在获取建议...');

  try {
    const suggestions = await fetchSuggestions(query);
    renderResults(suggestions);
    updateStatus(`获取完成，共 ${suggestions.length} 条`);
  } catch (err) {
    updateStatus(`请求失败: ${err.message}`);
  } finally {
    setLoading(false, 'simple');
  }
});

function updateStatus(text) {
  const statusBar = document.getElementById('statusBar');
  const statusText = document.getElementById('statusText');
  statusText.textContent = text;
  statusBar.style.display = 'flex';
}

function setLoading(isLoading, mode) {
  const btn = mode === 'simple'
    ? simpleForm.querySelector('.primary-btn')
    : document.querySelector('#recursiveForm .primary-btn');
  btn.disabled = isLoading;
}

const recursiveForm = document.getElementById('recursiveForm');
const recursiveQuery = document.getElementById('recursiveQuery');
const stopBtn = document.getElementById('stopBtn');

let abortController = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

recursiveForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const mainKeyword = recursiveQuery.value.trim();
  if (!mainKeyword) return;

  abortController = new AbortController();
  const { signal } = abortController;

  setLoading(true, 'recursive');
  stopBtn.style.display = 'inline-block';
  renderResults([]);

  const results = new Set();
  const processed = new Set();
  const queue = [];

  queue.push({ query: mainKeyword, depth: 0 });
  const mainKeywordLower = mainKeyword.toLowerCase();
  const MAX_DEPTH = 5;
  const DELAY_MS = 1500;

  while (queue.length > 0) {
    if (signal.aborted) {
      updateStatus('已停止');
      break;
    }

    const { query, depth } = queue.shift();

    if (processed.has(query)) continue;
    processed.add(query);

    updateStatus(`[深度 ${depth}] 正在处理: ${query} | 已收集 ${results.size} 条`);

    try {
      const suggestions = await fetchSuggestions(query);
      const filtered = suggestions.filter((s) =>
        s.toLowerCase().includes(mainKeywordLower)
      );

      for (const suggestion of filtered) {
        if (!results.has(suggestion)) {
          results.add(suggestion);
          renderResults(Array.from(results));

          if (depth < MAX_DEPTH) {
            queue.push({ query: suggestion, depth: depth + 1 });
          }
        }
      }
    } catch (err) {
      console.error(`处理 "${query}" 失败:`, err);
    }

    if (queue.length > 0 && !signal.aborted) {
      await sleep(DELAY_MS);
    }
  }

  updateStatus(`递归完成! 共收集 ${results.size} 条`);
  stopBtn.style.display = 'none';
  setLoading(false, 'recursive');
  abortController = null;
});

stopBtn.addEventListener('click', () => {
  if (abortController) {
    abortController.abort();
  }
});
