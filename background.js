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
