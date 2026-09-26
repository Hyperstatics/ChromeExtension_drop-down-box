function getSearchBoxValue() {
  const fields = Array.from(document.querySelectorAll('textarea[name="q"], input[name="q"]'));
  const visible = fields.find((field) => field.getClientRects().length);
  return (visible || fields[0])?.value || '';
}

let lastSnapshot = { keyword: '', suggestions: [] };

function readVisibleSuggestions() {
  // The homepage and SERP use different autocomplete wrappers.
  const options = document.querySelectorAll(
    '[role="listbox"] [role="option"], [role="listbox"] .sbct, #Alh6id .sbct, .aajZCb .sbct'
  );
  const suggestions = [];
  const seen = new Set();

  options.forEach((el) => {
    if (!el.getClientRects().length) return;
    // SERP suggestions use .sbct rows with role="presentation".
    const text = (el.getAttribute('aria-label') || el.querySelector('.wM6W7d, .sbl1')?.textContent || el.innerText || '').trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      suggestions.push(text);
    }
  });

  return suggestions;
}

function captureSuggestions() {
  const keyword = getSearchBoxValue();
  if (keyword !== lastSnapshot.keyword) {
    lastSnapshot = { keyword, suggestions: [] };
  }
  const suggestions = readVisibleSuggestions();
  if (suggestions.length) lastSnapshot = { keyword, suggestions };
}

function scrapeSuggestions() {
  captureSuggestions();
  const keyword = getSearchBoxValue();

  return {
    keyword,
    suggestions: lastSnapshot.keyword === keyword ? lastSnapshot.suggestions : []
  };
}

document.addEventListener('input', (event) => {
  if (event.target.matches('textarea[name="q"], input[name="q"]')) {
    lastSnapshot = { keyword: getSearchBoxValue(), suggestions: [] };
  }
}, true);

const observer = new MutationObserver(captureSuggestions);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'aria-hidden'] });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeSuggestions') {
    sendResponse(scrapeSuggestions());
  }
  return false;
});
