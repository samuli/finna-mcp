# Implementation Plan: API Simplification

## Progress

**Status**: ✅ **COMPLETED** (2024-01-07)

**Completed**:
- ✅ Phase 1: Fixed critical bug (resource field check)
- ✅ Phase 2: Removed label resolution code (~350 lines)
- ✅ Phase 3: Updated documentation (tool schemas, help text)
- ✅ Phase 5: Updated tests
- ✅ All manual & automated testing passed

**Remaining**:
- ⏳ Phase 4: Update PRD documentation
- ⏳ Phase 6: Update examples (low priority)

**Commit**: `b9991ac` - "Simplify API: Remove label resolution and web scraping"

---

## Overview
Simplify the MCP server by removing hierarchical format code support and organization label resolution. Focus on top-level codes that are discoverable via facets.

## Motivation
1. **Discoverability**: LLMs cannot discover hierarchical codes like `1/Book/eBook/` through the API
2. **Complexity**: Current label resolution requires web scraping and caching
3. **Documentation mismatch**: Examples show `0/Book/eBook/` which doesn't work (should be `1/Book/eBook/`)
4. **Brittleness**: Web scraping for labels is fragile if Finna UI changes
5. **Bug**: Resource detection checks wrong field names after refactoring

## Decision: Support Top-Level Codes Only

### What Works Now
- ✅ Top-level codes: `0/Book/`, `0/Image/`, `0/Video/`
- ✅ Discoverable via: `facets=["format"]` or `facets=["building"]`
- ✅ Organization values: `0/Helmet/`, `0/AALTO/`, `0/HKM/`

### What To Remove
- ❌ Hierarchical format codes: `1/Book/eBook/`, `2/...`
- ❌ Organization label resolution: "Aalto-yliopisto" → "0/AALTO/"
- ❌ Web scraping logic for organization labels
- ❌ Caching logic for scraped labels

---

## Implementation Tasks

### Phase 1: Fix Critical Bug
**Priority**: HIGH
**Files**: `src/index.ts`

#### Task 1.1: Fix "No online resources" message
**Location**: `src/index.ts:2353-2365`

**Problem**: Checks for `['images', 'urls', 'onlineUrls']` but default fields use `'links'`

**Fix**:
```typescript
// Line 2353 - Add 'links' to resource fields
const resourceFields = new Set(['images', 'urls', 'onlineUrls', 'links']);

// OR better - update hasResourceData check:
const hasResourceData = records.some((record) => {
  const images = record.images;
  const urls = record.urls;
  const onlineUrls = record.onlineUrls;
  const links = record.links; // Add this
  return (
    (Array.isArray(images) && images.length > 0) ||
    (Array.isArray(urls) && urls.length > 0) ||
    (Array.isArray(onlineUrls) && onlineUrls.length > 0) ||
    (Array.isArray(links) && links.length > 0) // Add this
  );
});
```

**Test**:
```bash
curl -X POST http://localhost:8787/mcp -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_records","arguments":{"available_online":true,"format":"0/Image/","limit":3}}}'
# Should NOT show "No online resources found" when records have links
```

---

### Phase 2: Remove Label Resolution
**Priority**: HIGH
**Impact**: Simplifies codebase significantly

#### Task 2.1: Identify code to remove
**Search for**:
```bash
grep -n "fetchUiOrganizations\|normalizeBuildingFilters\|scraping\|label.*resolution" src/index.ts
```

**Functions to remove**:
- `fetchUiOrganizations()` - Web scraping logic
- `normalizeBuildingFiltersWithCache()` - Label resolution with caching
- `writeOrganizationsCache()` - Cache write operations for labels
- `readOrganizationsCache()` - Cache read operations
- Related helper functions for HTML parsing

**Estimate**: ~200-300 lines of code removal

#### Task 2.2: Update filter normalization
**Location**: `src/index.ts` (search for `normalizeBuildingFilters`)

**Change from**:
```typescript
const normalizedBuilding = await normalizeBuildingFiltersWithCache(
  normalizedFilters,
  env,
  lng,
);
normalizedFilters = normalizedBuilding.filters;
```

**Change to**:
```typescript
// No normalization needed - use values as-is
// Building filters must use exact VALUE strings like "0/Helmet/"
```

#### Task 2.3: Update validation
**Keep warning for invalid formats**:
```typescript
const buildingWarnings = collectHierarchicalFilterWarnings(normalizedFilters);
```

**Update warning message** to be clearer:
```typescript
// When organization filter returns 0 results, suggest:
"No results. Organization filters must use exact VALUE codes like \"0/Helmet/\". Use list_organizations to discover valid codes."
```

---

### Phase 3: Update Documentation
**Priority**: HIGH
**Files**: `src/index.ts` (tool schemas and help text)

#### Task 3.1: Fix tool schema - format parameter
**Location**: `src/index.ts:162-167`

**Change from**:
```typescript
format: {
  type: ['string', 'array'],
  items: { type: 'string' },
  description:
    'Content types (format IDs). Use a string for one format, or an array for OR selection. Examples: "0/Book/", "0/Book/eBook/", ["0/Image/","0/Video/"]',
},
```

**Change to**:
```typescript
format: {
  type: ['string', 'array'],
  items: { type: 'string' },
  description:
    'Content types (top-level format codes). Use a string for one format, or an array for OR selection. Examples: "0/Book/", "0/Image/", ["0/Image/","0/Video/"]. Discover codes via facets=["format"].',
},
```

#### Task 3.2: Fix tool schema - organization parameter
**Location**: `src/index.ts:168-173`

**Change from**:
```typescript
organization: {
  type: ['string', 'array'],
  items: { type: 'string' },
  description:
    'Organization IDs (Use list_organizations to discover IDs. Labels/names may be resolved to IDs, but ambiguous matches will warn).'
},
```

**Change to**:
```typescript
organization: {
  type: ['string', 'array'],
  items: { type: 'string' },
  description:
    'Organization IDs (Use list_organizations to discover. Always use exact VALUE strings like "0/Helmet/", NOT labels like "Helsinki Libraries").'
},
```

#### Task 3.3: Fix tool schema - filters parameter
**Location**: `src/index.ts:186-190`

**Change from**:
```typescript
filters: {
  type: 'object',
  description:
    'Structured filters: {include:{field:[values]}, any:{field:[values]}, exclude:{field:[values]}}. For organizations, use list_organizations value strings in include.organization (labels may be resolved but should not be relied on). Example for books: include.format=["0/Book/"]. Use exclude.format=[...] to drop formats. Note that filter values are case sensitive need to match exactly to those used by Finna.',
},
```

**Change to**:
```typescript
filters: {
  type: 'object',
  description:
    'Structured filters: {include:{field:[values]}, any:{field:[values]}, exclude:{field:[values]}}. Use exact VALUE codes from list_organizations or facets. Example: include.format=["0/Book/"], include.building=["0/Helmet/"]. Filter values are case-sensitive and must match exactly.',
},
```

#### Task 3.4: Update help text - format examples
**Location**: `src/index.ts:1519-1525`

**Change from**:
```typescript
- \`0/Book/\` — Books (all)
- \`0/Book/eBook/\` — E-books
- \`0/Book/BookSection/\` — Book sections / chapters
- \`0/Sound/\` — Sound recordings / audiobooks
```

**Change to**:
```typescript
- \`0/Book/\` — Books
- \`0/Sound/\` — Sound recordings / audiobooks
- \`0/Image/\` — Images / photographs
- \`0/Video/\` — Video / film

**Note**: Only top-level format codes (0/...) are supported. Use facets to discover all available codes dynamically:
\`\`\`json
{"facets": ["format"], "limit": 0}
\`\`\`
```

#### Task 3.5: Update help text - add discovery section
**Location**: After format examples section

**Add**:
```markdown
## Discovering Valid Codes

### Format Codes
Use facets to discover all available format codes:
\`\`\`json
{
  "facets": ["format"],
  "facet_limit": 50,
  "limit": 0
}
\`\`\`
Returns all top-level format codes with counts.

### Organization Codes
Use list_organizations to discover organization codes:
\`\`\`json
{
  "compact": true
}
\`\`\`
Returns all top-level organizations with VALUE codes like "0/Helmet/".

**Important**: Always use the exact VALUE string returned, not the human-readable label.
```

#### Task 3.6: Update help text - troubleshooting section
**Location**: `src/index.ts` (search for "Troubleshooting")

**Change from**:
```markdown
**No results with organization filter?**
→ Prefer the VALUE code (0/HKM/). Labels may be resolved, but ambiguous matches will warn.
```

**Change to**:
```markdown
**No results with organization filter?**
→ Use exact VALUE codes like "0/HKM/" from list_organizations, NOT labels like "Helsinki City Museum"
→ Use facets=["building"] to verify valid building codes

**No results with format filter?**
→ Use exact top-level codes like "0/Book/", NOT hierarchical codes like "0/Book/eBook/"
→ Use facets=["format"] to discover all valid format codes
```

---

### Phase 4: Update PRD Documentation
**Priority**: MEDIUM
**File**: `docs/PRD.md`

#### Task 4.1: Update format codes section
**Location**: Lines 72-84

**Change from**:
```markdown
### Common format codes (working list)
Use these in `filters.include.format` when narrowing by type:
- Book: `0/Book/`
- Article: `0/Article/`
...
```

**Change to**:
```markdown
### Common format codes
Top-level codes only (discover via facets=["format"]):
- Book: `0/Book/`
- Article: `0/Article/`
...

**Note**: Hierarchical codes like `1/Book/eBook/` are not supported. Use top-level codes + keyword search for specificity.
```

#### Task 4.2: Add note about simplification
**Location**: Near top of PRD

**Add**:
```markdown
## Design Decisions

### Top-Level Codes Only
- **Decision**: Only support top-level format codes (0/...) and organization codes (0/...)
- **Rationale**: Hierarchical codes are not discoverable via API facets. Top-level codes can be discovered dynamically by LLMs.
- **Trade-off**: Less granular filtering, but better discoverability and reliability.
```

---

### Phase 5: Clean Up Tests
**Priority**: MEDIUM
**Files**: Test files

#### Task 5.1: Remove label resolution tests
**Search for**:
```bash
grep -r "label.*resolv\|Aalto-yliopisto\|Helsinki.*Librar" tests/
```

Remove any tests that verify label-to-value resolution.

#### Task 5.2: Add tests for value-only filtering
**Add tests**:
```typescript
// Test that value codes work
test('organization filter with value code', async () => {
  const result = await search({ organization: '0/AALTO/' });
  expect(result.resultCount).toBeGreaterThan(0);
});

// Test that labels don't work (and give clear error)
test('organization filter with label fails', async () => {
  const result = await search({ organization: 'Aalto-yliopisto' });
  expect(result.resultCount).toBe(0);
  expect(result.meta.warning).toContain('exact VALUE');
});

// Test top-level format codes
test('format filter with top-level code', async () => {
  const result = await search({ format: '0/Book/' });
  expect(result.resultCount).toBeGreaterThan(0);
});

// Test that hierarchical format codes don't work
test('hierarchical format code fails', async () => {
  const result = await search({ format: '0/Book/eBook/' });
  expect(result.resultCount).toBe(0);
});
```

#### Task 5.3: Update integration tests
Ensure tests use correct VALUE codes, not labels.

---

### Phase 6: Update Examples
**Priority**: LOW
**Files**: `examples/*.py`, README examples

#### Task 6.1: Review example queries
Update any examples that use:
- Labels instead of values
- Hierarchical format codes

#### Task 6.2: Add discovery examples
Show how to:
1. Discover format codes via facets
2. Discover organization codes via list_organizations
3. Use discovered codes in filters

---

## Testing Checklist

### Manual Testing
- [x] Search with `format="0/Book/"` returns results
- [x] Search with `format="0/Book/eBook/"` returns 0 results (expected)
- [x] Search with `organization="0/Helmet/"` returns results
- [x] Search with `organization="Helsinki Libraries"` returns 0 results (expected)
- [x] Facets request `facets=["format"]` returns all top-level codes
- [x] list_organizations returns VALUE codes
- [x] Records with links don't show "No online resources" warning

### Automated Testing
- [x] Update test suite with new expectations
- [x] Remove label resolution tests
- [x] Add value-only filtering tests
- [x] Verify error messages guide users to correct usage

### Integration Testing
- [ ] Test with actual LLM (Claude/GPT) to verify:
  - Can discover format codes via facets
  - Can discover organization codes via list_organizations
  - Gets clear errors when using wrong format

---

## Rollout Plan

### Step 1: Bug Fix (Immediate)
- Fix "No online resources" message bug
- Deploy to production
- No breaking changes

### Step 2: Documentation Update (Week 1)
- Update all tool schemas
- Update help text
- Update PRD
- Deploy to production
- **Breaking**: Users relying on hierarchical codes will see 0 results (but get clear errors)

### Step 3: Code Removal (Week 2)
- Remove label resolution logic
- Remove web scraping code
- Remove caching for labels
- Update tests
- Deploy to production
- **Breaking**: Organization labels no longer work (even partially)

### Step 4: Examples & Polish (Week 3)
- Update examples
- Add discovery documentation
- Monitor user feedback
- Iterate on error messages

---

## Migration Guide for Users

### If you were using hierarchical format codes:

**Before** (doesn't work):
```json
{"format": "0/Book/eBook/"}
```

**After** (use top-level + keyword):
```json
{"format": "0/Book/", "query": "ebook"}
```

Or discover via facets:
```json
{"format": "0/Book/", "facets": ["format"], "limit": 10}
```

### If you were using organization labels:

**Before** (doesn't work):
```json
{"organization": "Aalto-yliopisto"}
```

**After** (use exact VALUE):
```json
{"organization": "0/AALTO/"}
```

Discover via:
```json
// Find Aalto
list_organizations({"query": "Aalto", "compact": true})
// Use the returned VALUE: "0/AALTO/"
```

---

## Benefits After Simplification

1. **Smaller codebase**: ~200-300 lines removed
2. **No web scraping dependencies**: More reliable
3. **Better discoverability**: LLMs can find valid codes via facets
4. **Clearer errors**: Users know exactly what to use
5. **Less maintenance**: No caching logic to debug
6. **Documented reality**: Docs match implementation

---

## Risks & Mitigations

### Risk 1: Users rely on hierarchical codes
**Mitigation**:
- Clear error messages pointing to discovery methods
- Update documentation with examples
- Provide migration guide

### Risk 2: Label resolution was useful for UX
**Mitigation**:
- list_organizations is still easy to use
- Compact mode shows labels alongside values
- Trade-off: Slight UX decrease for major reliability increase

### Risk 3: Less granular filtering
**Mitigation**:
- Combine top-level codes with keyword search
- Use facets to explore results
- Most use cases don't need sub-type precision

---

## Success Metrics

- [ ] Zero "No online resources" false positives
- [ ] Users successfully discover codes via facets
- [ ] Fewer support questions about "why doesn't this work"
- [ ] No web scraping failures
- [ ] Faster response times (less processing)

---

## Timeline Estimate

- **Phase 1** (Bug fix): 1 hour
- **Phase 2** (Remove label resolution): 3-4 hours
- **Phase 3** (Update documentation): 2-3 hours
- **Phase 4** (Update PRD): 1 hour
- **Phase 5** (Update tests): 2-3 hours
- **Phase 6** (Update examples): 1 hour

**Total**: ~10-14 hours

---

## Questions to Resolve

1. Should we keep any label resolution for organization names, or remove entirely?
   - **Recommendation**: Remove entirely for simplicity

2. Should we support hierarchical codes at all, even with correct numbering?
   - **Recommendation**: No - not discoverable via API

3. Should error messages suggest specific codes, or just point to discovery?
   - **Recommendation**: Point to discovery methods (facets, list_organizations)

4. Should we version the API to avoid breaking changes?
   - **Recommendation**: Not needed - changes are clarifications, not breaking behavior
