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

  it('wraps tool results in content by default', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          resultCount: 1,
          records: [{ id: 'test.1', title: 'Example' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'search_records',
          arguments: { query: 'example', limit: 1 },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    const contentText = payload.result.content[0].text as string;
    const parsed = JSON.parse(contentText);
    expect(parsed.summary).toContain('search_records');
    expect(parsed.response.resultCount).toBe(1);
    expect(payload.result.structuredContent).toBeUndefined();
  });

  it('uses structured_output when requested', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          resultCount: 2,
          records: [{ id: 'test.2', title: 'Example 2' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = new Request('http://example.com/mcp?structured_output=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'search_records',
          arguments: { query: 'example', limit: 1 },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    expect(payload.result.content[0].text).toContain('search_records');
    expect(payload.result.structuredContent.summary).toContain('search_records');
    expect(payload.result.structuredContent.response.resultCount).toBe(2);
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
              summary: ['A short description. Second sentence.'],
              images: ['/Cover/Show?id=1'],
              onlineUrls: [{ url: 'https://example.com/file.pdf', label: 'PDF' }],
              urls: [{ url: 'https://example.com/page', label: 'Page' }],
              formats: [
                { value: '0/Image/', translated: 'Kuva' },
                { value: '1/Image/Photo/', translated: 'Kuva' },
              ],
              buildings: [
                { value: '0/TEST/', translated: 'Test Library' },
                { value: '1/TEST/a/', translated: 'Branch A' },
              ],
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
            query: 'sibelius',
            sort: 'newest_first',
            filters: {
              include: { organization: ['1/KANSA/'] },
              any: { format: ['0/Image/', '1/Image/Photo/'] },
              exclude: { organization: ['1/TEST/'] },
            },
          },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    expect(payload.result.records[0].format).toBe('0/Image/');
    expect(payload.result.records[0].type).toBe('Kuva');
    expect(payload.result.records[0].description).toBe('A short description.');
    expect(payload.result.records[0].links.length).toBe(3);
    expect(payload.result.records[0].imageCount).toBe(1);
    expect(payload.result.records[0].organization).toEqual({
      primary: 'Test Library',
      code: '0/TEST/',
      locations: 1,
    });
    const linkUrls = payload.result.records[0].links.map((link: { url?: string }) => link?.url);
    expect(linkUrls).toContain('https://api.finna.fi/Cover/Show?id=1');
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
            query: '*',
            filters: { organization: '0/URHEILUMUSEO/', format: 'Book' },
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

  it('search_records builds advanced search parameters', async () => {
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
            query: 'deep learning algorithm',
            search_mode: 'advanced',
            advanced_operator: 'OR',
            limit: 5,
          },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    expect(response.status).toBe(200);
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('join=OR');
    expect(calledUrl).toContain('lookfor0%5B%5D=deep');
    expect(calledUrl).toContain('lookfor0%5B%5D=learning');
    expect(calledUrl).toContain('lookfor0%5B%5D=algorithm');
    expect(calledUrl).toContain('bool0%5B%5D=OR');
  });

  it('warns when building filter values are invalid', async () => {
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
            query: '',
            filters: { include: { organization: ['Helmet', '0%2FHelmet%2F'] } },
            limit: 0,
          },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    expect(payload.result.meta?.warning).toContain('Hierarchical facet');
  });

  it('decodes URL-encoded building values before filtering', async () => {
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
            query: '',
            filters: { include: { organization: ['0%2FHelmet%2F'] } },
            limit: 0,
          },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    expect(response.status).toBe(200);
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('filter%5B%5D=building%3A%220%2FHelmet%2F%22');
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
          arguments: { query: '*', facets: ['format'] },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    expect(payload.result.facets).toBeDefined();
  });

  it('maps top-level helpers into filters', async () => {
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
            query: '',
            available_online: true,
            usage_rights: ['public_domain'],
            format: ['0/Book/'],
            organization: ['0/Helmet/'],
            language: 'fin',
            year: '2020-2025',
            limit: 0,
          },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    expect(response.status).toBe(200);
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('filter%5B%5D=online_boolean%3A%221%22');
    expect(calledUrl).toContain('filter%5B%5D=usage_rights_str_mv%3A%22usage_A%22');
    expect(calledUrl).toContain('filter%5B%5D=%7Eformat%3A%220%2FBook%2F%22');
    expect(calledUrl).toContain('filter%5B%5D=building%3A%220%2FHelmet%2F%22');
    expect(calledUrl).toContain('filter%5B%5D=language%3A%22fin%22');
    expect(calledUrl).toContain(
      'filter%5B%5D=search_daterange_mv%3A%22%5B2020+TO+2025%5D%22',
    );
  });

  it('list_organizations uses building facet from search API', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          facets: {
            building: [
              {
                value: '0/KANSALLISKIRJASTO/',
                translated: 'Kansalliskirjasto',
                count: 1000,
              },
            ],
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
          arguments: {},
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    expect(payload.result.facets.building.length).toBe(1);
    expect(payload.result.facets.building[0].code).toBe('0/KANSALLISKIRJASTO/');
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('/search');
    expect(calledUrl).toContain('facet%5B%5D=building');
    expect(calledUrl).toContain('limit=0');
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
          arguments: { ids: ['a.1'] },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    expect(payload.result.records[0].id).toBe('a.1');
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('id%5B%5D=a.1');
    expect(calledUrl).toContain('field%5B%5D=title');
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
    expect(calledUrl).not.toContain('field%5B%5D=recordUrl');
    expect(calledUrl).toContain('field%5B%5D=buildings');
  });

  it('list_organizations returns top-level organizations from search API', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          facets: {
            building: [
              {
                value: '0/HELMET/',
                translated: 'Helmet-kirjastot',
                count: 360571,
              },
              {
                value: '0/AALTO/',
                translated: 'Aalto-yliopisto',
                count: 50000,
              },
            ],
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
        params: { name: 'list_organizations', arguments: {} },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    expect(payload.result.facets.building.length).toBe(2);
    expect(payload.result.facets.building[0].code).toBe('0/HELMET/');
    expect(payload.result.facets.building[0].name).toBe('Helmet-kirjastot');
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

  it('help tool returns guide content', async () => {
    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: { name: 'help', arguments: {} },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(typeof payload.result.markdown).toBe('string');
    expect(payload.result.markdown).toContain('Usage examples');
  });

});
