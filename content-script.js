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
