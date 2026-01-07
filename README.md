# Finna MCP

MCP server for [Finna](https://finna.fi) - Finnish library, archive, and museum search.

> **Note**: This is not an official Finna project. Uses the [Finna API v1](https://api.finna.fi/v1).

## Features

- **search_records**: Search with filters, facets, and field selection
- **get_record**: Fetch full metadata by record ID
- **resources**: Unified `links` array (images, PDFs, audio, video, external)
- **organizations**: Hierarchical format codes (e.g., `0/Helmet/`, `1/Helmet/n/`)

## Deploy to Cloudflare Workers

Requires a Cloudflare account:

```bash
npm install
npm run deploy
```

## Local Development

```bash
npm run dev          # http://localhost:8787/v1
npm test             # unit tests
npm run test:integration  # live tests
```

## MCP Endpoint

POST to `/v1` with JSON-RPC 2.0:

```bash
curl -X POST http://localhost:8787/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "search_records",
      "arguments": {"lookfor": "sibelius", "type": "AllFields", "limit": 3}
    }
  }'
```
