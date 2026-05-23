---
name: web-search
description: Web search and content extraction via DuckDuckGo. Use for searching documentation, facts, or any web content.
---

# Web Search

## Setup

If you are running this outside of a pre-configured environment, you may need to install dependencies:
```bash
npm install node-fetch
```
*(Note: This skill uses native `https` where possible to minimize dependencies)*

## Search

Search the web using DuckDuckGo:
```bash
./scripts/search.js "your search query"
```

## Extract Page Content

Extract text content from a specific URL:
```bash
./scripts/content.js "https://example.com"
```
