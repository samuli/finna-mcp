import { z } from 'zod';
import {
  buildSearchUrl,
  buildRecordUrl,
  extractResourcesFromRecord,
  enrichRecordResources,
  type FilterInput,
} from './finna.js';

type Env = {
  DB: D1Database;
  CACHE_BUCKET: R2Bucket;
  FINNA_API_BASE?: string;
  FINNA_UI_BASE?: string;
  FINNA_MCP_DISABLE_CACHE?: string;
};

const HIERARCHICAL_FACET_FIELDS = new Set([
  'building',
  'format',
  'sector_str_mv',
  'category_str_mv',
]);

const toolNames = [
  'search_records',
  'get_record',
  'list_organizations',
  'extract_resources',
  'help',
] as const;

type ToolName = (typeof toolNames)[number];

const CallToolSchema = z.object({
  name: z.enum(toolNames),
  arguments: z.record(z.unknown()).optional(),
});

const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.unknown()).optional(),
});

const StructuredFilterSchema = z
  .object({
    include: z.record(z.array(z.string())).optional(),
    any: z.record(z.array(z.string())).optional(),
    exclude: z.record(z.array(z.string())).optional(),
  })
  .passthrough();
const FilterSchema = z.union([StructuredFilterSchema, z.record(z.unknown())]).optional();

const SEARCH_SORT_OPTIONS = [
  'relevance',
  'newest',
  'newest_first',
  'latest',
  'oldest',
  'oldest_first',
  'earliest',
  'year_newest',
  'year_oldest',
] as const;

const SEARCH_MODE_OPTIONS = ['simple', 'advanced'] as const;
const ADVANCED_OPERATOR_OPTIONS = ['AND', 'OR'] as const;

const FIELD_PRESET_OPTIONS = ['compact', 'media', 'full'] as const;

const SearchRecordsArgs = z.object({
  query: z.string().default(''),
  type: z.string().default('AllFields'),
  search_mode: z.enum(SEARCH_MODE_OPTIONS).optional(),
  advanced_operator: z.enum(ADVANCED_OPERATOR_OPTIONS).optional(),
  fields_preset: z.enum(FIELD_PRESET_OPTIONS).optional(),
  page: z.number().int().min(1).optional(),
  limit: z.number().int().min(0).max(100).optional(),
  sort: z.enum(SEARCH_SORT_OPTIONS).optional(),
  lng: z.string().optional(),
  available_online: z.boolean().optional(),
  usage_rights: z.union([z.string(), z.array(z.string())]).optional(),
  format: z.union([z.string(), z.array(z.string())]).optional(),
  organization: z.union([z.string(), z.array(z.string())]).optional(),
  language: z.union([z.string(), z.array(z.string())]).optional(),
  year: z.union([z.string(), z.array(z.string())]).optional(),
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
  fields_preset: z.enum(FIELD_PRESET_OPTIONS).optional(),
  includeRawData: z.boolean().optional(),
  sampleLimit: z.number().int().min(1).max(5).optional(),
});

const ListOrganizationsArgs = z.object({
  query: z.string().default(''),
  type: z.string().default('AllFields'),
  lng: z.string().optional(),
  filters: FilterSchema,
  max_depth: z.number().int().min(1).max(6).optional(),
  include_paths: z.boolean().optional(),
  compact: z.boolean().optional(),
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
      'Search and retrieve metadata over records in Finna.fi. Do not use for libraries/organizations; use list_organizations instead. Use "help" tool to get more information and usage examples.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'Search keywords over metadata (Solr behind the scenes). Use short keywords, not long sentences. Not a full-text search. For multi-term OR/AND, use search_mode="advanced".',
          },
          type: { type: 'string' },
          search_mode: {
            type: 'string',
            description: 'Search mode: "simple" (default) or "advanced" (multi-term).',
          },
          advanced_operator: {
            type: 'string',
            description: 'Operator for advanced mode: "AND" (default) or "OR".',
          },
          fields_preset: {
            type: 'string',
            description:
              'Field preset: "compact" (ids + title + urls), "media" (adds images/external resources), "full" (adds richer metadata). Overrides default fields unless fields is set.',
          },
          page: { type: 'number' },
          limit: { type: 'number', description: 'Number of results per page (0-100). To count records, set limit=0 and read resultCount.' },
          sort: {
            type: 'string',
            description:
              'Sort options: "relevance" (default), "newest" (recently added to Finna), "oldest" (earliest added), "year_newest" (newest publication/creation year), "year_oldest" (oldest year).',
          },
          lng: { type: 'string', description: 'Language code (e.g., "fi", "sv", "en")' },
          available_online: {
            type: 'boolean',
            description:
            'Return only material that is available online',
          },
          usage_rights: {
            type: ['string', 'array'],
            items: { type: 'string' },
            description:
              'Usage rights codes (usage_A..usage_F). usage_A=Free use, usage_B=Derivatives+commercial, usage_C=No derivatives+commercial, usage_D=Derivatives+non-commercial, usage_E=No derivatives+non-commercial, usage_F=Permission required/unknown.',
          },
          format: {
            type: ['string', 'array'],
            items: { type: 'string' },
            description:
              'Content types (format IDs). Examples: "0/Book/", "0/Book/eBook/", "0/Image/"',
          },
          organization: {
            type: ['string', 'array'],
            items: { type: 'string' },
            description:
              'Organizations (IDs from list_organizations).'
          },
          language: {
            type: ['string', 'array'],
            items: { type: 'string' },
            description:
              'Language (e.g., "fin", "swe", "eng")',
          },
          year: {
            type: ['string', 'array'],
            items: { type: 'string' },
            description:
              'Publication/creation year or range (e.g., "2026" or "2020-2025").',
          },
          filters: {
            type: 'object',
            description:
              'Structured filters: {include:{field:[values]}, any:{field:[values]}, exclude:{field:[values]}}. For organizations, use list_organizations value strings in include.organization. Example for books: include.format=["0/Book/"]. Use exclude.format=[...] to drop formats. Note that filter values are case sensitive need to match exactly to those used by Finna.',
          },
          facets: {
            type: 'array',
            items: { type: 'string' },
            description:
            'Facets to return (e.g., ["building", "format"]). If empty or omitted, no facets are returned. Note that facets (especially building) often returns lots of data. Use facetFilters to limit.'
          },
          facetFilters: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Facet bucket filter only (does not filter records). Finna facet filter syntax, e.g. ["building:\\"0/URHEILUMUSEO/\\"", "format:\\"0/Book/\\""].',
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Advanced: explicit record fields to return. Defaults include: id, title, formats, authors, buildings, languages, year, images, onlineUrls, urls, recordUrl, contributors. Use fields for uncommon items like nonPresenterAuthors.',
          },
          sampleLimit: {
            type: 'number',
            description:
              'Max number of example resource links per record.',
          },
        },
      },
    },
    {
      name: 'get_record',
      description: 'Get metadata for one or more records.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: 'Record ID(s)' },
          lng: { type: 'string', description: 'Language code (e.g., "fi", "sv", "en")' },
          fields_preset: {
            type: 'string',
            description:
              'Field preset: "compact" (ids + title + urls), "media" (adds images/onlineUrls), "full" (adds richer metadata).',
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Advanced: explicit record fields to return. Defaults include: id, title, formats, buildings, subjects, genres, series, authors, publishers, year, humanReadablePublicationDates, images, onlineUrls, urls, recordUrl, summary, measurements, contributors.',
          },
          includeRawData: {
            type: 'boolean',
            description:
              'Include raw source metadata (large/noisy). Use only when needed.',
          },
          sampleLimit: {
            type: 'number',
            description:
              'Max number of example resource links per record.',
          },
        },
        required: ['ids'],
      },
    },
    {
      name: 'list_organizations',
      description:
        'List organizations (e.g., libraries, museums, archives) that have material in Finna. Use only the returned value strings in search_records filters.include.organization (path labels are for display, not filtering). Unfiltered results return only the top 2 levels with meta.pruned=true; use query/filters for deeper levels.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          type: { type: 'string' },
          lng: { type: 'string', description: 'Language code (e.g., "fi", "sv", "en")' },
          filters: { type: 'object' },
          max_depth: {
            type: 'number',
            description:
              'Optional max depth for returned hierarchy (1-6)',
          },
          include_paths: {
            type: 'boolean',
            description:
              'If true, include a path label for each item (e.g., "Satakirjastot / Rauma / Rauman pääkirjasto").',
          },
          compact: {
            type: 'boolean',
            description:
              'If true, return only top-level organizations (no children) with minimal fields.',
          },
        },
      },
    },
    {
      name: 'extract_resources',
      description: 'Return external resources related to records.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: 'Record ID(s)' },
          lng: { type: 'string', description: 'Language code (e.g., "fi", "sv", "en")' },
          sampleLimit: {
            type: 'number',
            description:
              'Max number of example resource links per record.',
          },
        },
        required: ['ids'],
      },
    },
    {
      name: 'help',
      description:
        'Show a help guide about Finna.fi, search filters, formats, and common usage patterns.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ],
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/mcp') {
      return new Response('Not Found', { status: 404 });
    }
    const structuredOutput = url.searchParams.get('structured_output') === '1';

    if (request.method === 'GET') {
      const accept = request.headers.get('accept') ?? '';
      if (accept.includes('text/event-stream')) {
        return handleSseRequest(request, structuredOutput);
      }
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (request.method === 'POST' && url.searchParams.get('session')) {
      const body = await request.json().catch(() => null);
      return await handleSsePost(
        url.searchParams.get('session') ?? '',
        body,
        env,
        structuredOutput,
      );
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return json({ error: 'invalid_request' });
    }

    if (isJsonRpc(body)) {
      return await handleJsonRpc(body, env, structuredOutput);
    }

    if (body.method === 'listTools') {
      return json(ListToolsResponse);
    }

    if (body.method === 'callTool') {
      const parsed = CallToolSchema.safeParse(body.params);
      if (!parsed.success) {
        return json({ error: 'invalid_params', details: parsed.error.format() });
      }

      const { name, arguments: args } = parsed.data;
      if (!toolNames.includes(name)) {
        return json({ error: 'unknown_tool' });
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
          case 'help':
            return json({ result: buildHelpPayload() });
        }
      } catch (error) {
        return json({ error: 'upstream_error', message: errorMessage(error) });
      }
    }

    return json({ error: 'unknown_method' });
  },
};

const DEFAULT_SEARCH_FIELDS = [
  'id',
  'title',
  'formats',
  'authors',
  'buildings',
  'languages',
  'year',
  'images',
  'onlineUrls',
  'urls',
  'recordUrl',
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
  'recordUrl',
  'summary',
  'measurements',
];

function resolveSearchFieldsPreset(preset?: string): string[] {
  if (!preset) {
    return [...DEFAULT_SEARCH_FIELDS];
  }
  const selected = SEARCH_FIELD_PRESETS[preset];
  return selected ? [...selected] : [...DEFAULT_SEARCH_FIELDS];
}

function resolveGetRecordFieldsPreset(preset?: string): string[] {
  if (!preset) {
    return [...DEFAULT_RECORD_FIELDS];
  }
  const selected = GET_RECORD_FIELD_PRESETS[preset];
  return selected ? [...selected] : [...DEFAULT_RECORD_FIELDS];
}

const SEARCH_FIELD_PRESETS: Record<string, string[]> = {
  compact: ['id', 'title', 'recordUrl', 'urls', 'onlineUrls'],
  media: ['id', 'title', 'recordUrl', 'images', 'urls', 'onlineUrls', 'formats', 'languages', 'year'],
  full: [
    'id',
    'title',
    'recordUrl',
    'formats',
    'languages',
    'year',
    'images',
    'onlineUrls',
    'urls',
    'subjects',
    'genres',
    'series',
    'authors',
    'publishers',
    'summary',
    'measurements',
  ],
};

const GET_RECORD_FIELD_PRESETS: Record<string, string[]> = {
  compact: ['id', 'title', 'recordUrl', 'urls', 'onlineUrls'],
  media: [
    'id',
    'title',
    'recordUrl',
    'images',
    'urls',
    'onlineUrls',
    'formats',
    'languages',
    'year',
  ],
  full: [
    'id',
    'title',
    'recordUrl',
    'formats',
    'languages',
    'year',
    'images',
    'onlineUrls',
    'urls',
    'buildings',
    'subjects',
    'genres',
    'series',
    'authors',
    'publishers',
    'summary',
    'measurements',
  ],
};

async function handleSearchRecords(env: Env, args: unknown): Promise<Response> {
  const parsed = SearchRecordsArgs.safeParse(args ?? {});
  if (!parsed.success) {
    return json({ error: 'invalid_params', details: parsed.error.format() }, 400);
  }
  const {
    query,
    type,
    search_mode,
    advanced_operator,
    fields_preset,
    page,
    limit,
    sort,
    lng,
    available_online,
    usage_rights,
    format,
    organization,
    language,
    year,
    filters,
    facets,
    facetFilters,
    fields,
    sampleLimit,
  } = parsed.data;
  let normalizedFilters = normalizeFilters(filters);
  normalizedFilters = mergeTopLevelFilters(normalizedFilters, {
    available_online,
    usage_rights,
    format,
    organization,
    language,
    year,
  });
  const buildingWarnings = collectHierarchicalFilterWarnings(normalizedFilters);
  const normalizedBuilding = await normalizeBuildingFiltersWithCache(
    normalizedFilters,
    env,
    lng,
  );
  normalizedFilters = normalizedBuilding.filters;
  const normalizedSort = normalizeSort(sort);
  const selectedFields = fields ?? resolveSearchFieldsPreset(fields_preset);

  const url = buildSearchUrl({
    apiBase: env.FINNA_API_BASE,
    lookfor: query,
    type,
    searchMode: search_mode,
    advancedOperator: advanced_operator,
    page,
    limit,
    sort: normalizedSort,
    lng,
    filters: normalizedFilters,
    facets,
    facetFilters,
    fields: selectedFields,
  });

  const payload = await fetchJson(url);
  const records = limit === 0 ? [] : getRecords(payload);
  const enriched =
    limit === 0
      ? []
      : records.map((record) =>
          addRecordPageUrl(
            enrichRecordResources(record, sampleLimit ?? 3),
            env.FINNA_UI_BASE,
          ),
        );
  const cleaned =
    selectedFields && !selectedFields.includes('recordUrl')
      ? enriched.map((record) => stripRecordUrl(record))
      : enriched;
  const meta = buildSearchMeta({
    query,
    search_mode,
    fields_preset,
    fields,
    fieldsProvided: fields !== undefined,
    limit,
    resultCount: payload.resultCount,
    records: cleaned,
    extraInfo: normalizedBuilding.info,
    extraWarning: buildingWarnings.concat(normalizedBuilding.warnings),
  });

  return json({
    result: {
      ...stripFacetsIfUnused(payload, facets),
      records: cleaned,
      ...(meta ? { meta } : {}),
    },
  });
}

async function handleGetRecord(env: Env, args: unknown): Promise<Response> {
  const parsed = GetRecordArgs.safeParse(args);
  if (!parsed.success) {
    return json({ error: 'invalid_params', details: parsed.error.format() }, 400);
  }
  const { ids, lng, fields, fields_preset, includeRawData, sampleLimit } = parsed.data;
  const selectedFields = fields ? [...fields] : resolveGetRecordFieldsPreset(fields_preset);
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
    addRecordPageUrl(
      enrichRecordResources(record, sampleLimit ?? 5),
      env.FINNA_UI_BASE,
    ),
  );
  const cleaned =
    selectedFields && !selectedFields.includes('recordUrl')
      ? enriched.map((record) => stripRecordUrl(record))
      : enriched;

  return json({
    result: {
      ...payload,
      records: cleaned,
    },
  });
}

async function handleListOrganizations(env: Env, args: unknown): Promise<Response> {
  const parsed = ListOrganizationsArgs.safeParse(args ?? {});
  if (!parsed.success) {
    return json({ error: 'invalid_params', details: parsed.error.format() }, 400);
  }
  const { query, type, lng, filters, max_depth, include_paths, compact } = parsed.data;
  const normalizedFilters = normalizeFilters(filters);
  const cacheLng = lng ?? 'fi';
  const cacheKey = buildOrganizationsCacheKey(cacheLng, type);
  const cached =
    env.FINNA_MCP_DISABLE_CACHE === '1'
      ? null
      : await readOrganizationsCache(env, cacheKey);
  if (cached) {
    if (!query && !normalizedFilters) {
      const depth = max_depth ?? 2;
      return json({
        result: finalizeOrganizations(
          compactOrganizations(
            pruneOrganizationsDepth(
              cached,
              depth,
              max_depth ? 'max_depth' : 'unfiltered',
            ),
            compact,
          ),
          include_paths,
        ),
      });
    }
    const filtered = filterOrganizationsPayload(cached, query, normalizedFilters);
    if (filtered) {
      return json({
        result: finalizeOrganizations(
          compactOrganizations(filtered, compact),
          include_paths,
        ),
      });
    }
  }
  const uiPayload = await fetchUiOrganizations(cacheLng, type, env.FINNA_UI_BASE);
  const filtered = filterOrganizationsPayload(uiPayload, query, normalizedFilters);
  if (env.FINNA_MCP_DISABLE_CACHE !== '1') {
    await writeOrganizationsCache(env, cacheKey, uiPayload);
  }
  let result = filtered ?? uiPayload;
  if (max_depth) {
    result = pruneOrganizationsDepth(result, max_depth, 'max_depth');
  } else if (!query && !normalizedFilters) {
    result = pruneOrganizationsDepth(result, 2, 'unfiltered');
  }
  result = compactOrganizations(result, compact);
  return json({ result: finalizeOrganizations(result, include_paths) });
}

async function fetchUiOrganizations(
  lng: string,
  type: string,
  uiBase?: string,
): Promise<Record<string, unknown>> {
  const url = new URL('/AJAX/JSON', uiBase ?? 'https://finna.fi');
  url.searchParams.set('lookfor', '');
  url.searchParams.set('type', type);
  url.searchParams.set('method', 'getSideFacets');
  url.searchParams.set('searchClassId', 'Solr');
  url.searchParams.set('location', 'side');
  url.searchParams.set('configIndex', '0');
  url.searchParams.set('querySuppressed', '0');
  url.searchParams.set('extraFields', 'handler,limit,selectedShards,sort,view');
  url.searchParams.append('enabledFacets[]', 'building');
  if (lng) {
    url.searchParams.set('lng', lng);
  }

  const payload = await fetchJson(url.toString());
  const html = findHtmlInAjaxPayload(payload);
  if (!html) {
    return { status: 'ERROR', facets: { building: [] } };
  }
  const tree = parseFacetTreeFromHtml(html);
  return { status: 'OK', resultCount: tree.length, facets: { building: tree } };
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

function mergeTopLevelFilters(
  filters: FilterInput | undefined,
  options: {
    available_online?: boolean;
    usage_rights?: string | string[];
    format?: string | string[];
    organization?: string | string[];
    language?: string | string[];
    year?: string | string[];
  },
): FilterInput | undefined {
  const merged: FilterInput = filters ? { ...filters } : {};
  merged.include = merged.include ? { ...merged.include } : {};

  if (options.available_online) {
    addFilterValues(merged.include, 'online_boolean', ['1']);
  }
  if (options.usage_rights) {
    addFilterValues(
      merged.include,
      'usage_rights_str_mv',
      coerceStringArray(options.usage_rights),
    );
  }
  if (options.format) {
    addFilterValues(merged.include, 'format', coerceStringArray(options.format));
  }
  if (options.organization) {
    addFilterValues(merged.include, 'building', coerceStringArray(options.organization));
  }
  if (options.language) {
    addFilterValues(merged.include, 'language', coerceStringArray(options.language));
  }
  if (options.year) {
    addFilterValues(merged.include, 'main_date_str', coerceStringArray(options.year));
  }

  return Object.keys(merged.include).length > 0 || merged.any || merged.exclude
    ? merged
    : undefined;
}

function coerceStringArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function addFilterValues(
  bucket: Record<string, string[]>,
  field: string,
  values: string[],
): void {
  if (values.length === 0) {
    return;
  }
  const existing = bucket[field] ?? [];
  const merged = new Set(existing);
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      merged.add(value);
    }
  }
  bucket[field] = Array.from(merged);
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
  if (field === 'organization') {
    return 'building';
  }
  if (field === 'content_type') {
    return 'format';
  }
  if (field === 'year') {
    return 'main_date_str';
  }
  return field;
}

function mapFilterValue(field: string, value: string): string {
  if (/%2f/i.test(value)) {
    const decoded = safeDecodeURIComponent(value);
    if (decoded) {
      value = decoded;
    }
  }
  if (isHierarchicalFacetField(field) && value.includes('/') && !value.endsWith('/')) {
    return `${value}/`;
  }
  if (field === 'format' && value.toLowerCase() === 'book') {
    return '0/Book/';
  }
  return value;
}

function safeDecodeURIComponent(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function normalizeBuildingFiltersWithCache(
  filters: FilterInput | undefined,
  env: Env,
  lng?: string,
): Promise<{ filters: FilterInput | undefined; info?: string; warnings: string[] }> {
  const warnings: string[] = [];
  if (!filters) {
    return { filters, warnings };
  }
  const buildingValues = collectHierarchicalFilterValues(filters);
  if (buildingValues.length === 0) {
    return { filters, warnings };
  }
  if (!env.CACHE_BUCKET) {
    return { filters, warnings };
  }
  const cacheKey = buildOrganizationsCacheKey(lng ?? 'fi', 'AllFields');
  const cached = await readOrganizationsCache(env, cacheKey);
  if (!cached) {
    return { filters, warnings };
  }
  const entries = collectFacetValues(cached.facets?.building);
  if (entries.length === 0) {
    return { filters, warnings };
  }
  const canonicalMap = new Map<string, string | null>();
  for (const value of entries) {
    const key = value.toLowerCase();
    if (!canonicalMap.has(key)) {
      canonicalMap.set(key, value);
    } else if (canonicalMap.get(key) !== value) {
      canonicalMap.set(key, null);
    }
  }
  const replacements: Array<{ from: string; to: string }> = [];
  const normalizeBucket = (bucket?: Record<string, string[]>) => {
    if (!bucket?.building) return;
    bucket.building = bucket.building.map((value) => {
      const direct = canonicalMap.get(value.toLowerCase());
      if (direct && direct !== value) {
        replacements.push({ from: value, to: direct });
        return direct;
      }
      if (direct === null) {
        warnings.push(
          `Building filter "${value}" matched multiple organization values; leaving as-is.`,
        );
      }
      return value;
    });
  };
  normalizeBucket(filters.include);
  normalizeBucket(filters.any);
  normalizeBucket(filters.exclude);

  const info =
    replacements.length > 0
      ? `Normalized building filter values to canonical case (${replacements
          .slice(0, 3)
          .map((entry) => `${entry.from} → ${entry.to}`)
          .join(', ')}${replacements.length > 3 ? ', …' : ''}).`
      : undefined;
  return { filters, info, warnings };
}

function collectHierarchicalFilterWarnings(filters?: FilterInput): string[] {
  if (!filters) return [];
  const values = collectHierarchicalFilterValues(filters);
  if (values.length === 0) return [];
  const warnings: string[] = [];
  const invalid = values.filter((value) => !value.includes('/'));
  if (invalid.length > 0) {
    warnings.push(
      'Hierarchical facet filters should use path IDs like "0/Book/" or "0/Helmet/".',
    );
  }
  const spaced = values.filter((value) => /\s/.test(value));
  if (spaced.length > 0) {
    warnings.push(
      'Hierarchical facet filter values should not contain spaces; use the facet value, not the display label.',
    );
  }
  return warnings;
}

function collectHierarchicalFilterValues(filters: FilterInput): string[] {
  const values: string[] = [];
  const collectFrom = (bucket?: Record<string, string[]>) => {
    if (!bucket) return;
    for (const [field, fieldValues] of Object.entries(bucket)) {
      if (!isHierarchicalFacetField(field)) continue;
      for (const value of fieldValues) {
        if (typeof value === 'string') {
          values.push(value);
        }
      }
    }
  };
  collectFrom(filters.include);
  collectFrom(filters.any);
  collectFrom(filters.exclude);
  return values;
}

function isHierarchicalFacetField(field: string): boolean {
  return HIERARCHICAL_FACET_FIELDS.has(field);
}

function collectFacetValues(entries: unknown, acc: string[] = []): string[] {
  if (!Array.isArray(entries)) {
    return acc;
  }
  for (const entry of entries) {
    const value = entry && typeof entry === 'object' ? entry.value : undefined;
    if (typeof value === 'string') {
      acc.push(value);
    }
    const children =
      entry && typeof entry === 'object' ? (entry as { children?: unknown }).children : undefined;
    if (children) {
      collectFacetValues(children, acc);
    }
  }
  return acc;
}

function buildHelpPayload(): Record<string, unknown> {
  const markdown = `# Finna MCP Help

## MCP server for Finna.fi's cultural and scientific material in Finland.
Finna.fi is a unified search across Finnish libraries, archives, and museums. It includes online items as well as material that may require on-site access.

Note that this MCP server is not an official Finna service.
More info: \`https://github.com/samuli/finna-mcp\`

## Usage examples
1) Online images from an organization
\`\`\`json
{"available_online": true, "format": "0/Image/", "organization": ["0/Helmet/"], "limit": 10}
\`\`\`

2) Books published in 2020–2025
\`\`\`json
{"format": "0/Book/", "year": "2020-2025", "limit": 10}
\`\`\`

3) Free-use online material
\`\`\`json
{"available_online": true, "usage_rights": ["usage_A"], "limit": 10}
\`\`\`

4) Recent additions from a library system
\`\`\`json
{"organization": ["0/Helmet/"], "sort": "newest", "limit": 10}
\`\`\`

5) Discover organization IDs
\`\`\`json
{"query": "Helsinki", "include_paths": true}
\`\`\`

6) Finnish + Swedish materials
\`\`\`json
{"language": ["fin", "swe"], "limit": 10}
\`\`\`

7) Restrict to a specific library consortium (Satakirjastot)
\`\`\`json
{"organization": ["0/SATAKIRJASTOT/"], "format": "0/Book/", "limit": 10}
\`\`\`

8) Restrict to a museum organization (Helsinki City Museum)
\`\`\`json
{"organization": ["0/HKM/"], "format": "0/Image/", "available_online": true, "limit": 10}
\`\`\`

9) Old photos of Helsinki (online + photos + year range)
\`\`\`json
{"available_online": true, "format": "0/Image/", "query": "Helsinki", "year": "1900-1950", "limit": 10}
\`\`\`

10) Online videos (any topic)
\`\`\`json
{"available_online": true, "format": "0/Video/", "limit": 10}
\`\`\`

11) New in Finna (recently added)
\`\`\`json
{"filters": {"include": {"first_indexed": ["[NOW-1MONTHS/DAY TO *]"]}}, "sort": "newest", "limit": 10}
\`\`\`

### Usage rights filter codes
- \`usage_A\` = Free use
- \`usage_B\` = Derivatives, also commercial
- \`usage_C\` = No derivatives, also commercial
- \`usage_D\` = Derivatives, non-commercial
- \`usage_E\` = No derivatives, non-commercial
- \`usage_F\` = Permission required / unknown

## Common record formats (examples)
Use these as examples and discover more via \`facets\` + \`facet[]=format\`.
- \`0/Book/\` — Books (all)
- \`0/Book/eBook/\` — E-books
- \`0/Book/BookSection/\` — Book sections / chapters
- \`0/Sound/\` — Sound recordings / audiobooks
- \`0/Video/\` — Video / film
- \`0/Image/\` — Images / photographs
- \`0/Map/\` — Maps
- \`0/Article/\` — Articles
- \`0/Journal/\` — Journals / periodicals
- \`0/PhysicalObject/\` — Physical objects
- \`0/MusicalScore/\` — Musical scores

## More information
- Finna overview: \`https://finna.fi/Content/about_finnafi\`
- About Finna: \`https://finna.fi/Content/about\`
- Participating organizations: \`https://finna.fi/Content/organisations\`
- More about Finna: \`https://finna.fi/Content/moreabout_finna\`
`;

  return { markdown };
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
  const { facets: omittedFacets, ...rest } = payload;
  void omittedFacets;
  return rest as Record<string, unknown>;
}

function normalizeSort(sort?: string): string | undefined {
  if (!sort) {
    return sort;
  }
  const normalized = sort.trim().toLowerCase();
  if (normalized === 'relevance') {
    return 'relevance,id asc';
  }
  if (normalized === 'newest' || normalized === 'newest_first' || normalized === 'latest') {
    return 'first_indexed desc';
  }
  if (normalized === 'oldest' || normalized === 'oldest_first' || normalized === 'earliest') {
    return 'first_indexed asc';
  }
  if (normalized === 'year_newest' || normalized === 'year newest') {
    return 'main_date_str desc';
  }
  if (normalized === 'year_oldest' || normalized === 'year oldest') {
    return 'main_date_str asc';
  }
  return sort;
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
  query: string,
  filters?: FilterInput,
): Record<string, unknown> | null {
  const facets = payload.facets as Record<string, unknown> | undefined;
  const entries = facets?.building;
  if (!Array.isArray(entries)) {
    return null;
  }
  if (!filters && !query) {
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
  const normalizedQuery = query.toLowerCase().trim();
  const variants = normalizedQuery ? buildLookforVariants(normalizedQuery) : [];
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

function pruneOrganizationsDepth(
  payload: Record<string, unknown>,
  maxDepth: number,
  reason: string,
): Record<string, unknown> {
  const facets = payload.facets as Record<string, unknown> | undefined;
  const entries = facets?.building;
  if (!Array.isArray(entries) || entries.length === 0 || maxDepth < 1) {
    return payload;
  }
  const { pruned, prunedCount } = pruneFacetEntriesDepth(entries, maxDepth, 0);
  return {
    ...payload,
    facets: {
      ...facets,
      building: pruned,
    },
    meta: {
      ...(payload.meta as Record<string, unknown> | undefined),
      pruned: true,
      prunedDepth: maxDepth,
      prunedCount,
      reason,
      hint:
        'Use max_depth for deeper levels or include_paths for clearer hierarchy labels.',
    },
  };
}

function finalizeOrganizations(
  payload: Record<string, unknown>,
  includePaths?: boolean,
): Record<string, unknown> {
  if (!includePaths) {
    return payload;
  }
  const facets = payload.facets as Record<string, unknown> | undefined;
  const entries = facets?.building;
  if (!Array.isArray(entries)) {
    return payload;
  }
  const enhanced = addFacetPaths(entries, []);
  return {
    ...payload,
    facets: {
      ...facets,
      building: enhanced,
    },
  };
}

function compactOrganizations(
  payload: Record<string, unknown>,
  compact?: boolean,
): Record<string, unknown> {
  if (!compact) {
    return payload;
  }
  const facets = payload.facets as Record<string, unknown> | undefined;
  const entries = facets?.building;
  if (!Array.isArray(entries)) {
    return payload;
  }
  const simplified = entries.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }
    const record = entry as Record<string, unknown>;
    return {
      value: record.value,
      label: record.label ?? record.translated,
      count: record.count,
    };
  });
  return {
    ...payload,
    facets: {
      ...facets,
      building: simplified,
    },
    meta: {
      ...(payload.meta as Record<string, unknown> | undefined),
      compact: true,
    },
  };
}

function addFacetPaths(entries: unknown[], ancestors: string[]): unknown[] {
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }
    const record = entry as Record<string, unknown>;
    const label =
      (typeof record.label === 'string' && record.label) ||
      (typeof record.translated === 'string' && record.translated) ||
      '';
    const pathParts = label ? [...ancestors, label] : [...ancestors];
    const children = record.children;
    const enhanced: Record<string, unknown> = { ...record };
    if (pathParts.length > 0) {
      enhanced.path = pathParts.join(' / ');
    }
    if (Array.isArray(children) && children.length > 0) {
      enhanced.children = addFacetPaths(children, pathParts);
    }
    return enhanced;
  });
}

function pruneFacetEntriesDepth(
  entries: unknown[],
  maxDepth: number,
  depth: number,
): { pruned: unknown[]; prunedCount: number } {
  let prunedCount = 0;
  const pruned = entries.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }
    const record = entry as Record<string, unknown>;
    const children = record.children;
    if (!Array.isArray(children) || children.length === 0) {
      return record;
    }
    if (depth >= maxDepth - 1) {
      prunedCount += children.length;
      const { children: omittedChildren, ...rest } = record;
      void omittedChildren;
      return rest;
    }
    const next = pruneFacetEntriesDepth(children, maxDepth, depth + 1);
    prunedCount += next.prunedCount;
    return {
      ...record,
      children: next.pruned,
    };
  });
  return { pruned, prunedCount };
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
  const translated = String(entry.translated ?? entry.label ?? '');
  const valueLower = value.toLowerCase();
  const translatedLower = translated.toLowerCase();
  const foldedValue = foldFinnish(valueLower);
  const foldedTranslated = foldFinnish(translatedLower);
  const foldedVariants = variants.map((variant) => foldFinnish(variant));
  const matchesLookfor =
    variants.length === 0
      ? true
      : variants.some(
          (variant) =>
            valueLower.includes(variant) || translatedLower.includes(variant),
        ) ||
        foldedVariants.some(
          (variant) =>
            foldedValue.includes(variant) || foldedTranslated.includes(variant),
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

function foldFinnish(value: string): string {
  return value.replace(/[äÄ]/g, 'a').replace(/[öÖ]/g, 'o').replace(/[åÅ]/g, 'a');
}

function findHtmlInAjaxPayload(payload: Record<string, unknown>): string | null {
  const candidates: string[] = [];
  const queue: unknown[] = [payload];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item) {
      continue;
    }
    if (typeof item === 'string') {
      if (item.includes('<') && item.length > 200) {
        candidates.push(item);
      }
      continue;
    }
    if (Array.isArray(item)) {
      queue.push(...item);
      continue;
    }
    if (typeof item === 'object') {
      for (const value of Object.values(item as Record<string, unknown>)) {
        queue.push(value);
      }
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

type UiFacetNode = {
  label: string;
  value?: string;
  count?: number;
  children?: UiFacetNode[];
};

function parseFacetTreeFromHtml(html: string): UiFacetNode[] {
  const tokens = html.match(/<[^>]+>|[^<]+/g) ?? [];
  const stack: Array<{ node: UiFacetNode; text: string[] }> = [];
  const roots: UiFacetNode[] = [];

  const pushNode = (node: UiFacetNode) => {
    if (stack.length === 0) {
      roots.push(node);
    } else {
      const parent = stack[stack.length - 1].node;
      if (!parent.children) {
        parent.children = [];
      }
      parent.children.push(node);
    }
  };

  for (const token of tokens) {
    if (token.startsWith('<')) {
      const lower = token.toLowerCase();
      if (lower.startsWith('<li')) {
        const node: UiFacetNode = { label: '' };
        const value =
          extractAttr(token, 'data-facet-value') ?? extractAttr(token, 'data-value');
        if (value) {
          node.value = value;
        }
        const countAttr = extractAttr(token, 'data-count');
        if (countAttr && /^\d+$/.test(countAttr)) {
          node.count = Number(countAttr);
        }
        stack.push({ node, text: [] });
        continue;
      }
      if (lower.startsWith('</li')) {
        const item = stack.pop();
        if (item) {
          const combined = decodeHtmlEntities(item.text.join(' '));
          const { label, count } = extractLabelAndCount(combined);
          item.node.label = item.node.label || label;
          if (count !== undefined && item.node.count === undefined) {
            item.node.count = count;
          }
          if (item.node.label || (item.node.children && item.node.children.length > 0)) {
            pushNode(item.node);
          }
        }
        continue;
      }
      if (stack.length > 0) {
        const node = stack[stack.length - 1].node;
        const value =
          extractAttr(token, 'data-facet-value') ?? extractAttr(token, 'data-value');
        if (value) {
          node.value = node.value ?? value;
        }
        const countAttr = extractAttr(token, 'data-count');
        if (countAttr && /^\d+$/.test(countAttr)) {
          node.count = node.count ?? Number(countAttr);
        }
        const titleAttr = extractAttr(token, 'data-title');
        if (titleAttr) {
          node.label = node.label || decodeHtmlEntities(titleAttr);
        }
        const hrefAttr = extractAttr(token, 'href');
        if (hrefAttr && !node.value) {
          const decoded = decodeHtmlEntities(hrefAttr);
          const extracted = extractBuildingValueFromHref(decoded);
          if (extracted) {
            node.value = extracted;
          }
        }
      }
      continue;
    }
    if (stack.length > 0) {
      const text = token.replace(/\s+/g, ' ').trim();
      if (text) {
        stack[stack.length - 1].text.push(text);
      }
    }
  }

  return roots;
}

function extractAttr(tag: string, name: string): string | null {
  const pattern = new RegExp(`${name}=["']([^"']+)["']`, 'i');
  const match = tag.match(pattern);
  return match ? match[1] : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractLabelAndCount(text: string): { label: string; count?: number } {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return { label: '' };
  }
  const matches = cleaned.match(/\b\d[\d\s]*\b/g) ?? [];
  if (matches.length === 0) {
    return { label: cleaned };
  }
  const last = matches[matches.length - 1];
  const count = Number(last.replace(/\s+/g, ''));
  const label = cleaned.replace(last, '').replace(/\s+/g, ' ').trim();
  return Number.isFinite(count) ? { label, count } : { label: cleaned };
}

function extractBuildingValueFromHref(href: string): string | null {
  try {
    const url = new URL(href, 'https://finna.fi');
    const filters = url.searchParams.getAll('filter[]');
    for (const filter of filters) {
      const match = filter.match(/building:"([^"]+)"/i);
      if (match) {
        return match[1];
      }
    }
  } catch {
    // ignore
  }
  const match = href.match(/building%3A%22([^%]+)%22/i);
  if (match) {
    return decodeURIComponent(match[1]);
  }
  return null;
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

function addRecordPageUrl(
  record: Record<string, unknown>,
  uiBase?: string,
): Record<string, unknown> {
  if (!record || typeof record !== 'object') {
    return record;
  }
  if (typeof record.recordUrl === 'string' && record.recordUrl) {
    return record;
  }
  const id = record.id;
  if (typeof id !== 'string' || !id) {
    return record;
  }
  const base = uiBase ?? 'https://finna.fi';
  const url = new URL(`/Record/${id}`, base).toString();
  return {
    ...record,
    recordUrl: url,
  };
}

function stripRecordUrl(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== 'object') {
    return record;
  }
  if (!('recordUrl' in record)) {
    return record;
  }
  const { recordUrl: omittedRecordUrl, ...rest } = record;
  void omittedRecordUrl;
  return rest;
}

function looksMultiTerm(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return false;
  }
  const unquoted = trimmed.replace(/"[^"]+"/g, '').trim();
  return /\s/.test(unquoted);
}

function buildSearchMeta(options: {
  query: string;
  search_mode?: string;
  fields_preset?: string;
  fields?: string[] | null;
  fieldsProvided: boolean;
  limit?: number;
  resultCount?: number;
  records: Record<string, unknown>[];
  extraInfo?: string;
  extraWarning?: string[];
}): Record<string, unknown> | null {
  const warnings: string[] = [];
  const info: string[] = [];
  const {
    query,
    search_mode,
    fields_preset,
    fields,
    fieldsProvided,
    limit,
    resultCount,
    records,
  } = options;
  const selectedFields = fields ?? resolveSearchFieldsPreset(fields_preset);
  const resourceFields = new Set(['images', 'urls', 'onlineUrls']);
  const includesResourceFields =
    (!fieldsProvided && selectedFields.some((field) => resourceFields.has(field)));
  const hasResourceData = records.some((record) => {
    const images = record.images;
    const urls = record.urls;
    const onlineUrls = record.onlineUrls;
    return (
      (Array.isArray(images) && images.length > 0) ||
      (Array.isArray(urls) && urls.length > 0) ||
      (Array.isArray(onlineUrls) && onlineUrls.length > 0)
    );
  });

  if (search_mode !== 'advanced' && looksMultiTerm(query)) {
    warnings.push(
      'Multi-term query detected; consider search_mode="advanced" with advanced_operator="AND" for better precision.',
    );
  }
  if (search_mode === 'advanced' && !looksMultiTerm(query)) {
    info.push('Advanced search used with a single term; simple mode may be faster.');
  }
  if (fields_preset && fields && fields.length > 0) {
    info.push('fields overrides fields_preset for returned fields.');
  }
  if (typeof resultCount === 'number' && resultCount === 0) {
    warnings.push(
      'No results. Consider search_mode="advanced", loosening filters, or trying a shorter query.',
    );
  }
  if (typeof resultCount === 'number' && limit && resultCount > limit * 100) {
    info.push(
      'Large result set. Consider narrowing with filters.include.building or filters.include.format.',
    );
  }
  if (includesResourceFields && records.length > 0 && !hasResourceData) {
    info.push(
      'No online resources found in these records; try fields_preset="full" or includeRawData for more source-specific links.',
    );
  }
  if (options.extraWarning && options.extraWarning.length > 0) {
    warnings.push(...options.extraWarning);
  }
  if (options.extraInfo) {
    info.push(options.extraInfo);
  }

  if (warnings.length === 0 && info.length === 0) {
    return null;
  }
  const meta: Record<string, unknown> = {};
  if (warnings.length > 0) {
    meta.warning = warnings.join(' ');
  }
  if (info.length > 0) {
    meta.info = info.join(' ');
  }
  return meta;
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

async function handleJsonRpc(
  body: JsonRpcRequest,
  env: Env,
  structuredOutput: boolean,
): Promise<Response> {
  const { id, method } = body;

  if (method === 'initialize') {
    return json(
      jsonRpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions:
          'Finna MCP server: a unified search across Finnish libraries, archives, and museums. Use search_records for items, list_organizations for organization IDs, and get_record for details. Prefer top-level helpers (available_online, usage_rights, format, organization, language, year) before raw filters.',
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
        200,
      );
    }

    const { name, arguments: args } = parsed.data;
    if (!toolNames.includes(name)) {
      return json(jsonRpcError(id, -32601, 'Method not found'), 200);
    }

    try {
      const result = await dispatchTool(name, args, env);
      const contentText = summarizeToolResult(name, result);
      return json(
        jsonRpcResult(
          id,
          buildToolOutput(name, result, contentText, structuredOutput),
        ),
      );
    } catch (error) {
      const message = errorMessage(error);
      return json(
        jsonRpcResult(
          id,
          buildToolErrorOutput(name, message, structuredOutput),
        ),
        200,
      );
    }
  }

  return json(jsonRpcError(id, -32601, 'Method not found'), 200);
}

const sseSessions = new Map<
  string,
  { controller: ReadableStreamDefaultController<Uint8Array> }
>();

function handleSseRequest(request: Request, structuredOutput: boolean): Response {
  const accept = request.headers.get('accept') ?? '';
  if (!accept.includes('text/event-stream')) {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const sessionId = crypto.randomUUID();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      sseSessions.set(sessionId, { controller });
      const endpointUrl = new URL(request.url);
      endpointUrl.searchParams.set('session', sessionId);
      if (structuredOutput) {
        endpointUrl.searchParams.set('structured_output', '1');
      }
      const payload = `event: endpoint\ndata: ${endpointUrl.toString()}\n\n`;
      controller.enqueue(encoder.encode(payload));
    },
    cancel() {
      sseSessions.delete(sessionId);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
}

async function handleSsePost(
  sessionId: string,
  body: unknown,
  env: Env,
  structuredOutput: boolean,
): Promise<Response> {
  try {
    const session = sseSessions.get(sessionId);
    if (!session) {
      return new Response('Session Not Found', { status: 404 });
    }

    const rpcParsed = JsonRpcRequestSchema.safeParse(body);
    if (!rpcParsed.success) {
      return json({ error: 'invalid_request' }, 400);
    }

    const response = await handleJsonRpc(rpcParsed.data, env, structuredOutput);
    const jsonBody = await response.text();
    const encoder = new TextEncoder();
    const message = `event: message\ndata: ${jsonBody}\n\n`;
    try {
      session.controller.enqueue(encoder.encode(message));
    } catch (error) {
      console.error('Failed to enqueue SSE message', error);
    }

    return new Response(null, { status: 202 });
  } catch (error) {
    console.error('Unhandled SSE post error', error);
    return json({ error: 'internal_error', message: errorMessage(error) }, 500);
  }
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

function buildToolOutput(
  name: ToolName,
  result: Record<string, unknown>,
  summary: string,
  structuredOutput: boolean,
): Record<string, unknown> {
  const wrapped = buildContentWrapper(name, summary, result);
  if (structuredOutput) {
    return {
      content: [{ type: 'text', text: wrapped.summary as string }],
      structuredContent: wrapped,
      isError: false,
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(wrapped) }],
    isError: false,
  };
}

function buildToolErrorOutput(
  name: ToolName,
  message: string,
  structuredOutput: boolean,
): Record<string, unknown> {
  const wrapped = buildContentWrapper(name, message, {
    error: 'upstream_error',
    message,
  });
  if (structuredOutput) {
    return {
      content: [{ type: 'text', text: wrapped.summary as string }],
      structuredContent: wrapped,
      isError: true,
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(wrapped) }],
    isError: true,
  };
}

function buildContentWrapper(
  name: ToolName,
  summary: string,
  result: Record<string, unknown>,
): Record<string, unknown> {
  void name;
  const wrapper: Record<string, unknown> = {
    summary,
    response: result,
  };
  return wrapper;
}

function summarizeToolResult(name: ToolName, result: Record<string, unknown> | null): string {
  if (!result || typeof result !== 'object') {
    return `${name}: ok`;
  }
  switch (name) {
    case 'search_records': {
      const resultCount = asNumber(result.resultCount);
      const records = asArray(result.records);
      const facets = asObject(result.facets);
      const facetKeys = facets ? Object.keys(facets) : [];
      const parts = ['search_records:'];
      if (resultCount !== null) {
        parts.push(`${resultCount} hits`);
      }
      if (records) {
        parts.push(`${records.length} returned`);
      }
      if (facetKeys.length > 0) {
        parts.push(`facets=${facetKeys.join(',')}`);
      }
      return parts.join(' ');
    }
    case 'get_record': {
      const records = asArray(result.records);
      const ids = records
        ? records
            .map((record) => (record && typeof record === 'object' ? record.id : null))
            .filter((id): id is string => typeof id === 'string')
        : [];
      const parts = ['get_record:'];
      parts.push(`${records ? records.length : 0} record(s)`);
      if (ids.length > 0) {
        parts.push(`ids=${ids.slice(0, 3).join(',')}${ids.length > 3 ? ',…' : ''}`);
      }
      return parts.join(' ');
    }
    case 'list_organizations': {
      const facets = asObject(result.facets);
      const building = facets ? asArray((facets as { building?: unknown }).building) : null;
      const resultCount = asNumber(result.resultCount);
      const count =
        building !== null
          ? building.length
          : resultCount !== null
            ? resultCount
            : 0;
      return `list_organizations: ${count} organization(s)`;
    }
    case 'extract_resources': {
      const resources = asArray(result.resources);
      return `extract_resources: ${resources ? resources.length : 0} record(s)`;
    }
    case 'help': {
      return 'help: ok';
    }
  }
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
    case 'help':
      return buildHelpPayload();
  }
}

async function unwrapResult(responsePromise: Promise<Response>): Promise<Record<string, unknown>> {
  const response = await responsePromise;
  const payload = (await response.json()) as Record<string, unknown>;
  return payload.result as Record<string, unknown>;
}
