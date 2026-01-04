import { z } from 'zod';

type Env = {
  DB: D1Database;
  CACHE_BUCKET: R2Bucket;
  ORGANIZATION_ALLOWLIST?: string;
};

const toolNames = ['search_records', 'get_record', 'list_organizations'] as const;

type ToolName = (typeof toolNames)[number];

const CallToolSchema = z.object({
  name: z.enum(toolNames),
  arguments: z.record(z.unknown()).optional(),
});

const ListToolsResponse = {
  tools: toolNames.map((name) => ({
    name,
    description: '',
    inputSchema: { type: 'object', properties: {} },
  })),
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    if (url.pathname !== '/mcp') {
      return new Response('Not Found', { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return new Response(JSON.stringify({ error: 'invalid_request' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (body.method === 'listTools') {
      return json(ListToolsResponse);
    }

    if (body.method === 'callTool') {
      const parsed = CallToolSchema.safeParse(body.params);
      if (!parsed.success) {
        return json({ error: 'invalid_params', details: parsed.error.format() }, 400);
      }

      const { name } = parsed.data;
      if (!toolNames.includes(name)) {
        return json({ error: 'unknown_tool' }, 400);
      }

      return json({ result: { message: 'not_implemented_yet' } });
    }

    return json({ error: 'unknown_method' }, 400);
  },
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
