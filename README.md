# Finna MCP

MCP server for [Finna](https://finna.fi) - Finnish library, archive, and museum search.

> **Note**: This is not an official Finna project. Uses the [Finna API v1](https://api.finna.fi/v1).

## Features

- **search_records**: Search with filters, facets, and field selection
- **get_record**: Fetch full metadata by record ID
- **list_organizations**: Browse library/museum hierarchy
- **/spec**: Endpoint returning full tool schema

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
curl http://localhost:8787/spec | jq .  # view tool schema
```

## Tools

### search_records

Search for records with filters and facets.

```bash
curl -X POST http://localhost:8787/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "search_records",
      "arguments": {
        "lookfor": "helsinki",
        "type": "AllFields",
        "format": "0/Image/",
        "limit": 3
      }
    }
  }'
```

**Response:**
```json
{
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"summary\":\"search_records: 9424 hits 3 returned\",\"response\":{\"resultCount\":9424,\"records\":[{\"id\":\"vaski.4414504\",\"title\":\"Kimpassa : friends edition\",\"type\":\"Sana/kuvakortti\",\"format\":\"0/Image/\",\"year\":\"2024\",\"organization\":{\"primary\":\"Vaski-kirjastot\",\"code\":\"0/Vaski/\",\"locations\":3},\"recordUrl\":\"https://finna.fi/Record/vaski.4414504\"}]}}"
    }]
  }
}
```

### get_record

Fetch full metadata for one or more records.

```bash
curl -X POST http://localhost:8787/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "get_record",
      "arguments": {
        "ids": ["vaski.4392587"]
      }
    }
  }'
```

**Response:**
```json
{
  "result": {
    "content": [{
      "type": "text",
      "text": "{\"summary\":\"get_record: 1 record\",\"response\":{\"records\":[{\"id\":\"vaski.4392587\",\"title\":\"Kotiliesi 2025\",\"links\":[{\"url\":\"https://digi.kansalliskirjasto.fi/...\"},{\"url\":\"https://www.varastokirjasto.fi/...\"}],\"organizations\":[{\"code\":\"0/Vaski/\",\"name\":\"Vaski-kirjastot\"},{\"code\":\"1/Vaski/1/\",\"name\":\"Turku\"}]}}}"
    }]
  }
}
```

## Tool Schema

The full tool specification is available at `/spec`:

```bash
curl http://localhost:8787/spec | jq .
```

**Returns:**
```json
{
  "tools": [
    {
      "name": "search_records",
      "description": "Search and retrieve metadata over records in Finna.fi...",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": {"type": "string", "description": "Search keywords..."},
          "format": {
            "type": ["string", "array"],
            "description": "Content types (top-level format codes)..."
          },
          ...
        }
      }
    },
    {
      "name": "get_record",
      "description": "Get full metadata for one or more records.",
      ...
    },
    {
      "name": "list_organizations",
      "description": "List organizations that have material in Finna.",
      ...
    },
    {
      "name": "help",
      "description": "Show a help guide about Finna.fi...",
      ...
    }
  ]
}
```
