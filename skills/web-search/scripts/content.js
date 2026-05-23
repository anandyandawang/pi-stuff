#!/usr/bin/env node

const https = require('https');

async function fetchContent(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      },
    };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function cleanHtml(html) {
  // Remove script and style elements
  let cleaned = html.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, '');
  cleaned = cleaned.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, '');
  
  // Remove all other HTML tags
  cleaned = cleaned.replace(/<[^>]*>/g, ' ');
  
  // Normalize whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  
  return cleaned;
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node content.js "https://example.com"');
    process.exit(1);
  }

  try {
    const html = await fetchContent(url);
    const text = cleanHtml(html);
    console.log(text);
  } catch (err) {
    console.error('Error fetching content:', err.message);
    process.exit(1);
  }
}

main();
