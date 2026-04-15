# Google Page Suggestion Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second mode to the extension that scrapes Google search autocomplete suggestions directly from the Google search page DOM, bypassing API rate limits.

**Architecture:** A content script injects into `https://www.google.com/*`, listens for a message from the side panel, finds the rendered autocomplete dropdown via ARIA attributes (`[role="listbox"] > [role="option"]`), and returns suggestion texts. The side panel sends messages through the background script (required because side panels cannot directly message content scripts).

**Tech Stack:** Chrome Extension Manifest V3, content script, `chrome.runtime.sendMessage`, ARIA selectors.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `manifest.json` | Add `content_scripts` entry for `https://www.google.com/*`. |
| `content-script.js` | Injected into Google pages. Handles `scrapeSuggestions` message: reads the search box value, queries the DOM for autocomplete options, filters empty/non-suggestion items, and returns the list. |
| `background.js` | Message broker: forwards requests from `sidebar.js` to the active tab's content script, then returns the response. |
| `sidebar.html` | Add a second form section: keyword input + "从当前页面抓取" button, plus a hint explaining the requirement to be on `google.com`. |
| `sidebar.css` | Add compact styles for the new section divider and secondary form. |
| `sidebar.js` | Add event listener for the scrape button, send message to background, display results, and reuse existing `renderResults` / copy / export logic. |

---

## Task 1: Update Manifest for Content Script

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1.1: Add content_scripts to manifest.json**

Replace the entire file with:

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
  "content_scripts": [
    {
      "matches": ["https://www.google.com/*"],
      "js": ["content-script.js"],
      "run_at": "document_idle"
    }
  ],
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

- [ ] **Step 1.2: Commit**

```bash
git add manifest.json
git commit -m "feat: add content script for google.com in manifest"
```

---

## Task 2: Write Content Script

**Files:**
- Create: `content-script.js`

- [ ] **Step 2.1: Write content-script.js**

```javascript
function getSearchBoxValue() {
  const textarea = document.querySelector('textarea[name="q"]');
  if (textarea) return textarea.value;
  const input = document.querySelector('input[name="q"]');
  return input ? input.value : '';
}

function scrapeSuggestions() {
  const options = document.querySelectorAll('[role="listbox"] [role="option"]');
  const suggestions = [];
  const seen = new Set();

  options.forEach((el) => {
    // Prefer aria-label because it is the clean suggestion text
    const text = (el.getAttribute('aria-label') || el.innerText || '').trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      suggestions.push(text);
    }
  });

  return {
    keyword: getSearchBoxValue(),
    suggestions
  };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeSuggestions') {
    sendResponse(scrapeSuggestions());
  }
  return false;
});
```

- [ ] **Step 2.2: Commit**

```bash
git add content-script.js
git commit -m "feat: add content script to scrape google autocomplete dom"
```

---

## Task 3: Update Background Script as Message Broker

**Files:**
- Modify: `background.js`

- [ ] **Step 3.1: Add message forwarding to background.js**

Replace the entire file with:

```javascript
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.error('打开 Side Panel 失败:', error);
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.target === 'contentScript') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        sendResponse({ error: '没有活动标签页' });
        return;
      }
      const activeTab = tabs[0];
      if (!activeTab.url || !activeTab.url.startsWith('https://www.google.com')) {
        sendResponse({ error: '请先在 Google 搜索页面打开本扩展' });
        return;
      }
      chrome.tabs.sendMessage(activeTab.id, request.payload, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse(response);
        }
      });
    });
    return true; // keep channel open for async
  }
});
```

- [ ] **Step 3.2: Commit**

```bash
git add background.js
git commit -m "feat: background broker forwards scrape requests to active tab"
```

---

## Task 4: Add Page Scrape UI to Sidebar

**Files:**
- Modify: `sidebar.html`

- [ ] **Step 4.1: Insert page-scrape section below the existing form**

Replace the entire file with:

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

    <!-- API Mode -->
    <div class="form-section">
      <div class="section-label">API 采集模式</div>
      <form id="collectForm" class="form">
        <label class="input-label">关键词</label>
        <input type="text" id="mainQuery" class="text-input" placeholder="例如: python" required>

        <div class="two-col">
          <div class="form-col">
            <label class="input-label">深度</label>
            <input type="number" id="depthInput" class="text-input" min="0" max="10" value="0" required>
            <div class="hint">建议 0-5，0 = 只获取一次建议</div>
          </div>
          <div class="form-col">
            <label class="input-label">间隔（秒）</label>
            <input type="number" id="delayInput" class="text-input" min="0.5" step="0.5" value="2.5" required>
            <div class="hint">建议 2.5 秒以上</div>
          </div>
        </div>

        <button type="submit" class="primary-btn">开始采集</button>
      </form>
    </div>

    <!-- Page Scrape Mode -->
    <div class="form-section secondary-section">
      <div class="section-label">页面抓取模式</div>
      <form id="pageScrapeForm" class="form">
        <label class="input-label">关键词（用于过滤结果）</label>
        <input type="text" id="pageQuery" class="text-input" placeholder="例如: ai video generator" required>
        <div class="hint">需先在 google.com 搜索框输入并出现下拉建议</div>
        <button type="submit" class="primary-btn secondary">从当前页面抓取</button>
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

- [ ] **Step 4.2: Commit**

```bash
git add sidebar.html
git commit -m "feat: add page scrape section to sidebar"
```

---

## Task 5: Add Page Scrape Styles

**Files:**
- Modify: `sidebar.css`

- [ ] **Step 5.1: Append new styles for the secondary section**

Append to `sidebar.css`:

```css
.section-label {
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  margin-bottom: 10px;
}

.secondary-section {
  background: #f9fafb;
  border-top: 1px solid #e5e7eb;
}

.primary-btn.secondary {
  background: #4b5563;
  margin-top: 4px;
}

.primary-btn.secondary:hover {
  opacity: 0.92;
}
```

- [ ] **Step 5.2: Commit**

```bash
git add sidebar.css
git commit -m "feat: add styles for page scrape section"
```

---

## Task 6: Add Page Scrape Logic to Sidebar

**Files:**
- Modify: `sidebar.js`

- [ ] **Step 6.1: Add page scrape handler**

Append this to `sidebar.js` (after the existing code, before any closing tags):

```javascript
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
      const filtered = response.suggestions.filter((s) =>
        s.toLowerCase().includes(keywordLower)
      );
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
```

- [ ] **Step 6.2: Commit**

```bash
git add sidebar.js
git commit -m "feat: add page scrape message handler in sidebar"
```

---

## Task 7: End-to-End Verification

- [ ] **Step 7.1: Reload the unpacked extension in Chrome**
  1. Open `chrome://extensions/`
  2. Click the refresh icon on this extension

- [ ] **Step 7.2: Test page scrape mode**
  1. Open a new tab and go to `https://www.google.com`
  2. Type `ai video generator` in the search box **but do NOT press Enter**
  3. Wait for the autocomplete dropdown to appear
  4. Click the extension icon to open the side panel
  5. In "页面抓取模式", enter `ai video generator`
  6. Click "从当前页面抓取"
  7. Expect: a list of suggestions appears, and every item contains `ai video generator`

- [ ] **Step 7.3: Verify API mode still works**
  1. In "API 采集模式", enter `python`, depth `0`, delay `2.5`
  2. Click "开始采集"
  3. Expect: a list of suggestions appears as before

- [ ] **Step 7.4: Commit any test fixes**

```bash
git add -A
git commit -m "fix: adjustments from manual testing"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - Content script injection for google.com → Task 1
   - DOM scraping via ARIA selectors → Task 2
   - Background message broker → Task 3
   - Page scrape UI in side panel → Tasks 4 + 5
   - Sidebar message handler and filtering → Task 6
   - Existing API mode preserved → all tasks preserve it

2. **Placeholder scan:** All steps contain explicit code and commands. No placeholders.

3. **Type consistency:**
   - `request.action === 'scrapeSuggestions'` matches `payload: { action: 'scrapeSuggestions' }`
   - `target: 'contentScript'` matches the background listener condition
