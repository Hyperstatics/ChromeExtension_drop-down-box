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
