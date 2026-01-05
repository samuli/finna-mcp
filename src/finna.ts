export type FilterInput = {
  include?: Record<string, string[]>;
  any?: Record<string, string[]>;
  exclude?: Record<string, string[]>;
};

type SearchParams = {
  apiBase?: string;
  lookfor: string;
  type: string;
  page?: number;
  limit?: number;
  sort?: string;
  lng?: string;
  filters?: FilterInput;
  facets?: string[];
  facetFilters?: string[];
  fields?: string[];
};

type RecordParams = {
  apiBase?: string;
  ids: string[];
  lng?: string;
  fields?: string[];
};

type FacetParams = {
  apiBase?: string;
  lookfor: string;
  type: string;
  lng?: string;
  filters?: FilterInput;
  facet: string;
};

const DEFAULT_API_BASE = 'https://api.finna.fi/v1';

export function buildSearchUrl(params: SearchParams): string {
  const url = new URL(`${baseUrl(params.apiBase)}/search`);
  url.searchParams.set('lookfor', params.lookfor);
  url.searchParams.set('type', params.type);
  if (params.page) {
    url.searchParams.set('page', String(params.page));
  }
  if (params.limit) {
    url.searchParams.set('limit', String(params.limit));
  }
  if (params.sort) {
    url.searchParams.set('sort', params.sort);
  }
  if (params.lng) {
    url.searchParams.set('lng', params.lng);
  }
  appendFields(url, params.fields);
  appendFilters(url, params.filters);
  appendFacets(url, params.facets);
  appendFacetFilters(url, params.facetFilters);
  return url.toString();
}

export function buildRecordUrl(params: RecordParams): string {
  const url = new URL(`${baseUrl(params.apiBase)}/record`);
  params.ids.forEach((id) => url.searchParams.append('id[]', id));
  if (params.lng) {
    url.searchParams.set('lng', params.lng);
  }
  appendFields(url, params.fields);
  return url.toString();
}

export function buildFacetUrl(params: FacetParams): string {
  const url = new URL(`${baseUrl(params.apiBase)}/search`);
  url.searchParams.set('lookfor', params.lookfor);
  url.searchParams.set('type', params.type);
  url.searchParams.set('limit', '0');
  if (params.lng) {
    url.searchParams.set('lng', params.lng);
  }
  url.searchParams.append('facet[]', params.facet);
  appendFilters(url, params.filters);
  return url.toString();
}

export function enrichRecordResources(record: Record<string, unknown>, sampleLimit: number) {
  const { resourceCounts, resourceSamples } = summarizeResources(record, sampleLimit);
  return {
    ...record,
    resourceCounts,
    resourceSamples,
  };
}

export function extractResourcesFromRecord(
  record: Record<string, unknown>,
  sampleLimit: number,
) {
  const { resources, resourceCounts } = summarizeResources(record, sampleLimit, true);
  return {
    id: record.id,
    resourceCounts,
    resources,
  };
}

type Resource = {
  type: string;
  url: string;
  label?: string | null;
};

function summarizeResources(
  record: Record<string, unknown>,
  sampleLimit: number,
  includeAll = false,
) {
  const resources = collectResources(record);
  const counts: Record<string, number> = {};
  for (const resource of resources) {
    counts[resource.type] = (counts[resource.type] ?? 0) + 1;
  }

  if (includeAll) {
    return { resources: resources.slice(0, sampleLimit), resourceCounts: counts, resourceSamples: [] };
  }

  const samples = takeSamples(resources, sampleLimit);
  return { resources, resourceCounts: counts, resourceSamples: samples };
}

function collectResources(record: Record<string, unknown>): Resource[] {
  const items: Resource[] = [];
  const images = Array.isArray(record.images) ? (record.images as string[]) : [];
  for (const image of images) {
    const url = normalizeImageUrl(image);
    items.push({ type: 'image', url, label: null });
  }

  const onlineUrls = Array.isArray(record.onlineUrls)
    ? (record.onlineUrls as Array<{ url?: string; label?: string }>)
    : [];
  for (const item of onlineUrls) {
    if (!item?.url) {
      continue;
    }
    items.push({ type: classifyUrl(item.url), url: item.url, label: item.label ?? null });
  }

  const urls = Array.isArray(record.urls)
    ? (record.urls as Array<{ url?: string; label?: string }>)
    : [];
  for (const item of urls) {
    if (!item?.url) {
      continue;
    }
    items.push({ type: classifyUrl(item.url), url: item.url, label: item.label ?? null });
  }

  return items;
}

function takeSamples(resources: Resource[], sampleLimit: number) {
  const buckets: Record<string, Resource[]> = {};
  for (const resource of resources) {
    const list = buckets[resource.type] ?? [];
    if (list.length < sampleLimit) {
      list.push(resource);
    }
    buckets[resource.type] = list;
  }
  return buckets;
}

function normalizeImageUrl(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  if (url.startsWith('/')) {
    return `https://api.finna.fi${url}`;
  }
  return url;
}

function classifyUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.match(/\.(jpg|jpeg|png|gif|tif|tiff|webp)(\?|$)/)) {
    return 'image';
  }
  if (lower.match(/\.(pdf)(\?|$)/)) {
    return 'pdf';
  }
  if (lower.match(/\.(mp3|wav|flac|ogg)(\?|$)/)) {
    return 'audio';
  }
  if (lower.match(/\.(mp4|mov|mkv|webm)(\?|$)/)) {
    return 'video';
  }
  return 'external';
}

function appendFields(url: URL, fields?: string[]) {
  if (!fields || fields.length === 0) {
    return;
  }
  fields.forEach((field) => url.searchParams.append('field[]', field));
}

function appendFacets(url: URL, facets?: string[]) {
  if (!facets || facets.length === 0) {
    return;
  }
  facets.forEach((facet) => url.searchParams.append('facet[]', facet));
}

function appendFacetFilters(url: URL, facetFilters?: string[]) {
  if (!facetFilters || facetFilters.length === 0) {
    return;
  }
  facetFilters.forEach((filter) => url.searchParams.append('facetFilter[]', filter));
}

function appendFilters(url: URL, filters?: FilterInput) {
  if (!filters) {
    return;
  }
  appendFilterGroup(url, filters.include, '');
  appendFilterGroup(url, filters.any, '~');
  appendFilterGroup(url, filters.exclude, '-');
}

function appendFilterGroup(url: URL, group: Record<string, string[]> | undefined, prefix: string) {
  if (!group) {
    return;
  }
  for (const [field, values] of Object.entries(group)) {
    for (const value of values) {
      url.searchParams.append('filter[]', `${prefix}${field}:"${value}"`);
    }
  }
}

function baseUrl(override?: string): string {
  const base = override ?? DEFAULT_API_BASE;
  return base.endsWith('/') ? base.slice(0, -1) : base;
}
