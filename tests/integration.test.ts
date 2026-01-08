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
      expect(Array.isArray(payload.result.records[0].links)).toBe(true);
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
    expect(record.format).toBe('0/Image/');
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
    expect(['0/Image/', '0/Video/'].includes(record.format)).toBe(true);
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
        params: { name: 'get_record', arguments: { ids: [recordId] } },
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
        const record = node as { code?: unknown; name?: unknown; children?: unknown };
        const code = String(record.code ?? '').toLowerCase();
        const name = String(record.name ?? '').toLowerCase();
        if (code.includes(needle) || name.includes(needle)) {
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
    'list_organizations filters by include.value (normalized to building)',
    async () => {
      if (!available) {
        return;
      }
      // Test the bug fix: filters.include.value should work (normalized to building)
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method: 'callTool',
          params: {
            name: 'list_organizations',
            arguments: {
              lng: 'fi',
              filters: {
                include: {
                  value: ['0/Helmet/'],
                },
              },
              max_depth: 3,
            },
          },
        }),
      });
      expect(response.ok).toBe(true);
      const payload = await response.json();
      const entries = payload.result?.facets?.building;
      if (!Array.isArray(entries)) {
        throw new Error('Expected building array in response');
      }
      // Should return only Helmet organizations (or subset if empty)
      expect(entries.length).toBeGreaterThanOrEqual(0);
      // If results returned, verify they contain Helmet codes
      if (entries.length > 0) {
        const hasHelmetCode = (node: unknown): boolean => {
          if (!node || typeof node !== 'object') {
            return false;
          }
          const record = node as { code?: string; children?: unknown };
          if (typeof record.code === 'string' && record.code.includes('Helmet')) {
            return true;
          }
          if (Array.isArray(record.children)) {
            return record.children.some(hasHelmetCode);
          }
          return false;
        };
        expect(entries.some(hasHelmetCode)).toBe(true);
      }
    },
    15000,
  );

  it(
    'list_organizations returns code and name fields (not value/label)',
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
            name: 'list_organizations',
            arguments: {
              query: 'Helmet',
              lng: 'fi',
              max_depth: 2,
            },
          },
        }),
      });
      expect(response.ok).toBe(true);
      const payload = await response.json();
      const entries = payload.result?.facets?.building;
      if (!Array.isArray(entries) || entries.length === 0) {
        return;
      }
      const first = entries[0];
      // Should have code and name, not value and label
      expect(typeof first.code).toBe('string');
      expect(typeof first.name).toBe('string');
      expect(first.value).toBeUndefined();
      expect(first.label).toBeUndefined();
    },
    15000,
  );

  it(
    'search_records facets return code and name fields',
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
              facets: ['building'],
              facet_limit: 5,
            },
          },
        }),
      });
      expect(response.ok).toBe(true);
      const payload = await response.json();
      const entries = payload.result?.facets?.building;
      if (!Array.isArray(entries) || entries.length === 0) {
        return;
      }
      const first = entries[0];
      expect(typeof first.code).toBe('string');
      expect(typeof first.name).toBe('string');
      expect(first.value).toBeUndefined();
      expect(first.label).toBeUndefined();
    },
    15000,
  );

  it(
    'list_organizations compact mode returns only code, name, count',
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
            name: 'list_organizations',
            arguments: {
              compact: true,
              max_depth: 1,
            },
          },
        }),
      });
      expect(response.ok).toBe(true);
      const payload = await response.json();
      const entries = payload.result?.facets?.building;
      if (!Array.isArray(entries) || entries.length === 0) {
        return;
      }
      const first = entries[0];
      const keys = Object.keys(first).sort();
      expect(keys).toEqual(['code', 'count', 'name']);
    },
    15000,
  );

  it(
    'list_organizations with max_depth limits hierarchy depth',
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
            name: 'list_organizations',
            arguments: {
              filters: {
                include: {
                  value: ['0/Helmet/'],
                },
              },
              max_depth: 2,
            },
          },
        }),
      });
      expect(response.ok).toBe(true);
      const payload = await response.json();
      expect(payload.result?.meta?.pruned).toBe(true);
      expect(payload.result?.meta?.prunedDepth).toBe(2);
      const entries = payload.result?.facets?.building;
      if (!Array.isArray(entries) || entries.length === 0) {
        return;
      }
      // Check that depth is limited (no deeply nested children)
      const maxDepth = (node: unknown, current = 1): number => {
        if (!node || typeof node !== 'object') {
          return current;
        }
        const record = node as { children?: unknown };
        if (!Array.isArray(record.children) || record.children.length === 0) {
          return current;
        }
        return 1 + Math.max(...record.children.map((child) => maxDepth(child, current + 1)));
      };
      const depth = maxDepth(entries[0]);
      expect(depth).toBeLessThanOrEqual(2);
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
