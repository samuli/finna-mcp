import { z } from 'zod';
import {
  buildSearchUrl,
  buildRecordUrl,
  buildCompactCreators,
  buildCompactLinks,
  enrichRecordResources,
  resolveFormatSummary,
  type FilterInput,
} from './finna.js';

type Env = {
  FINNA_API_BASE?: string;
  FINNA_UI_BASE?: string;
};

const HIERARCHICAL_FACET_FIELDS = new Set([
  'building',
  'format',
  'sector_str_mv',
  'category_str_mv',
]);
const DEFAULT_FACET_LIMIT = 30;

const toolNames = [
  'search_records',
  'get_record',
  'list_organizations',
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

// Output limits for derived fields
const LINKS_LIMIT = 3;
const CREATORS_LIMIT = 5;
const IMAGE_LIMIT = 2;

const SearchRecordsArgs = z.object({
  query: z.string().default(''),
  type: z.string().default('AllFields'),
  search_mode: z.enum(SEARCH_MODE_OPTIONS).optional(),
  advanced_operator: z.enum(ADVANCED_OPERATOR_OPTIONS).optional(),
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
  facet_limit: z.number().int().min(1).max(200).optional(),
  fields: z.array(z.string()).optional(),
});

const GetRecordArgs = z.object({
  ids: z.array(z.string()).min(1),
  lng: z.string().optional(),
  fields: z.array(z.string()).optional(),
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
              'Search keywords over metadata (Solr behind the scenes). Use short keywords, not long sentences. For multi-term OR/AND, use search_mode="advanced".',
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
              'Usage rights options: public_domain (Free use, no restrictions), open (Commercial use + derivatives allowed), commercial_noderivatives (Commercial use ok, no modifications), noncommercial (Derivatives ok, non-commercial only), noncommercial_noderivatives (Non-commercial, no modifications), restricted (Permission required or unknown).',
          },
          format: {
            type: ['string', 'array'],
            items: { type: 'string' },
            description:
              'Content types (top-level format codes). Use a string for one format, or an array for OR selection. Examples: "0/Book/", "0/Image/", ["0/Image/","0/Video/"]. Discover codes via facets=["format"].',
          },
          organization: {
            type: ['string', 'array'],
            items: { type: 'string' },
            description:
              'Organization IDs (Use list_organizations to discover. Always use exact VALUE strings like "0/Helmet/", NOT labels like "Helsinki Libraries").'
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
              'Publication/creation year filter: use a single year ("2024") or a range ("2020-2025"). Open-ended ranges like "2010-*" are supported.',
          },
          filters: {
            type: 'object',
            description:
              'Structured filters: {include:{field:[values]}, any:{field:[values]}, exclude:{field:[values]}}. Use exact VALUE codes from list_organizations or facets. Example: include.format=["0/Book/"], include.building=["0/Helmet/"]. Filter values are case-sensitive and must match exactly.',
          },
          facets: {
            type: 'array',
            items: { type: 'string' },
            description:
            'Facets to return (e.g., ["building", "format"]). If empty or omitted, no facets are returned. Note that facets (especially building) often returns lots of data. Use facet_limit to cap hierarchical facet values.'
          },
          facet_limit: {
            type: 'number',
            description: 'Max number of facet values to return for hierarchical facets (default 30).',
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Advanced: explicit record fields to return. Defaults include: id, title, description, type, format, year, creators, organization (summary), links, imageCount, recordUrl. Use get_record(ids=[...]) for full metadata.',
          },
        },
      },
    },
    {
      name: 'get_record',
      description: 'Get full metadata for one or more records.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: { type: 'array', items: { type: 'string' }, description: 'Record ID(s)' },
          lng: { type: 'string', description: 'Language code (e.g., "fi", "sv", "en")' },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Advanced: explicit fields to return (overrides default full output).',
          },
        },
        required: ['ids'],
      },
    },
    {
      name: 'list_organizations',
      description:
        'List organizations (e.g., libraries, museums, archives) that have material in Finna. Use only the returned code strings in search_records filters.include.organization (name/path are for display, not filtering). Unfiltered results return only the top 2 levels with meta.pruned=true; use query/filters for deeper levels.',
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
    if (url.pathname === '/spec') {
      return json(ListToolsResponse);
    }
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

const COMPACT_SEARCH_API_FIELDS = [
  'id',
  'title',
  'formats',
  'authors',
  'nonPresenterAuthors',
  'organizations',
  'year',
  'images',
  'onlineUrls',
  'urls',
  'summary',
  'recordUrl',
];

const FULL_RECORD_FIELDS = [
  'id',
  'title',
  'description',
  'type',
  'format',
  'recordUrl',
  'formats',
  'year',
  'links',
  'imageCount',
  'organizations',
  'subjects',
  'genres',
  'series',
  'authors',
  'nonPresenterAuthors',
  'publishers',
  'summary',
  'measurements',
];

function normalizeRequestedFields(fields: string[]): { apiFields: string[]; outputFields: string[] } {
  const apiFields: string[] = [];
  const outputFields: string[] = [];
  for (const field of fields) {
    if (field === 'organizations' || field === 'buildings') {
      apiFields.push('buildings');
      outputFields.push('organizations');
      continue;
    }
    if (field === 'organization') {
      apiFields.push('buildings');
      outputFields.push('organization');
      continue;
    }
    if (field === 'creators') {
      apiFields.push('authors', 'nonPresenterAuthors');
      outputFields.push('creators');
      continue;
    }
    if (field === 'description') {
      apiFields.push('summary');
      outputFields.push('description');
      continue;
    }
    if (field === 'links') {
      apiFields.push('images', 'onlineUrls', 'urls');
      outputFields.push('links');
      continue;
    }
    if (field === 'imageCount') {
      outputFields.push(field);
      continue;
    }
    if (field === 'type' || field === 'format') {
      apiFields.push('formats');
      outputFields.push(field);
      continue;
    }
    if (field === 'recordUrl') {
      outputFields.push('recordUrl');
      continue;
    }
    apiFields.push(field);
    outputFields.push(field);
  }
  return {
    apiFields: Array.from(new Set(apiFields)),
    outputFields: Array.from(new Set(outputFields)),
  };
}

function normalizeRecordOrganizations(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== 'object') {
    return record;
  }
  const organizations =
    (record as { organizations?: unknown }).organizations ??
    (record as { buildings?: unknown }).buildings;
  if (!organizations) {
    return record;
  }
  // Transform organization entries: value -> code, translated -> name
  const transformed = Array.isArray(organizations)
    ? organizations.map((org): unknown => {
        if (!org || typeof org !== 'object') {
          return org;
        }
        const { value, translated, ...rest } = org as Record<string, unknown>;
        return {
          code: value,
          name: translated,
          ...rest,
        };
      })
    : organizations;
  const { buildings, ...rest } = record as Record<string, unknown>;
  void buildings;
  return {
    ...rest,
    organizations: transformed,
  };
}

function buildOrganizationSummary(record: Record<string, unknown>): Record<string, unknown> | null {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const organizations = record.organizations;
  if (!Array.isArray(organizations) || organizations.length === 0) {
    return null;
  }
  const primary = organizations[0];
  const label =
    primary && typeof primary === 'object'
      ? String((primary as { name?: unknown }).name ?? '')
      : '';
  const code =
    primary && typeof primary === 'object'
      ? String((primary as { code?: unknown }).code ?? '')
      : '';
  const locationCount = Math.max(organizations.length - 1, 0);
  return {
    primary: label || undefined,
    code: code || undefined,
    locations: locationCount || undefined,
  };
}

function summarizeOrganizations(record: Record<string, unknown>): Record<string, unknown> {
  if (!record || typeof record !== 'object') {
    return record;
  }
  const summary = buildOrganizationSummary(record);
  if (!summary) {
    return record;
  }
  const { organizations: _omit, ...rest } = record;
  void _omit;
  return {
    ...rest,
    organization: summary,
  };
}

function pruneEmptyFields(record: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      // Recurse on array elements that are objects
      const prunedArray = value.map((item) =>
        item && typeof item === 'object' && !Array.isArray(item)
          ? pruneEmptyFields(item as Record<string, unknown>)
          : item
      );
      output[key] = prunedArray;
      continue;
    }
    if (value && typeof value === 'object') {
      // Recurse on nested objects
      const pruned = pruneEmptyFields(value as Record<string, unknown>);
      if (Object.keys(pruned).length === 0) {
        continue;
      }
      output[key] = pruned;
      continue;
    }
    if (value === null || value === undefined) {
      continue;
    }
    output[key] = value;
  }
  return output;
}

function buildCompactSearchRecord(
  record: Record<string, unknown>,
  options: { linksLimit: number; creatorsLimit: number; imageLimit: number },
): Record<string, unknown> {
  const summarized = summarizeOrganizations(record);
  const { type, format } = resolveFormatSummary(record);
  const creatorsResult = buildCompactCreators(record, options.creatorsLimit);
  const linksResult = buildCompactLinks(record, {
    limit: options.linksLimit,
    imageLimit: options.imageLimit,
  });
  const description = buildDescription(record, { mode: 'sentence' });
  const output: Record<string, unknown> = {
    id: summarized.id,
    title: summarized.title,
    type,
    format,
    year: summarized.year,
    description,
    creators: creatorsResult.creators,
    ...(creatorsResult.total > creatorsResult.creators.length
      ? { creatorsTotal: creatorsResult.total }
      : {}),
    organization: (summarized as { organization?: unknown }).organization,
    links: linksResult.links,
    ...(linksResult.total > linksResult.links.length ? { linksTotal: linksResult.total } : {}),
    ...(linksResult.imageCount ? { imageCount: linksResult.imageCount } : {}),
    recordUrl: summarized.recordUrl,
  };
  return pruneEmptyFields(output);
}

function applyDerivedFields(
  record: Record<string, unknown>,
  outputFields: string[],
  options: { linksLimit: number; creatorsLimit: number; imageLimit: number },
): Record<string, unknown> {
  let derived = record;
  if (outputFields.includes('organization')) {
    const summary = buildOrganizationSummary(record);
    if (summary) {
      derived = { ...derived, organization: summary };
    }
  }
  if (outputFields.includes('creators')) {
    const creatorsResult = buildCompactCreators(record, options.creatorsLimit);
    derived = {
      ...derived,
      creators: creatorsResult.creators,
      ...(creatorsResult.total > creatorsResult.creators.length
        ? { creatorsTotal: creatorsResult.total }
        : {}),
    };
  }
  if (outputFields.includes('links')) {
    const linksResult = buildCompactLinks(record, {
      limit: options.linksLimit,
      imageLimit: options.imageLimit,
    });
    derived = {
      ...derived,
      links: linksResult.links,
      ...(linksResult.total > linksResult.links.length ? { linksTotal: linksResult.total } : {}),
      ...(linksResult.imageCount ? { imageCount: linksResult.imageCount } : {}),
    };
  }
  if (outputFields.includes('format') || outputFields.includes('type')) {
    const summary = resolveFormatSummary(record);
    derived = {
      ...derived,
      ...(outputFields.includes('format') && summary.format ? { format: summary.format } : {}),
      ...(outputFields.includes('type') && summary.type ? { type: summary.type } : {}),
    };
  }
  if (outputFields.includes('description')) {
    const description = buildDescription(record, { mode: 'short' });
    if (description) {
      derived = { ...derived, description };
    }
  }
  return derived;
}

function pickFields(record: Record<string, unknown>, outputFields: string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const field of outputFields) {
    if (field in record) {
      picked[field] = (record as Record<string, unknown>)[field];
    }
  }
  return pruneEmptyFields(picked);
}

function buildDescription(
  record: Record<string, unknown>,
  options: { mode: 'sentence' | 'short' },
): string | undefined {
  const summary = (record as { summary?: unknown }).summary;
  const text = Array.isArray(summary) ? summary.find((item) => typeof item === 'string') : undefined;
  if (!text) {
    return undefined;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  if (options.mode === 'sentence') {
    const match = trimmed.match(/^[^.!?]+[.!?]/);
    if (match) {
      return match[0].trim();
    }
    return trimmed.length > 200 ? `${trimmed.slice(0, 200).trim()}…` : trimmed;
  }
  const max = 600;
  return trimmed.length > max ? `${trimmed.slice(0, max).trim()}…` : trimmed;
}

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
    facet_limit,
    fields,
  } = parsed.data;
  const useCompactOutput = fields === undefined;
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
  const normalizedSort = normalizeSort(sort);
  const selectedFields = useCompactOutput
    ? COMPACT_SEARCH_API_FIELDS
    : fields;
  const { apiFields, outputFields } = normalizeRequestedFields(selectedFields);

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
    facet_limit,
    fields: apiFields,
  });

  const payload = await fetchJson(url);
  const records = limit === 0 ? [] : getRecords(payload);
  const normalized =
    limit === 0
      ? []
      : records.map((record) =>
          normalizeRecordOrganizations(addRecordPageUrl(record, env.FINNA_UI_BASE)),
        );
  const compacted = useCompactOutput
    ? normalized.map((record) =>
        buildCompactSearchRecord(record, { linksLimit: LINKS_LIMIT, creatorsLimit: CREATORS_LIMIT, imageLimit: IMAGE_LIMIT }),
      )
    : normalized.map((record) =>
        pickFields(
          applyDerivedFields(record, outputFields, { linksLimit: LINKS_LIMIT, creatorsLimit: CREATORS_LIMIT, imageLimit: IMAGE_LIMIT }),
          outputFields,
        ),
      );
  const cleaned =
    outputFields && !outputFields.includes('recordUrl')
      ? compacted.map((record) => stripRecordUrl(record))
      : compacted;
  const meta = buildSearchMeta({
    query,
    search_mode,
    fields: outputFields,
    fieldsProvided: fields !== undefined,
    limit,
    resultCount: payload.resultCount,
    records: cleaned,
    requestedOnline: available_online === true || hasOnlineFilter(normalizedFilters),
    extraWarning: buildingWarnings,
  });

  const baseResult = stripFacetsIfUnused(payload, facets, facet_limit ?? DEFAULT_FACET_LIMIT);
  // Rename facet fields (value→code, label→name) for consistency
  const result = renameOrganizationFields(baseResult);

  return json({
    result: {
      ...result,
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
  const { ids, lng, fields } = parsed.data;
  const selectedFields = fields ?? FULL_RECORD_FIELDS;
  const { apiFields, outputFields } = normalizeRequestedFields(selectedFields);

  const url = buildRecordUrl({
    apiBase: env.FINNA_API_BASE,
    ids,
    lng,
    fields: apiFields,
  });

  const payload = await fetchJson(url);
  const records = getRecords(payload);
  const enriched = records.map((record) =>
    normalizeRecordOrganizations(
      addRecordPageUrl(enrichRecordResources(record), env.FINNA_UI_BASE),
    ),
  );
  const derived = enriched.map((record) =>
    pickFields(
      applyDerivedFields(record, outputFields, { linksLimit: LINKS_LIMIT, creatorsLimit: CREATORS_LIMIT, imageLimit: IMAGE_LIMIT }),
      outputFields,
    ),
  );
  const cleaned =
    outputFields && !outputFields.includes('recordUrl')
      ? derived.map((record) => stripRecordUrl(record))
      : derived;

  return json({
    result: {
      status: (payload as { status?: string }).status ?? 'OK',
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
  // Normalize 'value' → 'building' for organization filters
  const orgFilters = normalizeOrganizationFilters(normalizedFilters);

  // Use search API with building facet to get organizations
  const url = buildSearchUrl({
    apiBase: env.FINNA_API_BASE,
    lookfor: '',
    type,
    lng,
    facets: ['building'],
    facet_limit: 500,
    limit: 0,
  });

  const payload = await fetchJson(url) as {
    facets?: {
      building?: Array<{ value?: string; translated?: string; count?: number }>;
    };
  };

  // Transform API format to match FacetEntry structure
  const buildingEntries = (payload.facets?.building ?? [])
    .filter((entry) => entry.value && entry.translated)
    .map((entry) => ({
      value: entry.value!,
      label: entry.translated!,
      translated: entry.translated!,
    }));

  const apiPayload = {
    status: 'OK',
    resultCount: buildingEntries.length,
    facets: { building: buildingEntries },
  };

  const filtered = filterOrganizationsPayload(apiPayload, query, orgFilters);
  let result = filtered ?? apiPayload;

  if (max_depth) {
    result = pruneOrganizationsDepth(result, max_depth, 'max_depth');
  } else if (!query && !orgFilters) {
    result = pruneOrganizationsDepth(result, 1, 'unfiltered');
  }

  result = compactOrganizations(result, compact);
  const finalized = finalizeOrganizations(result, include_paths);
  // Rename value→code, label→name for consistency with get_record organizations
  const normalized = renameOrganizationFields(finalized);
  return json({ result: normalized });
}

// Rename value→code, label→name for all hierarchical facet entries
function renameOrganizationFields(payload: Record<string, unknown>): Record<string, unknown> {
  const facets = payload.facets as Record<string, unknown> | undefined;
  if (!facets || typeof facets !== 'object') {
    return payload;
  }

  const renameEntry = (entry: unknown): unknown => {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }
    const record = entry as Record<string, unknown>;
    const renamed: Record<string, unknown> = {};
    // Rename value → code
    if (typeof record.value === 'string') {
      renamed.code = record.value;
    }
    // Rename label/translated → name
    renamed.name = record.label ?? record.translated;
    // Keep other fields (count, children, path, etc.)
    for (const [key, value] of Object.entries(record)) {
      if (key !== 'value' && key !== 'label' && key !== 'translated') {
        renamed[key] = value;
      }
    }
    // Recursively rename children
    if (Array.isArray(record.children)) {
      renamed.children = record.children.map(renameEntry);
    }
    return renamed;
  };

  const renamedFacets: Record<string, unknown> = {};
  for (const [facetKey, facetValue] of Object.entries(facets)) {
    if (Array.isArray(facetValue)) {
      renamedFacets[facetKey] = facetValue.map(renameEntry);
    } else {
      renamedFacets[facetKey] = facetValue;
    }
  }

  return {
    ...payload,
    facets: renamedFacets,
  };
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

// For list_organizations, normalize 'value' filter key to 'building'
// since the building facet is what contains organizations
function normalizeOrganizationFilters(filters?: FilterInput): FilterInput | undefined {
  if (!filters) {
    return undefined;
  }
  const result: FilterInput = {};
  const mapBucket = (bucket?: Record<string, string[]>) => {
    if (!bucket) {
      return undefined;
    }
    const mapped: Record<string, string[]> = {};
    for (const [key, values] of Object.entries(bucket)) {
      // Map 'value' → 'building' for organization filters
      const mappedKey = key === 'value' ? 'building' : key;
      mapped[mappedKey] = values;
    }
    return Object.keys(mapped).length > 0 ? mapped : undefined;
  };

  if (filters.include) {
    const mapped = mapBucket(filters.include);
    if (mapped) {
      result.include = mapped;
    }
  }
  if (filters.any) {
    const mapped = mapBucket(filters.any);
    if (mapped) {
      result.any = mapped;
    }
  }
  if (filters.exclude) {
    const mapped = mapBucket(filters.exclude);
    if (mapped) {
      result.exclude = mapped;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
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
  merged.any = merged.any ? { ...merged.any } : {};

  if (options.available_online) {
    addFilterValues(merged.include, 'online_boolean', ['1']);
  }
  if (options.usage_rights) {
    addFilterValues(
      merged.include,
      'usage_rights_str_mv',
      normalizeUsageRightsValues(coerceStringArray(options.usage_rights)),
    );
  }
  if (options.format) {
    const values = coerceStringArray(options.format);
    const target = Array.isArray(options.format) ? merged.any : merged.include;
    addFilterValues(target, 'format', values);
  }
  if (options.organization) {
    addFilterValues(merged.include, 'building', coerceStringArray(options.organization));
  }
  if (options.language) {
    addFilterValues(merged.include, 'language', coerceStringArray(options.language));
  }
  if (options.year) {
    const normalizedYear = normalizeYearValues(coerceStringArray(options.year));
    if (normalizedYear.exact.length > 0) {
      addFilterValues(merged.include, 'main_date_str', normalizedYear.exact);
    }
    if (normalizedYear.ranges.length > 0) {
      addFilterValues(merged.include, 'search_daterange_mv', normalizedYear.ranges);
    }
  }

  return Object.keys(merged.include).length > 0 || merged.any || merged.exclude
    ? merged
    : undefined;
}

function coerceStringArray(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function normalizeYearValues(values: string[]): { exact: string[]; ranges: string[] } {
  const exact: string[] = [];
  const ranges: string[] = [];
  for (const raw of values) {
    if (typeof raw !== 'string') {
      continue;
    }
    const value = raw.trim();
    if (!value) {
      continue;
    }
    const upper = value.toUpperCase();
    if (upper.includes('TO') || value.startsWith('[') || value.endsWith(']')) {
      const wrapped = value.startsWith('[') ? value : `[${value}]`;
      ranges.push(wrapped);
      continue;
    }
    if (value.includes('-')) {
      const [startRaw = '', endRaw = ''] = value.split('-', 2);
      const start = startRaw.trim() || '*';
      const end = endRaw.trim() || '*';
      ranges.push(`[${start} TO ${end}]`);
      continue;
    }
    exact.push(value);
  }
  return { exact, ranges };
}

function normalizeUsageRightsValues(values: string[]): string[] {
  const map: Record<string, string> = {
    public_domain: 'usage_A',
    open: 'usage_B',
    commercial_noderivatives: 'usage_C',
    noncommercial: 'usage_D',
    noncommercial_noderivatives: 'usage_E',
    restricted: 'usage_F',
  };
  return values
    .filter((value) => typeof value === 'string')
    .map((value) => {
      const normalized = value.trim();
      if (!normalized) {
        return normalized;
      }
      const key = normalized.toLowerCase();
      return map[key] ?? normalized;
    })
    .filter((value) => value.length > 0);
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

type FacetEntry = { value: string; label: string; translated: string };

function collectFacetEntries(entries: unknown, acc: FacetEntry[] = []): FacetEntry[] {
  if (!Array.isArray(entries)) {
    return acc;
  }
  for (const entry of entries) {
    if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const value = typeof record.value === 'string' ? record.value : '';
      const label = typeof record.label === 'string' ? record.label : '';
      const translated = typeof record.translated === 'string' ? record.translated : '';
      if (value) {
        acc.push({ value, label, translated });
      }
      if (Array.isArray(record.children)) {
        collectFacetEntries(record.children, acc);
      }
    }
  }
  return acc;
}

function buildHelpPayload(): Record<string, unknown> {
  const markdown = `# Finna.fi

Finna.fi is a unified search across Finnish libraries, archives, and museums. It includes online items as well as material that may require on-site access.

Note that this [MCP server](https://github.com/samuli/finna-mcp) is not an official Finna service.

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
{"available_online": true, "usage_rights": ["public_domain"], "limit": 10}
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

## Usage rights options

The rights to use digital images and other material found on the Finna.fi search service varies. Always check the information on usage rights of the material and observe the terms. Read the instructions below to find out what the different rights of use on Finna are and how you can use the material.

The usage rights of materials descriptions and cover images of library materials are separately described [https://finna.fi/Content/terms](on this page).

### Usage rights options

- \`public_domain\` — Free use, no restrictions
- \`open\` — Commercial use + derivatives allowed
- \`commercial_noderivatives\` — Commercial use ok, no modifications
- \`noncommercial\` — Derivatives ok, non-commercial only
- \`noncommercial_noderivatives\` — Non-commercial, no modifications
- \`restricted\` — Permission required or unknown

## Common record formats (examples)
Use these as examples and discover more via \`facets\` + \`facet[]=format\`.
When requesting hierarchical facets (like \`building\` or \`format\`), you can cap the response with \`facet_limit\` (default 30).
- \`0/Book/\` — Books
- \`0/Sound/\` — Sound recordings / audiobooks
- \`0/Video/\` — Video / film
- \`0/Image/\` — Images / photographs
- \`0/Map/\` — Maps
- \`0/Article/\` — Articles
- \`0/Journal/\` — Journals / periodicals
- \`0/PhysicalObject/\` — Physical objects
- \`0/MusicalScore/\` — Musical scores

**Note**: Only top-level format codes (0/...) are supported. Use facets to discover all available format codes dynamically:
\`\`\`json
{"facets": ["format"], "facet_limit": 50, "limit": 0}
\`\`\`

## Record Field Descriptions

Note that metadata varies between records and formats.

### Organization Structure

Organizations use VALUE codes like:
- 0/Helmet/ - Helsinki Metropolitan Area Libraries
- 0/AALTO/ - Aalto University
- 0/HKM/ - Helsinki City Museum

**For filtering, always use the exact VALUE string (e.g., "0/Helmet/"), NOT the label.**

### Creators/People
- **creators** - Merged, compact creator list (name + role when available)
- **authors** - Detailed creator entries (advanced)
- **nonPresenterAuthors** - Additional creator entries (advanced)
Note: creators list is capped in compact results (default 5).

### Content
- **title** - Main title of the work
- **description** - Short description (first sentence in compact output)
- **type** - Human-readable type label (e.g., "Kirja", "CD")
- **format** - Top-level format code (e.g., "0/Book/")
- **summary** - Description or abstract (array, may have multiple entries)
- **subjects** - Topic keywords and classifications
- **genres** - Content type (fiction, documentary, etc.)

### Publication
- **year** - Publication/creation year (string)
- **humanReadablePublicationDates** - Formatted date strings
- **publishers** - Publishing organization(s)
- **series** - Series name if part of a collection

### Physical/Technical
- **measurements** - Size, duration, dimensions (format-specific)
- **languages** - ISO language codes (e.g., ["fin", "swe"])

### Access
- **organization** - Compact organization summary
- **organizations** - Full organization list (get_record)
- **recordUrl** - Link to full Finna record
- **links** - Unified list of online resources (pdf/image/audio/video/external)
- **imageCount** - Total number of images

## Troubleshooting

**No results with organization filter?**
→ Use exact VALUE codes like "0/HKM/" from list_organizations, NOT labels like "Helsinki City Museum"
→ Use facets=["building"] to verify valid building codes

**No results with format filter?**
→ Use exact top-level codes like "0/Book/", NOT hierarchical codes like "0/Book/eBook/"
→ Use facets=["format"] to discover all valid format codes

**Multi-term query warning?**
→ Try search_mode="advanced" with advanced_operator="AND"
→ Or shorten your query to 1-2 keywords

**Want to count results?**
→ Use limit=0 and read resultCount

## More information
- Finna overview: \`https://finna.fi/Content/about_finnafi\`
- About Finna: \`https://finna.fi/Content/about\`
- Participating organizations: \`https://finna.fi/Content/organisations\`
- More about Finna: \`https://finna.fi/Content/moreabout_finna\`
- More about usage rights: \'https://finna.fi/Content/terms\'
`;

  return { markdown };
}

function stripFacetsIfUnused(
  payload: Record<string, unknown>,
  requestedFacets?: string[] | null,
  facetLimit: number = DEFAULT_FACET_LIMIT,
): Record<string, unknown> {
  if (!requestedFacets || requestedFacets.length === 0) {
    if (!('facets' in payload)) {
      return payload;
    }
    const { facets: omittedFacets, ...rest } = payload;
    void omittedFacets;
    return rest as Record<string, unknown>;
  }
  const facets = payload.facets;
  if (!facets || typeof facets !== 'object') {
    return payload;
  }
  const facetMap = facets as Record<string, unknown>;
  const prunedFacets: Record<string, unknown> = { ...facetMap };
  let pruned = false;
  const prunedNames: string[] = [];
  for (const [name, values] of Object.entries(facetMap)) {
    if (!isHierarchicalFacetField(name)) {
      continue;
    }
    if (!Array.isArray(values) || values.length <= facetLimit) {
      continue;
    }
    const { items, truncated } = limitHierarchicalFacet(values, facetLimit);
    if (truncated) {
      pruned = true;
      prunedNames.push(name);
    }
    prunedFacets[name] = items;
  }
  const adjusted: Record<string, unknown> = { ...payload, facets: prunedFacets };
  if (pruned) {
    adjusted.meta = { ...(asObject(adjusted.meta) ?? {}), prunedFacets: prunedNames };
  }
  return adjusted;
}

function limitHierarchicalFacet(
  values: Record<string, unknown>[],
  limit: number,
): { items: Record<string, unknown>[]; truncated: boolean } {
  const total = values.length;
  if (total <= limit) {
    return { items: values, truncated: false };
  }
  const queue: Array<{ node: Record<string, unknown>; depth: number }> = values.map((node) => ({
    node,
    depth: 0,
  }));
  const grouped: Map<number, Array<Record<string, unknown>>> = new Map();
  while (queue.length > 0) {
    const current = queue.shift()!;
    const level = grouped.get(current.depth) ?? [];
    level.push(current.node);
    grouped.set(current.depth, level);
    const children = current.node.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (child && typeof child === 'object') {
          queue.push({ node: child as Record<string, unknown>, depth: current.depth + 1 });
        }
      }
    }
  }

  const levelKeys = Array.from(grouped.keys()).sort((a, b) => a - b);
  const picked: Record<string, unknown>[] = [];
  for (const depth of levelKeys) {
    const level = grouped.get(depth) ?? [];
    for (const node of level) {
      if (picked.length >= limit) {
        break;
      }
      picked.push(node);
    }
    if (picked.length >= limit) {
      break;
    }
  }
  return { items: picked, truncated: true };
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

function stripQuotedTerms(query: string): string {
  return query.replace(/"[^"]+"/g, '').trim();
}

function looksMultiTerm(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) {
    return false;
  }
  const unquoted = stripQuotedTerms(trimmed);
  return /\s/.test(unquoted);
}

function countQueryTerms(query: string): number {
  const trimmed = query.trim();
  if (!trimmed) {
    return 0;
  }
  const unquoted = stripQuotedTerms(trimmed);
  if (!unquoted) {
    return 0;
  }
  return unquoted.split(/\s+/).filter(Boolean).length;
}

function hasOnlineFilter(filters?: FilterInput): boolean {
  if (!filters) return false;
  const buckets = [filters.include, filters.any];
  for (const bucket of buckets) {
    if (!bucket) continue;
    const values = bucket.online_boolean;
    if (Array.isArray(values) && values.some((value) => value === '1')) {
      return true;
    }
  }
  return false;
}

function buildSearchMeta(options: {
  query: string;
  search_mode?: string;
  fields?: string[] | null;
  fieldsProvided: boolean;
  limit?: number;
  resultCount?: number;
  records: Record<string, unknown>[];
  requestedOnline?: boolean;
  extraInfo?: string;
  extraWarning?: string[];
}): Record<string, unknown> | null {
  const warnings: string[] = [];
  const info: string[] = [];
  const {
    query,
    search_mode,
    fields,
    fieldsProvided,
    limit,
    resultCount,
    records,
  } = options;
  const selectedFields = fields ?? COMPACT_SEARCH_API_FIELDS;
  const resourceFields = new Set(['images', 'urls', 'onlineUrls', 'links']);
  const includesResourceFields =
    (!fieldsProvided && selectedFields.some((field) => resourceFields.has(field)));
  const hasResourceData = records.some((record) => {
    const images = record.images;
    const urls = record.urls;
    const onlineUrls = record.onlineUrls;
    const links = record.links;
    return (
      (Array.isArray(images) && images.length > 0) ||
      (Array.isArray(urls) && urls.length > 0) ||
      (Array.isArray(onlineUrls) && onlineUrls.length > 0) ||
      (Array.isArray(links) && links.length > 0)
    );
  });

  const termCount = countQueryTerms(query);
  if (
    search_mode !== 'advanced' &&
    termCount >= 4 &&
    typeof resultCount === 'number' &&
    resultCount <= 5
  ) {
    info.push(
      'Multi-term query with few results; consider search_mode="advanced" with advanced_operator="AND" for more control.',
    );
  }
  if (search_mode === 'advanced' && !looksMultiTerm(query)) {
    info.push('Advanced search used with a single term; simple mode may be faster.');
  }
  if (typeof resultCount === 'number' && resultCount === 0) {
    warnings.push(
      'No results. Consider search_mode="advanced", loosening filters, or trying a shorter query.',
    );
  }
  if (typeof resultCount === 'number' && limit && resultCount > limit * 100) {
    info.push(
      'Large result set. Consider narrowing with filters.include.organization or filters.include.format.',
    );
  }
  if (options.requestedOnline && includesResourceFields && records.length > 0 && !hasResourceData) {
    info.push(
      'No online resources found in these records; try get_record(ids=[...]) for full metadata.',
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
    case 'help':
      return buildHelpPayload();
  }
}

async function unwrapResult(responsePromise: Promise<Response>): Promise<Record<string, unknown>> {
  const response = await responsePromise;
  const payload = (await response.json()) as Record<string, unknown>;
  return payload.result as Record<string, unknown>;
}
