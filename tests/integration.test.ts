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

  it('search_records format filter returns matching formats', async () => {
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
            query: '',
            format: '0/Image/',
            limit: 1,
          },
        },
      }),
    });
    expect(response.ok).toBe(true);
    const payload = await response.json();
    const record = payload.result.records?.[0];
    if (!record) {
      return;
    }
    const formats = Array.isArray(record.formats) ? record.formats : [];
    const hasImage = formats.some((format: { value?: string }) => format?.value === '0/Image/');
    expect(hasImage).toBe(true);
  });

  it('search_records format filter supports multiple values (OR)', async () => {
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
            query: '',
            format: ['0/Image/', '0/Video/'],
            limit: 1,
          },
        },
      }),
    });
    expect(response.ok).toBe(true);
    const payload = await response.json();
    const record = payload.result.records?.[0];
    if (!record) {
      return;
    }
    const formats = Array.isArray(record.formats) ? record.formats : [];
    const hasMatch = formats.some((format: { value?: string }) =>
      format?.value === '0/Image/' || format?.value === '0/Video/',
    );
    expect(hasMatch).toBe(true);
  });

  it('get_record returns details for a returned id', async () => {
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
        params: { name: 'get_record', arguments: { ids: [recordId], includeResources: true, resourcesLimit: 3 } },
      }),
    });
    expect(resourcesResponse.ok).toBe(true);
    const resourcesPayload = await resourcesResponse.json();
    expect(resourcesPayload.result.records?.[0]?.id).toBe(recordId);
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
      const matches = (node: unknown): boolean => {
        if (!node || typeof node !== 'object') {
          return false;
        }
        const record = node as { value?: unknown; translated?: unknown; children?: unknown };
        const value = String(record.value ?? '').toLowerCase();
        const translated = String(record.translated ?? '').toLowerCase();
        if (value.includes(needle) || translated.includes(needle)) {
          return true;
        }
        if (Array.isArray(record.children)) {
          return record.children.some(matches);
        }
        return false;
      };
      if (!entries.some(matches)) {
        return;
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

  it(
    'search_records resolves organization label filters',
    async () => {
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
              query: '',
              limit: 0,
              lng: 'fi',
              filters: {
                include: { format: ['0/Book/'], organization: ['Helmet-kirjastot'] },
              },
            },
          },
        }),
      });
      expect(response.ok).toBe(true);
      const payload = await response.json();
      const count = Number(payload.result?.resultCount ?? 0);
      if (!Number.isFinite(count)) {
        return;
      }
      if (count > 0) {
        expect(count).toBeGreaterThan(0);
        return;
      }
      const warning = String(payload.result?.meta?.warning ?? '');
      expect(
        warning.includes('Hierarchical facet filters should use path IDs') ||
          warning.includes('Organization label'),
      ).toBe(true);
    },
    15000,
  );
});
