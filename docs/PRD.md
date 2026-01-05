# Finna MCP Server PRD

## Overview
TODO: Describe the product goals and scope for the Finna MCP server.

- MCP server that supports searching records (any format Finna supports) and retrieving their metadata.
- Finna inludes material from many organizations (libraries, archives, museums). The same record may be included into many organizations collection at may show up multiple times in the search results. Finna suppors filtering by organization.
- Finna includes records that are "available online", i.e. they contain some resource that is accessible online. Unfortunately what exactly this means varies based on the organization that provides the metadata. Some organizations tag the record as available online even when the record only contains a link that requires some internal access (for example university account). 
- Some records contain links to attachments (images, pdfs etc)


## Finna API
- [Finna API Swagger ](https://api.finna.fi/swagger-ui)
- [Finna search results](https://www.finna.fi/Search/Results?limit=0&filter%5B%5D=free_online_boolean%3A%221%22&filter%5B%5D=%7Eformat_ext_str_mv%3A%220%2FImage%2F%22&filter%5B%5D=%7Eformat_ext_str_mv%3A%221%2FImage%2FPhoto%2F%22&lookfor=mika+waltari&type=AllFields)

## Research findings (2026-01-04)
### Search/record responses (API observations)
- Default search response includes fields like `id`, `title`, `buildings`, `formats`, `images`, `languages`, `nonPresenterAuthors`, `onlineUrls`, `presenters`, `rating`, `series`, `subjects`, `year`. citeturn9view0
- Example search (lookfor=sibelius) returns mixed material types (books, sound, etc) and shows `buildings` values for organizations and `formats` for type hierarchy, including Kansalliskirjasto and Arto. citeturn9view0
- Image-focused searches (`filter[]=format:"0/Image/"` + `filter[]=online_boolean:"1"` + `field[]=images`) return `images` as relative `/Cover/Show?...` URLs; prepend `https://api.finna.fi` to fetch images. citeturn17view0turn7view0
- Example image URL (from docs) points to a real image asset served by the API. citeturn8view6turn7view0
- Record endpoint (example `id=fikka.4450004`) returns a compact record (no raw/full by default) with `formats`, `buildings`, `presenters`, `subjects`, etc. citeturn10view0
- `fullRecord` and `rawData` are available fields but are not returned unless explicitly requested via `field[]`. `rawData` is described as “all index data for the record, excluding fullRecord.” These are heavy. citeturn9view0
- `embeddedComponentParts` is available but costly per API docs. citeturn14view0
- `recordPage` is referenced in docs; UI record pages provide a “Finna API” link that emits a record endpoint URL. citeturn7view0turn12view0
  - Note: the English docs list example record IDs like `fennica.123`, but the example appears to be a placeholder (record fetch returned HTTP 400). citeturn11view1turn9view0

### Format and organization coverage (planning notes)
- Search results show diverse org sources (`building`) and material types (`format`) in a single query; deduplication merges near-duplicates and can be de-scoped via `building` filter. citeturn9view0
- Museum/heritage images show up with `museovirasto` and `hkm` IDs (National Board of Antiquities, Helsinki City Museum) and deliver `images` URLs via `/Cover/Show` (useful for media-first results). citeturn17view0
- Kansalliskirjasto (older books / serials) records can include direct resource URLs (`urls`) to digi.kansalliskirjasto.fi; `onlineUrls` may still be empty even when `urls` are present. citeturn12view0
- Audio/archive material (Musiikkiarkisto) returns detailed creators and formats but no `onlineUrls` in the API by default, while the UI shows rich notes including digitization and attachments (wav/jpg). This suggests useful info may be in `fullRecord`/`rawData` for some providers. citeturn19view0turn18view0

### Availability info (Finna UI)
- Finna UI displays “Saatavuustiedot” and has a dedicated `/Record/<id>/Holdings` view; the plain API record response does not include holdings/availability, so availability likely needs a separate endpoint (possibly holdings or org-specific services). citeturn11view0turn12view1turn12view0
- Example query the frontend uses: 
```
curl 'https://finna.fi/AJAX/JSON?method=getItemStatuses' \
  -H 'accept: application/json' \
  -H 'accept-language: en-US,en;q=0.9' \
  -H 'content-type: application/x-www-form-urlencoded; charset=UTF-8' \
  -b 'finna.fi=finna-fe-6; PHPSESSID=ha75f351dmln8iess8dkcdbenr6mmmra; ui=standard; cc_finnafi=%7B%22categories%22%3A%5B%22essential%22%5D%2C%22revision%22%3A0%2C%22data%22%3Anull%2C%22consentTimestamp%22%3A%222026-01-04T10%3A25%3A14.723Z%22%2C%22consentId%22%3A%22b4b3fcae-9d91-4df4-8577-af7b9b83de21%22%2C%22services%22%3A%7B%22video%22%3A%5B%5D%2C%22essential%22%3A%5B%5D%2C%22matomo%22%3A%5B%5D%7D%2C%22lastConsentTimestamp%22%3A%222026-01-04T10%3A25%3A14.723Z%22%2C%22expirationTime%22%3A1783247114723%7D; language=fi; cf_clearance=TGTCEVQPTG8Y4f4ZKUT33xR543mojPkOjquMABHzvpA-1767600709-1.2.1.1-Cv.HtWKc3iAwzIEAz_afaCgWoIZe3jpLv3jTf8sKT0lTMw0IuwBkEXoDnk3i1JWpDWq7x_0JfkoJ9GnFHtjX8DG_GYDIxLNW5REfHWyCA8cO_ZNusRyTiYrwh1XDhPRt7cEGKf_l5SB3UDnWpkYs5CP95wjo6HrXdoiSxDZroVR2mUQZQG_JEkuu0WFrscZgn9nyjR70gMH4ko2Zw35xTADo5KgjUa0b9vOGO6AmBWY; preferredRecordSource=[%22lukki%22%2C%22helmet%22]' \
  -H 'origin: https://finna.fi' \
  -H 'priority: u=1, i' \
  -H 'referer: https://finna.fi/Search/Results?type=AllFields&filter%5B%5D=~format%3A%220%2FBook%2F%22' \
  -H 'sec-ch-ua: "Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "Linux"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-origin' \
  -H 'user-agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36' \
  --data-raw 'id%5B%5D=lukki.1083107&sid=5220043637'
```

### Heavy fields (fullRecord/rawData) follow-up
- Docs explicitly describe `fullRecord` (original metadata) and `rawData` (all indexed data excluding fullRecord) and note that image URLs must be prefixed with `https://api.finna.fi` when retrieving the image resource. citeturn9view0
- The docs include an example record containing component parts fetched with `field[]=fullRecord` (viola.49914). citeturn9view0
- Action item: once we have confirmed “real” record IDs per org/type (e.g., Kansalliskirjasto, archives, museums), fetch `field[]=fullRecord&field[]=rawData` and document what content appears only in heavy fields (especially attachments/links).

### Direct API snapshots (2026-01-05)
- Search `lookfor=sibelius` returns mixed record types and includes Kansalliskirjasto (NLF) sources; example IDs include `arto.005369812` (NLF/Arto book) and `fikka.4702946` (NLF sound/CD). citeturn11view0
- Record `fikka.4450004` (NLF, sound disc) has no `onlineUrls`, `urls`, or `images` in the default record response, so not all records expose resources without further querying. citeturn15view0
- Image search with `online_boolean` + `format:"0/Image/"` and `field[]=images&field[]=title` returns many museum/heritage IDs and `Cover/Show` URLs. Examples include `hkm.3a4425aa-28ba-4435-92a0-4678ffb90ec6` and several `museovirasto.*` records. These `images` URLs are relative and must be prefixed with `https://api.finna.fi`. citeturn19view0turn9view0
- OpenAPI schema defines `fullRecord` as an array of strings (“Full metadata record (typically XML)”), and includes `events` for museum (LIDO) material. This supports a plan to keep defaults in unified fields and only opt into heavy fields when needed. citeturn21view0

### Implications for MCP defaults
- Prefer unified fields for default responses (title, creators, formats, buildings, images, onlineUrls, urls, year).
- Provide opt-in flags for `fullRecord` and `rawData` with aggressive pruning.
- Provide a dedicated `images` helper that expands `Cover/Show` relative paths to full URLs.

### Open questions
- Confirm where `record_format` is exposed (likely in `rawData`); use it to drive format-specific pruning.
- Identify availability endpoint (if any) and whether it can be called uniformly across orgs.

## Users
- TODO

## Requirements
- TODO

## Out of scope
- TODO

## Local Dev & Tests (quick notes)
- `npm run test` runs unit tests (no network).
- `npm run test:integration` runs live integration tests against local wrangler dev server.
  - Override target with `FINNA_MCP_BASE_URL=http://127.0.0.1:8787/mcp`.
- Python CLI client (separate deps):
  - `pip install -r examples/requirements.txt`
  - `python examples/mcp_cli.py "find photos of helsinki"` (uses `MCP_URL` + `MODEL` env vars).
- Python TUI client (curses, same deps):
  - `python examples/mcp_tui.py`
