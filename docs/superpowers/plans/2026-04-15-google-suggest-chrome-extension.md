# Google Suggest Chrome Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chrome extension that opens in a side panel, providing two modes for scraping Google search suggestions: single-query (simple) and recursive BFS crawling (advanced) with CSV export.

**Architecture:** A pure side-panel extension with a service worker that opens the panel on icon click. All logic lives in `sidebar.js`: an XML parser for Google Suggest API responses, a BFS crawler with depth limiting and rate limiting, and a lightweight UI with tab switching.

**Tech Stack:** Chrome Extension Manifest V3, vanilla HTML/CSS/JS, Google Suggest API (`suggestqueries.google.com`).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `manifest.json` | Extension manifest: permissions (`sidePanel`, `activeTab`), background service worker, side panel path, icons. |
| `background.js` | Service worker. Listens to `chrome.action.onClicked` and opens the side panel via `chrome.sidePanel.open({ windowId })`. |
| `sidebar.html` | Side panel UI: tab navigation, simple mode form, recursive mode form, results list, progress indicator, action buttons (copy, export, stop). |
| `sidebar.css` | Side panel styles: tab buttons, forms, result list, scrollable area, compact layout (~360px width). |
| `sidebar.js` | All application logic: API fetching, XML parsing, simple mode rendering, recursive BFS crawler (depth 5, delay 1500ms, keyword filtering), CSV export, copy-to-clipboard, UI state management. |
| `icon.png` | Extension icon used in toolbar and manifest (16, 48, 128). Generated via a small Python script from an inline SVG. |

---

## Task 1: Manifest and Background Script

**Files:**
- Create: `manifest.json`
- Create: `background.js`

- [ ] **Step 1.1: Write manifest.json**

```json
{
  "manifest_version": 3,
  "name": "Google Suggest Collector",
  "version": "1.0.0",
  "description": "采集 Google 下拉框搜索建议",
  "permissions": ["sidePanel", "activeTab"],
  "host_permissions": ["https://suggestqueries.google.com/*"],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_icon": {
      "16": "icon.png",
      "48": "icon.png",
      "128": "icon.png"
    }
  },
  "side_panel": {
    "default_path": "sidebar.html"
  },
  "icons": {
    "16": "icon.png",
    "48": "icon.png",
    "128": "icon.png"
  }
}
```

- [ ] **Step 1.2: Write background.js**

```javascript
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.error('打开 Side Panel 失败:', error);
  }
});
```

- [ ] **Step 1.3: Commit**

```bash
git add manifest.json background.js
git commit -m "feat: add manifest and background side panel opener"
```

---

## Task 2: Side Panel HTML

**Files:**
- Create: `sidebar.html`

- [ ] **Step 2.1: Write sidebar.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Google Suggest Collector</title>
  <link rel="stylesheet" href="sidebar.css">
</head>
<body>
  <div class="container">
    <header class="header">
      <h1>Google 建议词采集</h1>
    </header>

    <!-- Tab Navigation -->
    <div class="tabs">
      <button class="tab-btn active" data-tab="simple">简单模式</button>
      <button class="tab-btn" data-tab="recursive">递归模式</button>
    </div>

    <!-- Simple Mode -->
    <div class="tab-content active" id="simpleTab">
      <form id="simpleForm" class="form">
        <label class="input-label">输入关键词</label>
        <input type="text" id="simpleQuery" class="text-input" placeholder="例如: python" required>
        <button type="submit" class="primary-btn">获取建议</button>
      </form>
    </div>

    <!-- Recursive Mode -->
    <div class="tab-content" id="recursiveTab">
      <form id="recursiveForm" class="form">
        <label class="input-label">主关键词</label>
        <input type="text" id="recursiveQuery" class="text-input" placeholder="例如: python" required>
        <div class="hint">深度 5，间隔 1.5s，自动过滤包含主关键词的结果</div>
        <button type="submit" class="primary-btn">开始递归采集</button>
      </form>
    </div>

    <!-- Progress / Status -->
    <div class="status-bar" id="statusBar" style="display: none;">
      <span id="statusText">准备就绪</span>
      <button id="stopBtn" class="danger-btn" style="display: none;">停止</button>
    </div>

    <!-- Results -->
    <div class="results-section" id="resultsSection" style="display: none;">
      <div class="results-header">
        <span class="results-count">共 <span id="resultCount">0</span> 条</span>
        <div class="results-actions">
          <button id="copyBtn" class="secondary-btn">复制全部</button>
          <button id="exportBtn" class="secondary-btn">导出 CSV</button>
        </div>
      </div>
      <ul class="results-list" id="resultsList"></ul>
    </div>
  </div>

  <script src="sidebar.js"></script>
</body>
</html>
```

- [ ] **Step 2.2: Commit**

```bash
git add sidebar.html
git commit -m "feat: add side panel html with tabbed ui"
```

---

## Task 3: Side Panel Styles

**Files:**
- Create: `sidebar.css`

- [ ] **Step 3.1: Write sidebar.css**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 13px;
  color: #1f2937;
  background: #f9fafb;
}

.container {
  width: 100%;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  padding: 12px 16px;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}

.header h1 {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
}

.tabs {
  display: flex;
  background: #fff;
  border-bottom: 1px solid #e5e7eb;
}

.tab-btn {
  flex: 1;
  padding: 10px 0;
  border: none;
  background: transparent;
  font-size: 13px;
  font-weight: 500;
  color: #6b7280;
  cursor: pointer;
  border-bottom: 2px solid transparent;
}

.tab-btn.active {
  color: #2563eb;
  border-bottom-color: #2563eb;
}

.tab-content {
  display: none;
  padding: 12px 16px;
  background: #fff;
}

.tab-content.active {
  display: block;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-label {
  font-size: 12px;
  font-weight: 500;
  color: #374151;
}

.text-input {
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
}

.text-input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}

.hint {
  font-size: 11px;
  color: #6b7280;
  line-height: 1.4;
}

.primary-btn, .secondary-btn, .danger-btn {
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
}

.primary-btn {
  background: #2563eb;
  color: #fff;
}

.primary-btn:hover { opacity: 0.92; }
.primary-btn:disabled { background: #93c5fd; cursor: not-allowed; }

.secondary-btn {
  background: #fff;
  color: #374151;
  border: 1px solid #d1d5db;
}

.secondary-btn:hover { background: #f3f4f6; }

.danger-btn {
  background: #dc2626;
  color: #fff;
  padding: 4px 10px;
  font-size: 12px;
}

.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: #eff6ff;
  font-size: 12px;
  color: #1e40af;
}

.results-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  border-top: 1px solid #e5e7eb;
}

.results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid #e5e7eb;
}

.results-count {
  font-size: 12px;
  font-weight: 500;
  color: #374151;
}

.results-actions {
  display: flex;
  gap: 6px;
}

.results-list {
  flex: 1;
  overflow-y: auto;
  list-style: none;
  padding: 4px 0;
}

.results-list li {
  padding: 8px 16px;
  font-size: 13px;
  color: #1f2937;
  border-bottom: 1px solid #f3f4f6;
  word-break: break-all;
}

.results-list li:hover {
  background: #f9fafb;
}
```

- [ ] **Step 3.2: Commit**

```bash
git add sidebar.css
git commit -m "feat: add side panel styles"
```

---

## Task 4: Core API Client and XML Parser

**Files:**
- Create: `sidebar.js` (partial)

- [ ] **Step 4.1: Write fetchSuggestions function**

Append this to `sidebar.js`:

```javascript
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
```

- [ ] **Step 4.2: Commit**

```bash
git add sidebar.js
git commit -m "feat: add google suggest api client"
```

---

## Task 5: Simple Mode UI Logic

**Files:**
- Modify: `sidebar.js`

- [ ] **Step 5.1: Add simple mode handlers**

Append to `sidebar.js`:

```javascript
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
```

- [ ] **Step 5.2: Add shared helpers**

Append to `sidebar.js` (before or after, order doesn't matter as long as it's in the file):

```javascript
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
```

- [ ] **Step 5.3: Commit**

```bash
git add sidebar.js
git commit -m "feat: add simple mode query and render"
```

---

## Task 6: Recursive Mode Crawler

**Files:**
- Modify: `sidebar.js`

- [ ] **Step 6.1: Add recursive mode logic**

Append to `sidebar.js`:

```javascript
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
```

- [ ] **Step 6.2: Commit**

```bash
git add sidebar.js
git commit -m "feat: add recursive bfs crawler with depth 5 and 1500ms delay"
```

---

## Task 7: Copy and CSV Export

**Files:**
- Modify: `sidebar.js`

- [ ] **Step 7.1: Add copy and export handlers**

Append to `sidebar.js`:

```javascript
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
```

- [ ] **Step 7.2: Commit**

```bash
git add sidebar.js
git commit -m "feat: add copy and csv export"
```

---

## Task 8: Tab Switching

**Files:**
- Modify: `sidebar.js`

- [ ] **Step 8.1: Add tab switching logic**

Append to `sidebar.js`:

```javascript
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab');
    document.getElementById(`${tabId}Tab`).classList.add('active');

    // Hide results when switching tabs to avoid confusion
    resultsSection.style.display = 'none';
    currentResults = [];
    resultsList.replaceChildren();
    resultCount.textContent = '0';
  });
});
```

- [ ] **Step 8.2: Commit**

```bash
git add sidebar.js
git commit -m "feat: add tab switching"
```

---

## Task 9: Generate Extension Icon

**Files:**
- Create: `icon.png` (via a temporary Python script)

- [ ] **Step 9.1: Generate icon with Python**

Run this command in the project root to generate a 128x128 blue "G" icon:

```bash
python3 -c "
from PIL import Image, ImageDraw, ImageFont

size = 128
img = Image.new('RGB', (size, size), '#2563eb')
draw = ImageDraw.Draw(img)

try:
    font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 72)
except:
    font = ImageFont.load_default()

bbox = draw.textbbox((0,0), 'G', font=font)
text_w = bbox[2] - bbox[0]
text_h = bbox[3] - bbox[1]
x = (size - text_w) / 2
y = (size - text_h) / 2 - 4
draw.text((x, y), 'G', fill='white', font=font)

img.save('icon.png')
print('icon.png created')
"
```

Expected output: `icon.png created`

- [ ] **Step 9.2: Commit**

```bash
git add icon.png
git commit -m "feat: add extension icon"
```

---

## Task 10: End-to-End Verification

- [ ] **Step 10.1: Load the unpacked extension in Chrome**
  1. Open Chrome → Extensions → Manage extensions
  2. Enable "Developer mode"
  3. Click "Load unpacked" and select the project directory
  4. Verify the extension appears with the blue "G" icon

- [ ] **Step 10.2: Test simple mode**
  1. Click the extension icon to open the side panel
  2. Switch to "简单模式" tab
  3. Enter `python` and click "获取建议"
  4. Expect: a list of suggestions appears (e.g., `python programming`, `python tutorial`)
  5. Click "复制全部" and verify clipboard contains newline-separated suggestions

- [ ] **Step 10.3: Test recursive mode**
  1. Switch to "递归模式" tab
  2. Enter `python` and click "开始递归采集"
  3. Expect: status bar updates with progress like `[深度 0] 正在处理: python`
  4. Wait for completion or click "停止" to abort early
  5. Verify all results contain the word `python` (case-insensitive)
  6. Click "导出 CSV" and verify the downloaded file contains one column of quoted keywords

- [ ] **Step 10.4: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "fix: adjustments from manual testing"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - Side Panel opening via icon click → Task 1
   - Simple mode (single query) → Tasks 4 + 5
   - Recursive mode (BFS, depth 5, 1500ms delay, keyword filtering) → Task 6
   - Results display + copy + CSV export → Tasks 5 + 7
   - Tab switching between modes → Task 8
   - Icon asset → Task 9

2. **Placeholder scan:** All steps contain explicit code or exact commands. No "TODO" or "implement later" patterns.

3. **Type consistency:** All DOM element IDs in HTML match the JS selectors exactly. Function names (`fetchSuggestions`, `renderResults`, `updateStatus`) are consistent across tasks.
