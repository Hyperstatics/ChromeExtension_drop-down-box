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
          files: ['content-script.js']
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
      sendToContentScript(activeTab.id, request.payload, sendResponse);
    });
    return true; // keep channel open for async
  }
});
