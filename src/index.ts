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
  limit: z.number().int().min(0).max(100).optional(),
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
        'Search Finna records with LLM-friendly structured filters. Do not use for libraries/organizations; use list_organizations instead. lookfor uses Solr/Lucene-style query syntax over limited metadata fields; use lookfor="" or "*" when you only need counts by filters. To count records, set limit=0 and read resultCount. For books: use filters.include.format=["0/Book/"] (format codes) and a building filter from list_organizations. Sort options: "relevance,id asc" (default), "main_date_str desc" (year newest), "main_date_str asc" (year oldest), "last_indexed desc", "first_indexed desc", "callnumber,id asc", "author,id asc", "title,id asc".',
      inputSchema: {
        type: 'object',
        properties: {
          lookfor: { type: 'string' },
          type: { type: 'string' },
          page: { type: 'number' },
          limit: { type: 'number' },
          sort: {
            type: 'string',
            description:
              'Sort options: "relevance,id asc" (default), "main_date_str desc" (year newest), "main_date_str asc" (year oldest), "last_indexed desc", "first_indexed desc", "callnumber,id asc", "author,id asc", "title,id asc".',
          },
          lng: { type: 'string' },
          filters: {
            type: 'object',
            description:
              'Structured filters: {include:{field:[values]}, any:{field:[values]}, exclude:{field:[values]}}. For building/library, use list_organizations value strings and put them in include.building. For books: include.format=["0/Book/"]. For counts, pair filters with lookfor="" and limit=0.',
          },
          facets: { type: 'array', items: { type: 'string' } },
          facetFilters: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Raw facet filters in Finna syntax, e.g. ["building:\\"0/URHEILUMUSEO/\\"", "format:\\"0/Book/\\""]',
          },
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
        'List organizations/buildings (e.g., libraries) using the Finna building facet. Use the returned value strings in search_records filters.include.building.',
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
  const normalizedFilters = normalizeFilters(filters);
  const normalizedSort = normalizeSort(sort);

  const url = buildSearchUrl({
    apiBase: env.FINNA_API_BASE,
    lookfor,
    type,
    page,
    limit,
    sort: normalizedSort,
    lng,
    filters: normalizedFilters,
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
      ...stripFacetsIfUnused(payload, facets),
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
  const normalizedFilters = normalizeFilters(filters);
  const cacheLng = lng ?? 'fi';
  const cacheKey = buildOrganizationsCacheKey(cacheLng, type);
  const cached = await readOrganizationsCache(env, cacheKey);
  if (cached) {
    if (!lookfor && !normalizedFilters) {
      return json({ result: cached });
    }
    const filtered = filterOrganizationsPayload(cached, lookfor, normalizedFilters);
    if (filtered) {
      return json({ result: filtered });
    }
  }
  const url = buildFacetUrl({
    apiBase: env.FINNA_API_BASE,
    lookfor: '',
    type,
    lng,
    filters: undefined,
    facet: 'building',
  });

  const payload = await fetchJson(url);
  const cleaned = stripFacetHrefs(payload);
  const filtered = filterOrganizationsPayload(cleaned, lookfor, normalizedFilters);
  if (filtered) {
    await writeOrganizationsCache(env, cacheKey, cleaned);
    return json({ result: filtered });
  }
  if (!lookfor && !normalizedFilters) {
    await writeOrganizationsCache(env, cacheKey, cleaned);
  }
  return json({ result: cleaned });
}

function normalizeFilters(filters?: unknown): FilterInput | undefined {
  if (!filters || typeof filters !== 'object') {
    return undefined;
  }
  const candidate = filters as Record<string, unknown>;
  if ('include' in candidate || 'any' in candidate || 'exclude' in candidate) {
    const include = normalizeFilterBucket(candidate.include);
    const any = normalizeFilterBucket(candidate.any);
    const exclude = normalizeFilterBucket(candidate.exclude);
    const normalized: FilterInput = {};
    if (include) {
      normalized.include = include;
    }
    if (any) {
      normalized.any = any;
    }
    if (exclude) {
      normalized.exclude = exclude;
    }
    return Object.keys(normalized).length > 0 ? normalized : undefined;
  }
  const include: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(candidate)) {
    const mappedKey = mapFilterField(key);
    if (Array.isArray(value)) {
      include[mappedKey] = (value.filter((item) => typeof item === 'string') as string[]).map(
        (item) => mapFilterValue(mappedKey, item),
      );
    } else if (typeof value === 'string') {
      include[mappedKey] = [mapFilterValue(mappedKey, value)];
    }
  }
  return Object.keys(include).length > 0 ? { include } : undefined;
}

function normalizeFilterBucket(
  bucket: unknown,
): Record<string, string[]> | undefined {
  if (!bucket || typeof bucket !== 'object') {
    return undefined;
  }
  const include: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(bucket as Record<string, unknown>)) {
    const mappedKey = mapFilterField(key);
    if (Array.isArray(value)) {
      const mapped = (value.filter((item) => typeof item === 'string') as string[]).map(
        (item) => mapFilterValue(mappedKey, item),
      );
      if (mapped.length > 0) {
        include[mappedKey] = mapped;
      }
    } else if (typeof value === 'string') {
      include[mappedKey] = [mapFilterValue(mappedKey, value)];
    }
  }
  return Object.keys(include).length > 0 ? include : undefined;
}

function mapFilterField(field: string): string {
  if (field === 'building_str_mv') {
    return 'building';
  }
  return field;
}

function mapFilterValue(field: string, value: string): string {
  if (field === 'format' && value.toLowerCase() === 'book') {
    return '0/Book/';
  }
  return value;
}

function stripFacetHrefs(payload: Record<string, unknown>): Record<string, unknown> {
  return stripHrefDeep(payload) as Record<string, unknown>;
}

function stripFacetsIfUnused(
  payload: Record<string, unknown>,
  requestedFacets?: string[] | null,
): Record<string, unknown> {
  if (requestedFacets && requestedFacets.length > 0) {
    return payload;
  }
  if (!('facets' in payload)) {
    return payload;
  }
  const { facets, ...rest } = payload;
  return rest as Record<string, unknown>;
}

function normalizeSort(sort?: string): string | undefined {
  if (!sort) {
    return sort;
  }
  const normalized = sort.trim().toLowerCase();
  if (normalized === 'newest_first' || normalized === 'newest' || normalized === 'latest') {
    return 'main_date_str desc';
  }
  if (normalized === 'oldest_first' || normalized === 'oldest' || normalized === 'earliest') {
    return 'main_date_str asc';
  }
  return sort;
}

function stripHrefDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stripHrefDeep(item));
  }
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input)) {
      if (key === 'href') {
        continue;
      }
      output[key] = stripHrefDeep(val);
    }
    return output;
  }
  return value;
}

const ORGANIZATIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function buildOrganizationsCacheKey(lng: string, type: string): string {
  return `list_organizations:${lng}:${type}`;
}

async function readOrganizationsCache(
  env: Env,
  key: string,
): Promise<Record<string, unknown> | null> {
  try {
    const object = await env.CACHE_BUCKET.get(key);
    if (!object) {
      return null;
    }
    const text = await object.text();
    const parsed = JSON.parse(text) as { ts?: number; payload?: Record<string, unknown> };
    const ts = typeof parsed.ts === 'number' ? parsed.ts : 0;
    if (!parsed.payload || Date.now() - ts > ORGANIZATIONS_CACHE_TTL_MS) {
      return null;
    }
    return parsed.payload;
  } catch {
    return null;
  }
}

async function writeOrganizationsCache(
  env: Env,
  key: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await env.CACHE_BUCKET.put(
      key,
      JSON.stringify({ ts: Date.now(), payload }),
    );
  } catch {
    // Best-effort cache write.
  }
}

function filterOrganizationsPayload(
  payload: Record<string, unknown>,
  lookfor: string,
  filters?: FilterInput,
): Record<string, unknown> | null {
  const facets = payload.facets as Record<string, unknown> | undefined;
  const entries = facets?.building;
  if (!Array.isArray(entries)) {
    return null;
  }
  if (!filters && !lookfor) {
    return payload;
  }

  if (filters) {
    const keys = [
      ...Object.keys(filters.include ?? {}),
      ...Object.keys(filters.any ?? {}),
      ...Object.keys(filters.exclude ?? {}),
    ];
    if (keys.some((key) => key !== 'building')) {
      return null;
    }
  }

  let result = entries.slice();
  const query = lookfor.toLowerCase().trim();
  const variants = query ? buildLookforVariants(query) : [];
  const includeValues = new Set(filters?.include?.building ?? []);
  const anyValues = new Set(filters?.any?.building ?? []);
  const excludeValues = new Set(filters?.exclude?.building ?? []);
  if (
    variants.length > 0 ||
    includeValues.size > 0 ||
    anyValues.size > 0 ||
    excludeValues.size > 0
  ) {
    result = filterFacetEntries(result, variants, includeValues, anyValues, excludeValues);
  }

  return {
    ...payload,
    resultCount: result.length,
    facets: {
      ...facets,
      building: result,
    },
  };
}

function buildLookforVariants(query: string): string[] {
  if (!query) {
    return [];
  }
  const variants = new Set<string>();
  variants.add(query);
  const trimmed = query.replace(/\s+/g, ' ').trim();
  variants.add(trimmed);
  if (trimmed.length > 4) {
    variants.add(trimmed.slice(0, -1));
  }
  if (trimmed.endsWith('i')) {
    variants.add(`${trimmed}n`);
    variants.add(`${trimmed.slice(0, -1)}en`);
  }
  const lastChar = trimmed.at(-1);
  if (lastChar && 'aäoöuy'.includes(lastChar)) {
    variants.add(`${trimmed}n`);
  }
  variants.delete('');
  return Array.from(variants);
}

function filterFacetEntries(
  entries: unknown[],
  variants: string[],
  includeValues: Set<string>,
  anyValues: Set<string>,
  excludeValues: Set<string>,
): unknown[] {
  const filtered: unknown[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const { kept, node } = filterFacetEntry(record, variants, includeValues, anyValues, excludeValues);
    if (kept) {
      filtered.push(node);
    }
  }
  return filtered;
}

function filterFacetEntry(
  entry: Record<string, unknown>,
  variants: string[],
  includeValues: Set<string>,
  anyValues: Set<string>,
  excludeValues: Set<string>,
): { kept: boolean; node: Record<string, unknown> } {
  const value = String(entry.value ?? '');
  const translated = String(entry.translated ?? '');
  const valueLower = value.toLowerCase();
  const translatedLower = translated.toLowerCase();
  const matchesLookfor =
    variants.length === 0
      ? true
      : variants.some(
          (variant) =>
            valueLower.includes(variant) || translatedLower.includes(variant),
        );

  const hasInclude =
    includeValues.size === 0 ? true : includeValues.has(value);
  const hasAny = anyValues.size === 0 ? true : anyValues.has(value);
  const hasExclude = excludeValues.has(value);

  let kept = matchesLookfor && hasInclude && hasAny && !hasExclude;
  const updated: Record<string, unknown> = { ...entry };

  const childKeys = ['children', 'child', 'childNodes', 'nodes', 'sub'];
  for (const key of childKeys) {
    const children = entry[key];
    if (!Array.isArray(children)) {
      continue;
    }
    const filteredChildren = filterFacetEntries(
      children,
      variants,
      includeValues,
      anyValues,
      excludeValues,
    );
    if (filteredChildren.length > 0) {
      updated[key] = filteredChildren;
      kept = true;
    } else if (key in updated) {
      delete updated[key];
    }
  }

  return { kept, node: updated };
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
      const contentText = JSON.stringify(result ?? {});
      return json(
        jsonRpcResult(id, {
          content: [{ type: 'text', text: contentText }],
          structuredContent: result,
          isError: false,
        }),
      );
    } catch (error) {
      const message = errorMessage(error);
      return json(
        jsonRpcResult(id, {
          content: [{ type: 'text', text: message }],
          structuredContent: { error: 'upstream_error', message },
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
