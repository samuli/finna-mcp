import { z } from 'zod';
import {
  buildSearchUrl,
  buildRecordUrl,
  buildFacetUrl,
  extractResourcesFromRecord,
  enrichRecordResources,
  type FilterInput,
} from './finna.js';

type Env = {
  DB: D1Database;
  CACHE_BUCKET: R2Bucket;
  FINNA_API_BASE?: string;
};

const toolNames = ['search_records', 'get_record', 'list_organizations', 'extract_resources'] as const;

type ToolName = (typeof toolNames)[number];

const CallToolSchema = z.object({
  name: z.enum(toolNames),
  arguments: z.record(z.unknown()).optional(),
});

const FilterSchema = z
  .object({
    include: z.record(z.array(z.string())).optional(),
    any: z.record(z.array(z.string())).optional(),
    exclude: z.record(z.array(z.string())).optional(),
  })
  .optional();

const SearchRecordsArgs = z.object({
  lookfor: z.string().default(''),
  type: z.string().default('AllFields'),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  sort: z.string().optional(),
  lng: z.string().optional(),
  filters: FilterSchema,
  facets: z.array(z.string()).optional(),
  facetFilters: z.array(z.string()).optional(),
  fields: z.array(z.string()).optional(),
  sampleLimit: z.number().int().min(1).max(5).optional(),
});

const GetRecordArgs = z.object({
  ids: z.array(z.string()).min(1),
  lng: z.string().optional(),
  fields: z.array(z.string()).optional(),
  includeRawData: z.boolean().optional(),
  sampleLimit: z.number().int().min(1).max(5).optional(),
});

const ListOrganizationsArgs = z.object({
  lookfor: z.string().default(''),
  type: z.string().default('AllFields'),
  lng: z.string().optional(),
  filters: FilterSchema,
});

const ExtractResourcesArgs = z.object({
  ids: z.array(z.string()).min(1),
  lng: z.string().optional(),
  sampleLimit: z.number().int().min(1).max(5).optional(),
});

const ListToolsResponse = {
  tools: [
    {
      name: 'search_records',
      description:
        'Search Finna records with LLM-friendly structured filters. Do not use for libraries/organizations; use list_organizations instead.',
      inputSchema: {
        type: 'object',
        properties: {
          lookfor: { type: 'string' },
          type: { type: 'string' },
          page: { type: 'number' },
          limit: { type: 'number' },
          sort: { type: 'string' },
          lng: { type: 'string' },
          filters: { type: 'object' },
          facets: { type: 'array', items: { type: 'string' } },
          facetFilters: { type: 'array', items: { type: 'string' } },
          fields: { type: 'array', items: { type: 'string' } },
          sampleLimit: { type: 'number' },
        },
      },
    },
    {
      name: 'get_record',
      description: 'Fetch record metadata for one or more ids.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          lng: { type: 'string' },
          fields: { type: 'array', items: { type: 'string' } },
          includeRawData: { type: 'boolean' },
          sampleLimit: { type: 'number' },
        },
        required: ['ids'],
      },
    },
    {
      name: 'list_organizations',
      description:
        'List organizations/buildings (e.g., libraries) using the Finna building facet.',
      inputSchema: {
        type: 'object',
        properties: {
          lookfor: { type: 'string' },
          type: { type: 'string' },
          lng: { type: 'string' },
          filters: { type: 'object' },
        },
      },
    },
    {
      name: 'extract_resources',
      description: 'Extract and summarize resource links for record ids.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' } },
          lng: { type: 'string' },
          sampleLimit: { type: 'number' },
        },
        required: ['ids'],
      },
    },
  ],
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

    if (isJsonRpc(body)) {
      return await handleJsonRpc(body, env);
    }

    if (body.method === 'listTools') {
      return json(ListToolsResponse);
    }

    if (body.method === 'callTool') {
      const parsed = CallToolSchema.safeParse(body.params);
      if (!parsed.success) {
        return json({ error: 'invalid_params', details: parsed.error.format() }, 400);
      }

      const { name, arguments: args } = parsed.data;
      if (!toolNames.includes(name)) {
        return json({ error: 'unknown_tool' }, 400);
      }

      try {
        switch (name) {
          case 'search_records':
            return await handleSearchRecords(env, args);
          case 'get_record':
            return await handleGetRecord(env, args);
          case 'list_organizations':
            return await handleListOrganizations(env, args);
          case 'extract_resources':
            return await handleExtractResources(env, args);
        }
      } catch (error) {
        return json({ error: 'upstream_error', message: errorMessage(error) }, 502);
      }
    }

    return json({ error: 'unknown_method' }, 400);
  },
};

const DEFAULT_SEARCH_FIELDS = [
  'id',
  'title',
  'formats',
  'buildings',
  'languages',
  'year',
  'images',
  'onlineUrls',
  'urls',
  'nonPresenterAuthors',
];

const DEFAULT_RECORD_FIELDS = [
  'id',
  'title',
  'formats',
  'buildings',
  'subjects',
  'genres',
  'series',
  'authors',
  'publishers',
  'year',
  'humanReadablePublicationDates',
  'images',
  'onlineUrls',
  'urls',
  'summary',
  'measurements',
];

async function handleSearchRecords(env: Env, args: unknown): Promise<Response> {
  const parsed = SearchRecordsArgs.safeParse(args ?? {});
  if (!parsed.success) {
    return json({ error: 'invalid_params', details: parsed.error.format() }, 400);
  }
  const {
    lookfor,
    type,
    page,
    limit,
    sort,
    lng,
    filters,
    facets,
    facetFilters,
    fields,
    sampleLimit,
  } = parsed.data;

  const url = buildSearchUrl({
    apiBase: env.FINNA_API_BASE,
    lookfor,
    type,
    page,
    limit,
    sort,
    lng,
    filters: filters as FilterInput | undefined,
    facets,
    facetFilters,
    fields: fields ?? DEFAULT_SEARCH_FIELDS,
  });

  const payload = await fetchJson(url);
  const records = getRecords(payload);
  const enriched = records.map((record) =>
    enrichRecordResources(record, sampleLimit ?? 3),
  );

  return json({
    result: {
      ...payload,
      records: enriched,
    },
  });
}

async function handleGetRecord(env: Env, args: unknown): Promise<Response> {
  const parsed = GetRecordArgs.safeParse(args);
  if (!parsed.success) {
    return json({ error: 'invalid_params', details: parsed.error.format() }, 400);
  }
  const { ids, lng, fields, includeRawData, sampleLimit } = parsed.data;
  const selectedFields = fields ? [...fields] : [...DEFAULT_RECORD_FIELDS];
  if (includeRawData) {
    selectedFields.push('rawData');
  }

  const url = buildRecordUrl({
    apiBase: env.FINNA_API_BASE,
    ids,
    lng,
    fields: selectedFields,
  });

  const payload = await fetchJson(url);
  const records = getRecords(payload);
  const enriched = records.map((record) =>
    enrichRecordResources(record, sampleLimit ?? 5),
  );

  return json({
    result: {
      ...payload,
      records: enriched,
    },
  });
}

async function handleListOrganizations(env: Env, args: unknown): Promise<Response> {
  const parsed = ListOrganizationsArgs.safeParse(args ?? {});
  if (!parsed.success) {
    return json({ error: 'invalid_params', details: parsed.error.format() }, 400);
  }
  const { lookfor, type, lng, filters } = parsed.data;
  const url = buildFacetUrl({
    apiBase: env.FINNA_API_BASE,
    lookfor,
    type,
    lng,
    filters: filters as FilterInput | undefined,
    facet: 'building',
  });

  const payload = await fetchJson(url);
  return json({ result: stripFacetHrefs(payload) });
}

function stripFacetHrefs(payload: Record<string, unknown>): Record<string, unknown> {
  if (!payload.facets || !Array.isArray(payload.facets)) {
    return payload;
  }
  const cleaned = payload.facets.map((facet) => {
    if (!facet || typeof facet !== 'object') {
      return facet;
    }
    const entries = (facet as { data?: unknown }).data;
    if (!Array.isArray(entries)) {
      return facet;
    }
    const updated = entries.map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return entry;
      }
      const { href, ...rest } = entry as Record<string, unknown>;
      return rest;
    });
    return { ...(facet as Record<string, unknown>), data: updated };
  });
  return { ...payload, facets: cleaned };
}

async function handleExtractResources(env: Env, args: unknown): Promise<Response> {
  const parsed = ExtractResourcesArgs.safeParse(args);
  if (!parsed.success) {
    return json({ error: 'invalid_params', details: parsed.error.format() }, 400);
  }
  const { ids, lng, sampleLimit } = parsed.data;
  const url = buildRecordUrl({
    apiBase: env.FINNA_API_BASE,
    ids,
    lng,
    fields: ['id', 'images', 'onlineUrls', 'urls'],
  });
  const payload = await fetchJson(url);
  const records = getRecords(payload);
  const resources = records.map((record) =>
    extractResourcesFromRecord(record, sampleLimit ?? 5),
  );

  return json({ result: { resources } });
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Upstream error ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function getRecords(payload: Record<string, unknown>): Record<string, unknown>[] {
  const records = payload.records;
  return Array.isArray(records) ? (records as Record<string, unknown>[]) : [];
}

type JsonRpcRequest = {
  jsonrpc: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown> | null;
};

const SERVER_INFO = {
  name: 'finna-mcp',
  version: '0.1.0',
};

const MCP_PROTOCOL_VERSION = '2025-06-18';

async function handleJsonRpc(body: JsonRpcRequest, env: Env): Promise<Response> {
  const { id, method } = body;

  if (method === 'initialize') {
    return json(
      jsonRpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'Finna MCP server. Use tools/list and tools/call to search records and fetch metadata.',
      }),
    );
  }

  if (method === 'notifications/initialized') {
    return new Response(null, { status: 204 });
  }

  if (method === 'tools/list') {
    return json(jsonRpcResult(id, ListToolsResponse));
  }

  if (method === 'tools/call') {
    const params = body.params ?? {};
    const parsed = CallToolSchema.safeParse(params);
    if (!parsed.success) {
      return json(
        jsonRpcError(id, -32602, 'Invalid params', parsed.error.format()),
        400,
      );
    }

    const { name, arguments: args } = parsed.data;
    if (!toolNames.includes(name)) {
      return json(jsonRpcError(id, -32601, 'Method not found'), 404);
    }

    try {
      const result = await dispatchTool(name, args, env);
      return json(
        jsonRpcResult(id, {
          content: [{ type: 'text', text: 'OK' }],
          structuredContent: result,
          isError: false,
        }),
      );
    } catch (error) {
      return json(
        jsonRpcResult(id, {
          content: [{ type: 'text', text: errorMessage(error) }],
          structuredContent: { error: 'upstream_error', message: errorMessage(error) },
          isError: true,
        }),
        502,
      );
    }
  }

  return json(jsonRpcError(id, -32601, 'Method not found'), 404);
}

function isJsonRpc(body: unknown): body is JsonRpcRequest {
  return (
    typeof body === 'object' &&
    body !== null &&
    'jsonrpc' in body &&
    (body as { jsonrpc?: unknown }).jsonrpc === '2.0' &&
    'method' in body
  );
}

function jsonRpcResult(id: JsonRpcRequest['id'], result: unknown) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    result,
  };
}

function jsonRpcError(id: JsonRpcRequest['id'], code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code,
      message,
      data,
    },
  };
}

async function dispatchTool(
  name: ToolName,
  args: Record<string, unknown> | undefined,
  env: Env,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'search_records':
      return await unwrapResult(handleSearchRecords(env, args));
    case 'get_record':
      return await unwrapResult(handleGetRecord(env, args));
    case 'list_organizations':
      return await unwrapResult(handleListOrganizations(env, args));
    case 'extract_resources':
      return await unwrapResult(handleExtractResources(env, args));
  }
}

async function unwrapResult(responsePromise: Promise<Response>): Promise<Record<string, unknown>> {
  const response = await responsePromise;
  const payload = (await response.json()) as Record<string, unknown>;
  return payload.result as Record<string, unknown>;
}
