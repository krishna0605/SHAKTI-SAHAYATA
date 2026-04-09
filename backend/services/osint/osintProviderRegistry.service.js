import pool from '../../config/database.js';

const DEFAULT_TIMEOUT_MS = Math.max(3000, Math.min(30000, Number(process.env.OSINT_PROVIDER_TIMEOUT_MS || 12000)));

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const asRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

const normalizeMethod = (value) => (String(value || 'POST').trim().toUpperCase() === 'GET' ? 'GET' : 'POST');

const getBuiltinProviderConfig = (prefix, label, resultType) => {
  const url = String(process.env[`${prefix}_URL`] || '').trim();
  const explicitlyEnabled = parseBool(process.env[`${prefix}_ENABLED`], false);
  const enabled = explicitlyEnabled && Boolean(url);

  return {
    id: prefix.toLowerCase(),
    kind: prefix === 'OSINT_PHONE_PROVIDER' ? 'phone' : 'breach',
    label,
    enabled,
    url,
    method: normalizeMethod(process.env[`${prefix}_METHOD`]),
    queryParam: String(process.env[`${prefix}_QUERY_PARAM`] || 'query').trim() || 'query',
    token: String(process.env[`${prefix}_TOKEN`] || '').trim(),
    tokenHeader: String(process.env[`${prefix}_TOKEN_HEADER`] || 'Authorization').trim() || 'Authorization',
    tokenPrefix: process.env[`${prefix}_TOKEN_PREFIX`] ?? 'Bearer',
    resultType,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    live: enabled,
  };
};

const parseAppConfig = (value) => {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return asRecord(value);
};

const sanitizeCustomProvider = (provider, index) => {
  const row = asRecord(provider);
  const id = String(row.id || `custom_${index}`).trim();
  const name = String(row.name || '').trim();
  const apiUrl = String(row.apiUrl || '').trim();

  if (!name || !apiUrl) return null;

  return {
    id,
    kind: 'custom',
    label: name,
    enabled: row.enabled !== false,
    url: apiUrl,
    method: normalizeMethod(row.method),
    queryParam: String(row.queryParam || 'query').trim() || 'query',
    token: String(row.token || '').trim(),
    tokenHeader: String(row.tokenHeader || 'Authorization').trim() || 'Authorization',
    tokenPrefix: typeof row.tokenPrefix === 'string' ? row.tokenPrefix : 'Bearer',
    resultType: 'custom',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    live: row.enabled !== false,
  };
};

export const getCustomProviderConfigs = async () => {
  const result = await pool.query(
    `
      SELECT value
      FROM app_settings
      WHERE key = 'app_config'
      LIMIT 1
    `,
  );

  const appConfig = parseAppConfig(result.rows[0]?.value);
  const osint = asRecord(appConfig.osint);
  const providers = Array.isArray(osint.providers) ? osint.providers : [];

  return providers
    .map((provider, index) => sanitizeCustomProvider(provider, index))
    .filter(Boolean);
};

export const getOsintCapabilities = async () => {
  const phone = getBuiltinProviderConfig('OSINT_PHONE_PROVIDER', 'Phone lookup provider', 'phone_lookup');
  const breach = getBuiltinProviderConfig('OSINT_BREACH_PROVIDER', 'Breach lookup provider', 'breach_lookup');
  const customProviders = await getCustomProviderConfigs();

  return {
    crawl: true,
    phoneLookup: phone.enabled,
    breachLookup: breach.enabled,
    providers: {
      phone: {
        enabled: phone.enabled,
        method: phone.method,
        provider: phone.label,
        resultType: phone.resultType,
      },
      breach: {
        enabled: breach.enabled,
        method: breach.method,
        provider: breach.label,
        resultType: breach.resultType,
      },
    },
    customProviders: customProviders
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        id: provider.id,
        name: provider.label,
        method: provider.method,
        enabled: provider.enabled,
        resultType: provider.resultType,
      })),
  };
};

const buildProviderHeaders = (provider) => {
  const headers = {};
  if (provider.token) {
    headers[provider.tokenHeader] =
      provider.tokenHeader.toLowerCase() === 'authorization' && provider.tokenPrefix !== ''
        ? `${provider.tokenPrefix} ${provider.token}`.trim()
        : provider.token;
  }
  return headers;
};

const parseProviderBody = async (response) => {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
};

const inferMatches = (payload) => {
  if (Array.isArray(payload)) {
    return payload.map((item, index) => ({ id: index + 1, value: item }));
  }

  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.matches)) return payload.matches;
    if (Array.isArray(payload.results)) return payload.results;
    if (Array.isArray(payload.items)) return payload.items;
    return [payload];
  }

  if (payload === undefined || payload === null) return [];
  return [{ value: payload }];
};

const inferRawReferenceId = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  return payload.referenceId || payload.reference_id || payload.requestId || payload.request_id || payload.id || null;
};

const withTimeout = async (task, timeoutMs) => {
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(new Error('Provider request timed out')), timeoutMs);

  try {
    return await task(abortController.signal);
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const requestProvider = async ({ provider, query }) => {
  const headers = buildProviderHeaders(provider);
  let requestUrl = provider.url;
  let body;

  if (provider.method === 'GET') {
    const url = new URL(provider.url);
    url.searchParams.set(provider.queryParam, query);
    requestUrl = url.toString();
  } else {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify({
      [provider.queryParam]: query,
      query,
    });
  }

  const response = await withTimeout(
    (signal) => fetch(requestUrl, { method: provider.method, headers, body, signal }),
    provider.timeoutMs || DEFAULT_TIMEOUT_MS,
  );
  const payload = await parseProviderBody(response);

  if (!response.ok) {
    const message =
      typeof payload === 'string'
        ? payload
        : (payload && typeof payload === 'object' && typeof payload.error === 'string'
          ? payload.error
          : `${provider.label} request failed with status ${response.status}`);
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return payload;
};

export const buildNormalizedLookupPayload = ({ provider, query, payload }) => {
  const metadata = {
    provider: provider.label,
    providerId: provider.id,
    live: true,
    query,
    resultType: provider.resultType,
    fetchedAt: new Date().toISOString(),
    rawReferenceId: inferRawReferenceId(payload),
    matches: inferMatches(payload),
  };

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return {
      ...payload,
      ...metadata,
      raw: payload,
    };
  }

  return {
    ...metadata,
    raw: payload,
    value: payload,
  };
};

export const getBuiltinPhoneProvider = () =>
  getBuiltinProviderConfig('OSINT_PHONE_PROVIDER', 'Phone lookup provider', 'phone_lookup');

export const getBuiltinBreachProvider = () =>
  getBuiltinProviderConfig('OSINT_BREACH_PROVIDER', 'Breach lookup provider', 'breach_lookup');

export const getCustomProviderById = async (providerId) => {
  const providers = await getCustomProviderConfigs();
  return providers.find((provider) => provider.id === providerId && provider.enabled) || null;
};

export const executeProviderLookup = async ({ provider, query }) => {
  const payload = await requestProvider({ provider, query });
  return buildNormalizedLookupPayload({ provider, query, payload });
};
