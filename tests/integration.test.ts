import { describe, it, expect, beforeAll } from 'vitest';

const baseUrl = process.env.FINNA_MCP_BASE_URL ?? 'http://127.0.0.1:8787/mcp';
const shouldRun = process.env.RUN_INTEGRATION === '1';

const suite = shouldRun ? describe : describe.skip;

suite('integration (local wrangler)', () => {
  let available = false;

  beforeAll(async () => {
    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'listTools' }),
      });
      available = response.ok;
    } catch {
      available = false;
    }
  });

  it('listTools responds', async () => {
    if (!available) {
      return;
    }
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'listTools' }),
    });
    expect(response.ok).toBe(true);
    const payload = await response.json();
    expect(Array.isArray(payload.tools)).toBe(true);
  });

  it('search_records returns records and resource summaries', async () => {
    if (!available) {
      return;
    }
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: {
          name: 'search_records',
          arguments: {
            query: 'sibelius',
            filters: {
              any: { format: ['0/Image/', '1/Image/Photo/'] },
            },
            limit: 5,
          },
        },
      }),
    });
    expect(response.ok).toBe(true);
    const payload = await response.json();
    expect(Array.isArray(payload.result.records)).toBe(true);
    if (payload.result.records.length > 0) {
      expect(payload.result.records[0].resourceCounts).toBeTruthy();
      expect(payload.result.records[0].resourceSamples).toBeTruthy();
    }
  });

  it('get_record and extract_resources work for a returned id', async () => {
    if (!available) {
      return;
    }
    const searchResponse = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: { name: 'search_records', arguments: { query: 'kansalliskirjasto', limit: 1 } },
      }),
    });
    expect(searchResponse.ok).toBe(true);
    const searchPayload = await searchResponse.json();
    const recordId = searchPayload.result.records?.[0]?.id as string | undefined;
    if (!recordId) {
      return;
    }

    const recordResponse = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: { name: 'get_record', arguments: { ids: [recordId] } },
      }),
    });
    expect(recordResponse.ok).toBe(true);
    const recordPayload = await recordResponse.json();
    expect(recordPayload.result.records?.[0]?.id).toBe(recordId);

    const resourcesResponse = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: { name: 'extract_resources', arguments: { ids: [recordId], sampleLimit: 3 } },
      }),
    });
    expect(resourcesResponse.ok).toBe(true);
    const resourcesPayload = await resourcesResponse.json();
    expect(resourcesPayload.result.resources?.[0]?.id).toBe(recordId);
  });

  it(
    'list_organizations returns building facet',
    async () => {
      if (!available) {
        return;
      }
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method: 'callTool',
          params: { name: 'list_organizations', arguments: { query: 'sibelius' } },
        }),
      });
      expect(response.ok).toBe(true);
      const payload = await response.json();
      expect(payload.result.facets).toBeTruthy();
    },
    15000,
  );

  it(
    'list_organizations filters by query',
    async () => {
      if (!available) {
        return;
      }
      const query = 'Seinäjoki';
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method: 'callTool',
          params: { name: 'list_organizations', arguments: { query, lng: 'fi' } },
        }),
      });
      expect(response.ok).toBe(true);
      const payload = await response.json();
      const entries = payload.result?.facets?.building;
      if (!Array.isArray(entries) || entries.length === 0) {
        return;
      }
      const needle = query.toLowerCase();
      for (const entry of entries) {
        const value = String(entry?.value ?? '').toLowerCase();
        const translated = String(entry?.translated ?? '').toLowerCase();
        expect(value.includes(needle) || translated.includes(needle)).toBe(true);
      }
    },
    15000,
  );

  it(
    'search_records building filter narrows results',
    async () => {
      if (!available) {
        return;
      }
      const basePayload = {
        method: 'callTool',
        params: {
          name: 'search_records',
          arguments: {
            query: '',
            limit: 0,
            filters: {
              include: { format: ['0/Book/'] },
            },
          },
        },
      };
      const filteredPayload = {
        method: 'callTool',
        params: {
          name: 'search_records',
          arguments: {
            query: '',
            limit: 0,
            filters: {
              include: { format: ['0/Book/'], organization: ['0/Helmet'] },
            },
          },
        },
      };

      const baseResponse = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(basePayload),
      });
      expect(baseResponse.ok).toBe(true);
      const baseData = await baseResponse.json();
      const baseCount = Number(baseData.result?.resultCount ?? 0);
      if (!Number.isFinite(baseCount) || baseCount === 0) {
        return;
      }

      const filteredResponse = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(filteredPayload),
      });
      expect(filteredResponse.ok).toBe(true);
      const filteredData = await filteredResponse.json();
      const filteredCount = Number(filteredData.result?.resultCount ?? 0);
      if (!Number.isFinite(filteredCount)) {
        return;
      }
      expect(filteredCount).toBeGreaterThan(0);
      expect(filteredCount).toBeLessThan(baseCount);
    },
    15000,
  );
});
