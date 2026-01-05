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
    expect(calledUrl).toContain('filter%5B%5D=building%3A%221%2FKANSA%2F%22');
    expect(calledUrl).toContain('filter%5B%5D=%7Eformat%3A%220%2FImage%2F%22');
    expect(calledUrl).toContain('filter%5B%5D=%7Eformat%3A%221%2FImage%2FPhoto%2F%22');
    expect(calledUrl).toContain('filter%5B%5D=-building%3A%221%2FTEST%2F%22');
  });

  it('list_organizations uses building facet', async () => {
    const mockFetch = vi.mocked(globalThis.fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: 'OK', facets: { building: [{ value: '1/KANSA/', count: 3 }] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'callTool',
        params: { name: 'list_organizations', arguments: { lookfor: '' } },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    expect(payload.result.facets.building.length).toBe(1);
    const calledUrl = String(mockFetch.mock.calls[0][0]);
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
          arguments: { ids: ['a.1'], includeFullRecord: true, includeRawData: true },
        },
      }),
    });

    const response = await worker.fetch(request, baseEnv);
    const payload = await response.json();
    expect(payload.result.records[0].resourceCounts.audio).toBe(1);
    const calledUrl = String(mockFetch.mock.calls[0][0]);
    expect(calledUrl).toContain('id%5B%5D=a.1');
    expect(calledUrl).toContain('field%5B%5D=fullRecord');
    expect(calledUrl).toContain('field%5B%5D=rawData');
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
});
