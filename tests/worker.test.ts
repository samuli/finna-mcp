import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker from '../src/index.js';

describe('worker', () => {
  const baseEnv = {} as Parameters<typeof worker.fetch>[1];

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it('rejects non-POST', async () => {
    const request = new Request('http://example.com/mcp', { method: 'GET' });
    const response = await worker.fetch(request, baseEnv);
    expect(response.status).toBe(405);
  });

  it('lists tools', async () => {
    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'listTools' }),
    });

    const response = await worker.fetch(request, baseEnv);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.tools?.length).toBeGreaterThan(0);
  });

  it('search_records builds filters and enriches resources', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          resultCount: 1,
          records: [
            {
              id: 'test.1',
              images: ['/Cover/Show?id=1'],
              onlineUrls: [{ url: 'https://example.com/file.pdf', label: 'PDF' }],
              urls: [{ url: 'https://example.com/page', label: 'Page' }],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: {
          name: 'search_records',
          arguments: {
            lookfor: 'sibelius',
            sort: 'newest_first',
            filters: {
              include: { building: ['1/KANSA/'] },
              any: { format: ['0/Image/', '1/Image/Photo/'] },
              exclude: { building: ['1/TEST/'] },
            },
          },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    expect(payload.result.records[0].resourceCounts).toEqual({
      image: 1,
      pdf: 1,
      external: 1,
    });
    expect(payload.result.records[0].resourceSamples.image[0].url).toBe(
      'https://api.finna.fi/Cover/Show?id=1',
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('lookfor=sibelius');
    expect(calledUrl).toContain('sort=first_indexed+desc');
    expect(calledUrl).toContain('filter%5B%5D=building%3A%221%2FKANSA%2F%22');
    expect(calledUrl).toContain('filter%5B%5D=%7Eformat%3A%220%2FImage%2F%22');
    expect(calledUrl).toContain('filter%5B%5D=%7Eformat%3A%221%2FImage%2FPhoto%2F%22');
    expect(calledUrl).toContain('filter%5B%5D=-building%3A%221%2FTEST%2F%22');
    expect(payload.result.facets).toBeUndefined();
  });

  it('search_records normalizes shorthand filters and book format', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ resultCount: 0, records: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: {
          name: 'search_records',
          arguments: {
            lookfor: '*',
            filters: { building: '0/URHEILUMUSEO/', format: 'Book' },
            limit: 0,
          },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    expect(response.status).toBe(200);
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('filter%5B%5D=building%3A%220%2FURHEILUMUSEO%2F%22');
    expect(calledUrl).toContain('filter%5B%5D=format%3A%220%2FBook%2F%22');
  });

  it('search_records keeps facets when requested', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          resultCount: 0,
          records: [],
          facets: { format: [{ value: '0/Book/', count: 1 }] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: {
          name: 'search_records',
          arguments: { lookfor: '*', facets: ['format'] },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    expect(payload.result.facets).toBeDefined();
  });

  it('list_organizations uses building facet', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            facets: {
              building: {
                html: `
                  <ul class="facet-tree">
                    <li>
                      <span class="facet js-facet-item facetOR">
                        <a class="main-link icon-link" href="?filter%5B%5D=%7Ebuilding%3A%221%2FKANSA%2F%22" data-title="KANSA" data-count="3">
                          <span class="facet-value icon-link__label">KANSA</span>
                        </a>
                      </span>
                    </li>
                  </ul>
                `,
              },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: {
          name: 'list_organizations',
          arguments: { lookfor: '', filters: { building: ['1/KANSA/'] } },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    expect(payload.result.facets.building.length).toBe(1);
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('/AJAX/JSON');
    expect(calledUrl).toContain('method=getSideFacets');
    expect(calledUrl).toContain('enabledFacets%5B%5D=building');
    // list_organizations always fetches the full facet list and filters locally.
  });

  it('get_record supports multiple ids and resource samples', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          records: [
            {
              id: 'a.1',
              images: ['/Cover/Show?id=1'],
              onlineUrls: [],
              urls: [{ url: 'https://example.com/file.mp3' }],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: {
          name: 'get_record',
          arguments: { ids: ['a.1'], includeRawData: true },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    expect(payload.result.records[0].resourceCounts.audio).toBe(1);
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('id%5B%5D=a.1');
    expect(calledUrl).toContain('field%5B%5D=rawData');
  });

  it('get_record supports field presets', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          records: [
            {
              id: 'a.1',
              urls: [{ url: 'https://example.com' }],
              onlineUrls: [],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: {
          name: 'get_record',
          arguments: { ids: ['a.1'], fields_preset: 'compact' },
        },
      }),
    });

    await worker.fetch(request, baseEnv);
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('field%5B%5D=recordUrl');
    expect(calledUrl).not.toContain('field%5B%5D=buildings');
  });

  it('extract_resources returns samples per record', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          records: [
            {
              id: 'x.1',
              images: ['/Cover/Show?id=2'],
              onlineUrls: [{ url: 'https://example.com/video.mp4' }],
              urls: [],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: { name: 'extract_resources', arguments: { ids: ['x.1'], sampleLimit: 3 } },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    expect(payload.result.resources[0].resources.length).toBe(2);
  });

  it('list_organizations parses hierarchy from UI HTML', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    const fixture = JSON.stringify({
      data: {
        facets: {
          building: {
            html: `
              <ul class="facet-tree">
                <li class="facet-tree__parent">
                  <span class="facet-tree__item-container">
                    <span class="facet js-facet-item facetOR">
                      <a class="main-link icon-link" href="?filter%5B%5D=%7Ebuilding%3A%220%2FEepos%2F%22" data-title="Eepos-kirjastot" data-count="360571">
                        <span class="facet-value icon-link__label">Eepos-kirjastot</span>
                      </a>
                    </span>
                  </span>
                  <ul>
                    <li class="facet-tree__parent">
                      <span class="facet-tree__item-container">
                        <span class="facet js-facet-item facetOR">
                          <a class="main-link icon-link" href="?filter%5B%5D=%7Ebuilding%3A%221%2FEepos%2F19%2F%22" data-title="Seinäjoki" data-count="2947">
                            <span class="facet-value icon-link__label">Seinäjoki</span>
                          </a>
                        </span>
                      </span>
                    </li>
                  </ul>
                </li>
              </ul>
            `,
          },
        },
      },
    });
    mockFetch.mockResolvedValueOnce(
      new Response(fixture, { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: { name: 'list_organizations', arguments: { lookfor: 'Seinäjoki' } },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    if (!payload.result) {
      throw new Error(`Missing result in payload: ${JSON.stringify(payload)}`);
    }
    const tree = payload.result.facets?.building;
    expect(Array.isArray(tree)).toBe(true);

    const hasLabel = (nodes: unknown[], label: string): boolean => {
      for (const node of nodes) {
        if (!node || typeof node !== 'object') {
          continue;
        }
        const record = node as Record<string, unknown>;
        if (String(record.label) === label) {
          return true;
        }
        if (Array.isArray(record.children) && hasLabel(record.children, label)) {
          return true;
        }
      }
      return false;
    };

    expect(hasLabel(tree, 'Eepos-kirjastot')).toBe(true);
    expect(hasLabel(tree, 'Seinäjoki')).toBe(true);
  });

  it('list_organizations can include path labels', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    const fixture = JSON.stringify({
      data: {
        facets: {
          building: {
            html: `
              <ul class="facet-tree">
                <li class="facet-tree__parent">
                  <span class="facet-tree__item-container">
                    <span class="facet js-facet-item facetOR">
                      <a class="main-link icon-link" href="?filter%5B%5D=%7Ebuilding%3A%220%2FEepos%2F%22" data-title="Eepos-kirjastot" data-count="360571">
                        <span class="facet-value icon-link__label">Eepos-kirjastot</span>
                      </a>
                    </span>
                  </span>
                  <ul>
                    <li class="facet-tree__parent">
                      <span class="facet-tree__item-container">
                        <span class="facet js-facet-item facetOR">
                          <a class="main-link icon-link" href="?filter%5B%5D=%7Ebuilding%3A%221%2FEepos%2F19%2F%22" data-title="Seinäjoki" data-count="2947">
                            <span class="facet-value icon-link__label">Seinäjoki</span>
                          </a>
                        </span>
                      </span>
                    </li>
                  </ul>
                </li>
              </ul>
            `,
          },
        },
      },
    });
    mockFetch.mockResolvedValueOnce(
      new Response(fixture, { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: {
          name: 'list_organizations',
          arguments: { lookfor: 'Seinäjoki', include_paths: true },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    const tree = payload.result.facets?.building ?? [];
    const hasPath = (nodes: unknown[]): boolean => {
      for (const node of nodes) {
        if (!node || typeof node !== 'object') {
          continue;
        }
        const record = node as Record<string, unknown>;
        const path = record.path;
        if (typeof path === 'string' && path.includes('Eepos-kirjastot')) {
          return true;
        }
        if (Array.isArray(record.children) && hasPath(record.children)) {
          return true;
        }
      }
      return false;
    };
    expect(hasPath(tree)).toBe(true);
  });

  it('list_organizations can return compact results', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    const fixture = JSON.stringify({
      data: {
        facets: {
          building: {
            html: `
              <ul class="facet-tree">
                <li class="facet-tree__parent">
                  <span class="facet-tree__item-container">
                    <span class="facet js-facet-item facetOR">
                      <a class="main-link icon-link" href="?filter%5B%5D=%7Ebuilding%3A%220%2FEepos%2F%22" data-title="Eepos-kirjastot" data-count="360571">
                        <span class="facet-value icon-link__label">Eepos-kirjastot</span>
                      </a>
                    </span>
                  </span>
                  <ul>
                    <li class="facet-tree__parent">
                      <span class="facet-tree__item-container">
                        <span class="facet js-facet-item facetOR">
                          <a class="main-link icon-link" href="?filter%5B%5D=%7Ebuilding%3A%221%2FEepos%2F19%2F%22" data-title="Seinäjoki" data-count="2947">
                            <span class="facet-value icon-link__label">Seinäjoki</span>
                          </a>
                        </span>
                      </span>
                    </li>
                  </ul>
                </li>
              </ul>
            `,
          },
        },
      },
    });
    mockFetch.mockResolvedValueOnce(
      new Response(fixture, { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: {
          name: 'list_organizations',
          arguments: { lookfor: 'Eepos', compact: true },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    const building = payload.result.facets.building[0];
    expect(building.children).toBeUndefined();
    expect(Object.keys(building).sort()).toEqual(['count', 'label', 'value']);
    expect(payload.result.meta.compact).toBe(true);
  });

  it('opens SSE endpoint stream', async () => {
    const request = new Request('http://example.com/mcp', {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
    });

    const response = await worker.fetch(request, baseEnv);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    expect(text).toContain('event: endpoint');
    await reader.cancel();
  });

  it('routes JSON-RPC over SSE session', async () => {
    const sseRequest = new Request('http://example.com/mcp', {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
    });

    const sseResponse = await worker.fetch(sseRequest, baseEnv);
    const reader = sseResponse.body?.getReader();
    if (!reader) {
      throw new Error('Missing SSE reader');
    }
    const first = await reader.read();
    const text = new TextDecoder().decode(first.value);
    const endpointLine = text
      .split('\n')
      .find((line) => line.startsWith('data: '))
      ?.slice(6);
    if (!endpointLine) {
      throw new Error('Missing endpoint data');
    }

    const postRequest = new Request(endpointLine, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });

    const postResponse = await worker.fetch(postRequest, baseEnv);
    expect(postResponse.status).toBe(202);

    const second = await reader.read();
    const messageText = new TextDecoder().decode(second.value);
    expect(messageText).toContain('event: message');
    expect(messageText).toContain('"jsonrpc":"2.0"');
    await reader.cancel();
  });

});
