chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (error) {
    console.error('打开 Side Panel 失败:', error);
  }
});

function sendToContentScript(tabId, payload, sendResponse, retry = true) {
  chrome.tabs.sendMessage(tabId, payload, (response) => {
    if (chrome.runtime.lastError) {
      if (retry && chrome.runtime.lastError.message.includes('Receiving end does not exist')) {
        // Dynamically inject content script and retry once
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content-script.js', 'serp-extractor.js']
        }, () => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
            return;
          }
          // Retry after a short delay to let the script initialize
          setTimeout(() => {
            sendToContentScript(tabId, payload, sendResponse, false);
          }, 300);
        });
        return;
      }
      sendResponse({ error: chrome.runtime.lastError.message });
    } else {
      sendResponse(response);
    }
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.target === 'contentScript') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        sendResponse({ error: '没有活动标签页' });
        return;
      }
      const activeTab = tabs[0];
      let pageUrl = null;
      try {
        if (activeTab.url) pageUrl = new URL(activeTab.url);
      } catch (error) {
        // A tab with a malformed or hidden URL cannot be inspected.
      }
      if (!pageUrl || pageUrl.protocol !== 'https:' || pageUrl.hostname !== 'www.google.com') {
        sendResponse({ error: pageUrl ? '请先在 Google 搜索页面打开本扩展' : '无法读取当前标签页地址，请确认扩展拥有 www.google.com 访问权限并重新加载扩展' });
        return;
      }
      if ((request.payload.action === 'extractSerp' || request.payload.action === 'serpDiagnostics') && pageUrl.pathname !== '/search') {
        sendResponse({ error: '请先打开 Google 搜索结果页' });
        return;
      }
      sendToContentScript(activeTab.id, request.payload, sendResponse);
    });
    return true; // keep channel open for async
  }
});
