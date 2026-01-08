export type FilterInput = {
  include?: Record<string, string[]>;
  any?: Record<string, string[]>;
  exclude?: Record<string, string[]>;
};

type SearchParams = {
  apiBase?: string;
  lookfor: string;
  type: string;
  searchMode?: 'simple' | 'advanced';
  advancedOperator?: 'AND' | 'OR';
  page?: number;
  limit?: number;
  sort?: string;
  lng?: string;
  filters?: FilterInput;
  facets?: string[];
  facetFilters?: string[];
  facet_limit?: number;
  fields?: string[];
};

type RecordParams = {
  apiBase?: string;
  ids: string[];
  lng?: string;
  fields?: string[];
};

const DEFAULT_API_BASE = 'https://api.finna.fi/v1';

export function buildSearchUrl(params: SearchParams): string {
  const url = new URL(`${baseUrl(params.apiBase)}/search`);
  const lookfor = params.lookfor ?? '';
  if (params.searchMode === 'advanced' && lookfor.trim()) {
    appendAdvancedSearch(url, lookfor, params.type, params.advancedOperator);
  } else {
    url.searchParams.set('lookfor', lookfor);
    url.searchParams.set('type', params.type);
  }
  if (params.page) {
    url.searchParams.set('page', String(params.page));
  }
  if (params.limit !== undefined) {
    url.searchParams.set('limit', String(params.limit));
  }
  if (params.sort) {
    url.searchParams.set('sort', params.sort);
  }
  if (params.lng) {
    url.searchParams.set('lng', params.lng);
  }
  if (params.facet_limit) {
    url.searchParams.set('facetLimit', String(params.facet_limit));
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

type WebSearchParams = Omit<SearchParams, 'apiBase' | 'fields' | 'facet_limit'> & {
  uiBase?: string;
};

export function buildSearchWebUrl(params: WebSearchParams): string {
  const base = params.uiBase ?? 'https://www.finna.fi';
  const url = new URL('/search', base);
  const lookfor = params.lookfor ?? '';
  if (params.searchMode === 'advanced' && lookfor.trim()) {
    appendAdvancedSearch(url, lookfor, params.type, params.advancedOperator);
  } else {
    url.searchParams.set('lookfor', lookfor);
    url.searchParams.set('type', params.type);
  }
  if (params.page) {
    url.searchParams.set('page', String(params.page));
  }
  if (params.limit !== undefined) {
    url.searchParams.set('limit', String(params.limit));
  }
  if (params.sort) {
    url.searchParams.set('sort', params.sort);
  }
  if (params.lng) {
    url.searchParams.set('lng', params.lng);
  }
  // Web UI uses same filter format as API
  appendFilters(url, params.filters);
  // Request facets to be displayed in web UI
  if (params.facets && params.facets.length > 0) {
    params.facets.forEach((facet) => url.searchParams.append('facet[]', facet));
  }
  // Facet filters for drilling down
  if (params.facetFilters && params.facetFilters.length > 0) {
    params.facetFilters.forEach((filter) => url.searchParams.append('facet[]', filter));
  }
  return url.toString();
}

export function enrichRecordResources(record: Record<string, unknown>) {
  const withImages = normalizeRecordImages(record);
  const { resourceCounts, resourceSamples } = summarizeResources(withImages, 3);
  const contributors = buildContributors(record);
  const merged = {
    ...withImages,
    resourceCounts,
    resourceSamples,
  };
  if (contributors.length > 0) {
    merged.contributors = contributors;
  }
  return pruneEmptyFields(merged);
}

type CompactLink = {
  url: string;
  type?: string;
  label?: string;
};

export function buildCompactLinks(
  record: Record<string, unknown>,
  options: { limit: number; imageLimit: number },
): { links: CompactLink[]; total: number; imageCount?: number } {
  const resources = collectResources(record);
  const seen = new Map<string, CompactLink>();
  let imageCount = 0;
  for (const resource of resources) {
    const url = resource.url;
    if (!url) {
      continue;
    }
    const normalized = normalizeUrlForDedup(url);
    if (seen.has(normalized.key)) {
      continue;
    }
    const link: CompactLink = { url: normalized.url };
    if (resource.type && resource.type !== 'external') {
      link.type = resource.type;
    }
    if (resource.label) {
      link.label = resource.label ?? undefined;
    }
    seen.set(normalized.key, link);
    if (resource.type === 'image') {
      imageCount += 1;
    }
  }
  const links = Array.from(seen.values()).sort((a, b) => {
    return resourceTypePriority(a.type) - resourceTypePriority(b.type);
  });

  const filtered: CompactLink[] = [];
  let imageUsed = 0;
  for (const link of links) {
    if (link.type === 'image') {
      if (imageUsed >= options.imageLimit) {
        continue;
      }
      imageUsed += 1;
    }
    filtered.push(link);
  }

  const total = filtered.length;
  if (options.limit > 0 && filtered.length > options.limit) {
    return {
      links: filtered.slice(0, options.limit),
      total: filtered.length,
      ...(imageCount > 0 ? { imageCount } : {}),
    };
  }
  return {
    links: filtered,
    total,
    ...(imageCount > 0 ? { imageCount } : {}),
  };
}

export function buildCompactCreators(
  record: Record<string, unknown>,
  limit: number,
): { creators: string[]; total: number } {
  const contributors = buildContributors(record);
  const creators: string[] = [];
  for (const contributor of contributors) {
    if (!contributor.name) {
      continue;
    }
    let role = contributor.role;
    if (role) {
      const split = role.split(/[,;/]/).map((entry) => entry.trim()).filter(Boolean);
      role = split.length > 0 ? split[0] : role;
      const hasPunctuation = role.includes('.');
      const isShortCode = /^[a-z]{1,3}$/.test(role);
      if (isShortCode && !hasPunctuation) {
        role = undefined;
      }
    }
    const label = role ? `${contributor.name} (${role})` : contributor.name;
    creators.push(label);
    if (limit > 0 && creators.length >= limit) {
      break;
    }
  }
  return { creators, total: contributors.length };
}

export function resolveFormatSummary(
  record: Record<string, unknown>,
): { format?: string; type?: string } {
  const formats = Array.isArray(record.formats) ? record.formats : [];
  if (formats.length === 0) {
    return {};
  }
  let formatCode: string | undefined;
  let typeLabel: string | undefined;
  for (const entry of formats) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const value = typeof (entry as { value?: unknown }).value === 'string'
      ? String((entry as { value?: unknown }).value)
      : '';
    const translated = typeof (entry as { translated?: unknown }).translated === 'string'
      ? String((entry as { translated?: unknown }).translated)
      : '';
    if (!formatCode && value.startsWith('0/')) {
      formatCode = value;
    }
    if (translated) {
      typeLabel = translated;
    }
  }
  if (!formatCode) {
    const fallback = formats[0];
    if (fallback && typeof fallback === 'object') {
      const value = (fallback as { value?: unknown }).value;
      if (typeof value === 'string') {
        formatCode = value;
      }
    }
  }
  return {
    format: formatCode || undefined,
    type: typeLabel || undefined,
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

type Contributor = {
  name: string;
  role?: string;
  type?: string;
};

function buildContributors(record: Record<string, unknown>): Contributor[] {
  const sources: unknown[] = [];
  if (Array.isArray(record.authors)) {
    sources.push(...record.authors);
  }
  if (Array.isArray(record.nonPresenterAuthors)) {
    sources.push(...record.nonPresenterAuthors);
  }
  const seen = new Set<string>();
  const contributors: Contributor[] = [];
  for (const item of sources) {
    const contributor = normalizeContributor(item);
    if (!contributor) {
      continue;
    }
    const key = `${contributor.name}|${contributor.role ?? ''}|${contributor.type ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    contributors.push(contributor);
  }
  return contributors;
}

function normalizeContributor(item: unknown): Contributor | null {
  if (typeof item === 'string') {
    const name = item.trim();
    return name ? { name } : null;
  }
  if (!item || typeof item !== 'object') {
    return null;
  }
  const record = item as Record<string, unknown>;
  const rawName =
    (typeof record.name === 'string' && record.name) ||
    (typeof record.name_alt === 'string' && record.name_alt) ||
    (typeof record.author === 'string' && record.author) ||
    (typeof record.title === 'string' && record.title) ||
    '';
  const name = rawName.trim();
  if (!name) {
    return null;
  }
  const role = typeof record.role === 'string' && record.role ? record.role : undefined;
  const type = typeof record.type === 'string' && record.type ? record.type : undefined;
  return { name, role, type };
}

function pruneEmptyFields(record: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      output[key] = value;
      continue;
    }
    if (value && typeof value === 'object') {
      if (Object.keys(value as Record<string, unknown>).length === 0) {
        continue;
      }
      output[key] = value;
      continue;
    }
    if (value === null || value === undefined) {
      continue;
    }
    output[key] = value;
  }
  return output;
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

type NormalizedUrl = {
  key: string;
  url: string;
};

function normalizeUrlForDedup(url: string): NormalizedUrl {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    const host = parsed.host.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, '');
    const params = parsed.searchParams;
    const kept = new URLSearchParams();
    for (const [key, value] of params.entries()) {
      if (key.toLowerCase().startsWith('utm_')) {
        continue;
      }
      kept.append(key, value);
    }
    parsed.search = kept.toString() ? `?${kept.toString()}` : '';
    const key = `${parsed.protocol}//${host}${path}${
      parsed.search ? `?${kept.toString()}` : ''
    }`;
    return { key, url: parsed.toString() };
  } catch {
    const trimmed = url.trim();
    return { key: trimmed, url: trimmed };
  }
}

function resourceTypePriority(type?: string): number {
  switch (type) {
    case 'pdf':
      return 1;
    case 'image':
      return 2;
    case 'audio':
      return 3;
    case 'video':
      return 4;
    default:
      return 5;
  }
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

function normalizeRecordImages(record: Record<string, unknown>): Record<string, unknown> {
  const images = Array.isArray(record.images) ? (record.images as string[]) : null;
  if (!images || images.length === 0) {
    return record;
  }
  return {
    ...record,
    images: images.map((image) => (typeof image === 'string' ? normalizeImageUrl(image) : image)),
  };
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

function appendAdvancedSearch(
  url: URL,
  lookfor: string,
  type: string,
  operator?: 'AND' | 'OR',
) {
  const join = operator ?? 'AND';
  const terms = splitAdvancedTerms(lookfor);
  if (terms.length === 0) {
    url.searchParams.set('lookfor', lookfor);
    url.searchParams.set('type', type);
    return;
  }
  url.searchParams.set('join', join);
  terms.forEach((term, index) => {
    url.searchParams.append('lookfor0[]', term);
    url.searchParams.append('type0[]', type);
    if (index > 0) {
      url.searchParams.append('bool0[]', join);
    }
  });
}

function splitAdvancedTerms(query: string): string[] {
  const terms: string[] = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(query)) !== null) {
    const term = (match[1] ?? match[2] ?? '').trim();
    if (term) {
      terms.push(term);
    }
  }
  return terms;
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
