#!/usr/bin/env node

const https = require('https');

async function search(query) {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://html.duckduckgo.com/html/?q=${encodedQuery}`;
  
  const options = {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  };

  return new Promise((resolve, reject) => {
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function parseResults(html) {
  const results = [];
  // Match result blocks. DuckDuckGo HTML structure:
  // <a ... class="result__a" ... href="URL">TITLE</a>
  // ...
  // <a ... class="result__snippet" ... href="URL">SNIPPET</a>
  
  const resultBlocks = html.split('class="result results_links');
  
  for (let i = 1; i < resultBlocks.length; i++) {
    const block = resultBlocks[i];
    
    const titleMatch = block.match(/class="result__a" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    const snippetMatch = block.match(/class="result__snippet" href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    
    if (titleMatch && snippetMatch) {
      let url = titleMatch[1];
      const title = titleMatch[2].replace(/<[^>]*>/g, '').trim();
      const snippet = snippetMatch[2].replace(/<[^>]*>/g, '').trim();
      
      // Decode DDG redirection URLs: //duckduckgo.com/l/?uddg=https%3A%2F%2F...
      if (url.includes('uddg=')) {
        const uddgMatch = url.match(/uddg=([^&]+)/);
        if (uddgMatch) {
          url = decodeURIComponent(uddgMatch[1]);
        }
      }
      if (url.startsWith('//')) {
        url = 'https:' + url;
      }
      
      results.push({ title, url, snippet });
    }
  }
  
  return results;
}

async function main() {
  const query = process.argv[2];
  if (!query) {
    console.error('Usage: node search.js "search query"');
    process.exit(1);
  }

  try {
    const html = await search(query);
    const results = parseResults(html);
    
    if (results.length === 0) {
      console.log('No results found.');
      return;
    }

    results.forEach((res, index) => {
      console.log(`${index + 1}. ${res.title}`);
      console.log(`   URL: ${res.url}`);
      console.log(`   Snippet: ${res.snippet}`);
      console.log('');
    });
  } catch (err) {
    console.error('Error during search:', err.message);
    process.exit(1);
  }
}

main();
