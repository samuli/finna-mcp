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

### Common format codes (working list)
Use these in `filters.include.format` when narrowing by type:
- Book: `0/Book/`
- Article: `0/Article/`
- Journal: `0/Journal/`
- Audio (generic): `0/Sound/`
- Audio (music): `0/Sound/Music/`
- Video: `0/Video/`
- Image: `0/Image/`
- Image (photo): `0/Image/Photo/`
- Map: `0/Map/`
- Manuscript: `0/Manuscript/`
- Thesis/Dissertation: `0/Thesis/`

### Organization identifiers (working notes)
- Use `list_organizations` and then pass the returned **building** values into `filters.include.building`.
- Example building value: `0/URHEILUMUSEO/` (from `list_organizations`).

### Organization sector/type (derive via Finna facet)
- Finna exposes a hierarchical facet `sector_str_mv` for organization sector/type. This facet is listed among the hierarchical facets in the API docs. citeturn1search0turn3search4
- Derive sector values dynamically (do not hard-code):  
  `https://api.finna.fi/v1/search?lookfor=&facet[]=sector_str_mv&limit=0&lng=fi`  
  Use returned `value` strings as filter values.
- Keep only a minimal example in docs (e.g., one sector value) once verified from live API output.

### When to drop facets (token control)
- Default: do **not** request facets in `search_records`. Only include facets when explicitly needed (e.g., to discover building/format codes).
- For `search_records` responses, strip `facets` from the returned payload unless the caller requested facets.
- For `list_organizations`, keep facets (this tool exists purely to return facet values), but strip `href` and any unused fields.

### Open questions
- Confirm where `record_format` is exposed (likely in `rawData`); use it to drive format-specific pruning.
- Identify availability endpoint (if any) and whether it can be called uniformly across orgs.

## Local MCP Evaluation (2026-01-05)
### Use cases tested (local MCP vs Finna API)
- Simple topical search: `search_records(lookfor="sibelius", limit=3)`
  - MCP `resultCount` matches API (44,850). Top IDs differ from API, likely due to ranking differences and default field set.
  - MCP records include `recordUrl` (Finna record page) by default.
- Multi-term query: `search_records(search_mode="advanced", advanced_operator="AND", lookfor="deep learning algorithm")`
  - MCP `resultCount` matches API (2,061). Top IDs differ but overlap exists.
  - Advanced mode successfully expands terms into Finna’s advanced query parameters.
- Organization lookup: `list_organizations(lookfor="Rauma")`
  - MCP returns hierarchical results with nested nodes (`Satakirjastot > Rauma > Rauman pääkirjasto`).
- Unfiltered org list: `list_organizations()`
  - Response is pruned to 2 levels with `meta.pruned=true` and `meta.prunedDepth=2`.
- Count books in a system: `search_records(limit=0, filters.include.building=["0/Helmet/"], filters.include.format=["0/Book/"])`
  - MCP `resultCount` matches API (586,769).
- Record details + resources: `get_record(ids=[<id>])` and `extract_resources(ids=[<id>])`
  - `recordUrl` included by default.
  - If a record has no images/urls, resource counts may be pruned to `null` (by design).

### Pros
- LLM-friendly filters and defaults keep payloads smaller (no buildings by default in search).
- `recordUrl` provides an immediate user-facing link.
- Advanced search mode supports multi-term AND/OR.
- Organization lookup returns the hierarchical building tree with usable facet values.
- Pruning prevents unfiltered org results from overwhelming the model.

### Cons / limitations
- Ranking differences vs API top hits (expected; may confuse comparisons).
- `list_organizations` depends on Finna UI HTML; brittle if UI structure changes.
- Unfiltered org list is still large even after pruning (many top-level items).
- No availability/holdings integration yet.
- Local dev can surface upstream 502s; now returned as MCP errors but still visible.

### Improvements implemented after first evaluation
- **list_organizations max_depth**: optional `max_depth` parameter to control hierarchy depth.
  - Example: `list_organizations(max_depth=3)` returns 3 levels and sets `meta.prunedDepth=3`.

### Re-evaluation after improvements
- `list_organizations(max_depth=3)` now returns grandchildren while still pruning deeper nodes.
  - `meta.pruned=true`, `meta.prunedDepth=3`, `meta.reason="max_depth"`.

### Further improvement ideas
- Auto-suggest `search_mode="advanced"` for multi-term free-text queries.
- Add a holdings/availability tool (Finna holdings/JSON or per-org endpoints).
- Provide an optional “compact” org list mode with top-level only + search hint.

## Suggested Next Improvements (prioritized)
1. **Auto-advanced hinting**: if `lookfor` contains multiple terms, return a `meta.warning` suggesting `search_mode="advanced"` with `advanced_operator="AND"`; do not auto-switch to preserve semantics.
2. **Compact org list mode**: return only top-level orgs with counts + a `meta.hint` to use `lookfor` or `include_paths` for deeper nodes.
3. **Field presets for get_record**: mirror `fields_preset` in `get_record` so models can request compact/media/full without remembering field names.
4. **Add org “path” only on demand**: keep default lean; ensure `include_paths` is explicit (already implemented).
5. **Holdings/availability path**: investigate non-session endpoints or per-org APIs before reintroducing a holdings tool.

## LLM UX Improvement Ideas (shortlist)
- Add `fields_preset` for `search_records` so the model can request compact/media/full record shapes without memorizing field names.
- Add `include_paths` for `list_organizations` to provide explicit org paths (e.g., “Satakirjastot / Rauma / Rauman pääkirjasto”).
- Add a `search_mode` hint in tool docs so multi-term queries use advanced mode.

## LLM UX Improvements Implemented (2026-01-06)
### Features
- `fields_preset` added to `search_records` with presets:
  - `compact`: `id`, `title`, `recordUrl`, `urls`, `onlineUrls`
  - `media`: `id`, `title`, `recordUrl`, `images`, `urls`, `onlineUrls`, `formats`, `languages`, `year`
  - `full`: adds richer metadata (subjects, genres, series, authors, publishers, summary, measurements)
- `include_paths` added to `list_organizations` to include a `path` label for each node.

### Re-evaluation (2026-01-06)
- `search_records(fields_preset="compact")` returns a minimal set (observed: `id`, `title`, `recordUrl`). Result counts match API.
- `search_records(fields_preset="media")` returns metadata needed for content/media discovery (observed: `formats`, `languages`, `year`, plus `id`, `title`, `recordUrl`).
- `list_organizations(include_paths=true)` adds path strings like:
  - `Satakirjastot / Rauma`
  - `Satakunnan ammattikorkeakoulu / Rauma`
  - `Turun yliopisto / Rauman normaalikoulun kirjasto, vain Rauman oppilaille`

## Feature: Auto-advanced Hinting (2026-01-06)
### Change
- When `lookfor` contains multiple terms and `search_mode` is not `advanced`, `search_records` returns `meta.warning` suggesting advanced mode.

### Re-evaluation
- Single-term query (`sibelius`) returns no `meta` warning.
- Multi-term query (`deep learning algorithm`) returns `meta.warning` while `resultCount` remains unaffected.

## Feature: Search Meta Guidance (2026-01-06)
### Change
- `search_records` adds `meta.info`/`meta.warning` to guide models:
  - Suggest advanced mode for multi-term queries.
  - Warn on zero results.
  - Note large result sets (suggest filters).
  - Note missing online resources in returned records.
  - Inform when `fields` overrides `fields_preset`.

### Re-evaluation
- Multi-term queries now include `meta.warning` for advanced mode.
- Large result sets include `meta.info` suggesting building/format filters.
- `fields` + `fields_preset` includes override notice.
- Resource guidance (`No online resources found…`) appears only when resource fields are included in the selected field set.

## Feature: Compact Organization Listing (2026-01-06)
### Change
- `list_organizations(compact=true)` returns only top-level orgs with `{value,label,count}` and no `children`.

### Re-evaluation
- `list_organizations(compact=true)` returns small payloads with no children and `meta.compact=true`.

## Feature: get_record Field Presets (2026-01-06)
### Change
- `get_record(fields_preset=compact|media|full)` mirrors `search_records` presets for consistent field selection.

### Re-evaluation
- `fields_preset="compact"` returns minimal fields (observed: `id`, `title`, `recordUrl`).
- `fields_preset="full"` returns richer metadata including `authors`, `buildings`, `genres`, `publishers`, etc.

## Review Feedback (2026-01-06)
### Tool Output Compatibility: `content` vs `structuredContent`
- Reviewer reports that their MCP client only reads `content` (human-readable) and ignores `structuredContent`. This caused missing IDs/records even when `fields` were requested (e.g., `search_records(fields=["id","title","authors"], limit=3)` returned only a summary string).
- Current behavior: `structuredContent` contains full JSON result; `content` is a short summary (to avoid duplication).
- Risk: clients that ignore `structuredContent` lose access to records and IDs.

### Tentative direction
- Implement a URL parameter to switch modes: `structured_output=1`.
  - Default (no param): `content` contains a JSON wrapper:
    - `{ summary, warning?, info?, response }`
    - `response` is the full tool result object; `summary` is human-readable.
  - With `structured_output=1`: `structuredContent` carries the full result; `content` is a short summary.
- This avoids doubling tokens by default while still supporting clients that only read `content`.

### Building filter reliability (`filters.include.building`)
- Reported issue: reviewer claims building filter did not narrow results (e.g., `filters.include.building=["0/SATAKIRJASTOT/"]`).
- Current implementation: `filters.include.building` is translated into `filter[]=building:"<value>"` and matches Finna’s API filter syntax.
- Likely root causes:
  - Client used building label instead of value ID (e.g., "Satakirjastot" vs `0/SATAKIRJASTOT/`), or case mismatch.
  - Client only saw summary output and assumed filters were ignored.
- Proposed next steps:
  - Add an integration test that validates a known building filter actually narrows results and that returned records include the building path.
  - Add `meta.warning` when a building filter value does not look like a Finna ID path (e.g., no `/`), reminding to use list_organizations values.
  - If false positives remain, investigate mapping labels to IDs via cached organization list (optional).
  - Normalize missing trailing slash in building filter values (e.g., `0/Helmet` -> `0/Helmet/`).

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
  - `/models` to list OpenRouter models (cached to `examples/.openrouter_models_cache.json`), `/models!` to refresh, `/model <id>` to select.
- Python TUI client (Textual, same deps):
  - `python examples/mcp_tui.py`
  - `/models` to list (cached to `examples/.openrouter_models_cache.json`), `/models!` to refresh, `/model <id>` to select.
- Python TUI client uses Textual (see `examples/requirements.txt`).
