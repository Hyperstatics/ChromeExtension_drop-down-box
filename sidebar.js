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
