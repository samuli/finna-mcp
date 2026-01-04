import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';

describe('worker', () => {
  it('rejects non-POST', async () => {
    const request = new Request('http://example.com/mcp', { method: 'GET' });
    const response = await worker.fetch(request, {} as any);
    expect(response.status).toBe(405);
  });

  it('lists tools', async () => {
    const request = new Request('http://example.com/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'listTools' }),
    });

    const response = await worker.fetch(request, {} as any);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.tools?.length).toBeGreaterThan(0);
  });
});
