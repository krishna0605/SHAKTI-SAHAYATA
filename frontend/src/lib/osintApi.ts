// OSINT API Handler — SHAKTI v2.0
// All operator-facing OSINT results must come from real backend/on-prem providers.
// If a provider is not configured, the API returns an explicit unavailable state.
import { apiClient, getAccessToken } from './apiClient';

export interface OSINTApiResult {
  success: boolean;
  data?: unknown;
  error?: string;
  source: string;
}

export interface CustomOSINTProviderConfig {
  id: string;
  name: string;
  apiUrl: string;
  token?: string;
  enabled?: boolean;
  method?: 'GET' | 'POST';
  queryParam?: string;
  tokenHeader?: string;
  tokenPrefix?: string;
}

export interface OSINTCapabilitiesResponse {
  crawl: boolean;
  phoneLookup: boolean;
  breachLookup: boolean;
  providers: {
    phone: {
      enabled: boolean;
      method: 'GET' | 'POST';
      provider?: string;
      resultType?: string;
    };
    breach: {
      enabled: boolean;
      method: 'GET' | 'POST';
      provider?: string;
      resultType?: string;
    };
  };
  customProviders: Array<{
    id: string;
    name: string;
    method: 'GET' | 'POST';
    enabled: boolean;
    resultType?: string;
  }>;
}

export interface CrawlResult {
  url: string;
  title: string;
  snippet: string;
  status: 'ok' | 'failed';
  source: string;
}

interface BackendLookupResult {
  success: boolean;
  data?: unknown;
  error?: string;
  source?: string;
}

/* ─── Resolve backend URL ─── */
const resolveBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL?.trim();

  if (typeof window === 'undefined') {
    return envUrl || 'http://localhost:3001';
  }

  const host = window.location.hostname;
  const isLanAccess = host !== 'localhost' && host !== '127.0.0.1';
  const envPointsToLocalhost = !!envUrl && /localhost|127\.0\.0\.1/i.test(envUrl);

  if (envUrl && !(isLanAccess && envPointsToLocalhost)) {
    return envUrl;
  }

  return `${window.location.protocol}//${host}:3001`;
};

const BASE_URL = resolveBaseUrl();

export const getOSINTCapabilities = async (): Promise<OSINTCapabilitiesResponse> => {
  const makeRequest = () => {
    const token = getAccessToken();
    return fetch(`${BASE_URL}/api/osint/capabilities`, {
      method: 'GET',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };

  let response = await makeRequest();
  if (response.status === 401 && await apiClient.refreshAccessToken(false)) {
    response = await makeRequest();
  }

  if (!response.ok) {
    throw new Error(`Failed to load OSINT capabilities (${response.status})`);
  }

  return response.json();
};

const postBackendLookup = async (endpoint: string, body: Record<string, unknown>): Promise<BackendLookupResult> => {
  const makeRequest = () => {
    const token = getAccessToken();
    return fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  };

  let response = await makeRequest();
  if (response.status === 401 && await apiClient.refreshAccessToken(false)) {
    response = await makeRequest();
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      success: false,
      error:
        typeof payload?.error === 'string'
          ? payload.error
          : `Request failed with status ${response.status}`,
      source: typeof payload?.source === 'string' ? payload.source : 'SHAKTI backend',
    };
  }

  return {
    success: Boolean(payload?.success ?? true),
    data: payload?.data,
    error: typeof payload?.error === 'string' ? payload.error : undefined,
    source: typeof payload?.source === 'string' ? payload.source : 'SHAKTI backend',
  };
};

/* ─── RDAP helper ─── */
const getRegistrar = (entities?: Array<{ vcardArray?: unknown }>): string => {
  const vcardArray = entities?.[0]?.vcardArray;
  if (!Array.isArray(vcardArray) || vcardArray.length < 2) return 'Unknown Registrar';
  const vcardEntries = vcardArray[1];
  if (!Array.isArray(vcardEntries) || vcardEntries.length < 2) return 'Unknown Registrar';
  const registrarEntry = vcardEntries[1];
  if (!Array.isArray(registrarEntry) || registrarEntry.length < 4) return 'Unknown Registrar';
  const registrar = registrarEntry[3];
  return typeof registrar === 'string' && registrar.trim() ? registrar : 'Unknown Registrar';
};

/* ─── URL Crawler (Backend) ─── */
export const crawlUrls = async (urls: string[]): Promise<CrawlResult[]> => {
  const uniqueUrls = Array.from(new Set(urls)).slice(0, 5);
  if (uniqueUrls.length === 0) return [];

  try {
    const makeRequest = () => {
      const token = getAccessToken();
      return fetch(`${BASE_URL}/api/osint/crawl`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ urls: uniqueUrls })
      });
    };

    let res = await makeRequest();
    if (res.status === 401 && await apiClient.refreshAccessToken(false)) {
      res = await makeRequest();
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data?.results) ? data.results : [];
  } catch (error) {
    return uniqueUrls.map((url) => ({
      url,
      title: url,
      snippet: (error as Error).message,
      status: 'failed',
      source: 'crawler'
    }));
  }
};

/* ─── Custom Provider Support ─── */
export const fetchCustomProviderDetails = async (
  providerId: string,
  query: string
): Promise<OSINTApiResult> => {
  try {
    const result = await postBackendLookup(`/api/osint/custom/${encodeURIComponent(providerId)}`, { query });

    return {
      success: result.success,
      data: result.data,
      error: result.error,
      source: result.source || providerId,
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      source: providerId || 'Custom Provider'
    };
  }
};

/* ─── 1. IP Geolocation (ipapi.co — No key required) ─── */
export const fetchIPDetails = async (ip: string): Promise<OSINTApiResult> => {
  try {
    const response = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!response.ok) throw new Error('IP API request failed');
    const data = await response.json();
    return { success: true, data, source: 'ipapi.co' };
  } catch (error) {
    return { success: false, error: (error as Error).message, source: 'ipapi.co' };
  }
};

/* ─── 2. Phone Number Validation (Backend/on-prem only) ─── */
export const fetchPhoneDetails = async (number: string): Promise<OSINTApiResult> => {
  const trimmed = number.trim();
  if (trimmed.length < 10) {
    return { success: false, error: 'Invalid phone number format', source: 'Validation Logic' };
  }

  const result = await postBackendLookup('/api/osint/phone', { query: trimmed });
  return {
    success: result.success,
    data: result.data,
    error: result.error,
    source: result.source || 'Phone lookup provider',
  };
};

/* ─── 3. Domain Info (RDAP/Whois — Real) ─── */
export const fetchDomainDetails = async (domain: string): Promise<OSINTApiResult> => {
  try {
    const response = await fetch(`https://rdap.org/domain/${domain}`);
    if (!response.ok) throw new Error('RDAP lookup failed');
    const data = (await response.json()) as {
      events?: Array<{ eventAction?: string; eventDate?: string }>;
      entities?: Array<{ vcardArray?: unknown }>;
      handle?: string;
      status?: string[];
    };
    
    const events = data.events?.map(e => `${e.eventAction ?? 'event'}: ${e.eventDate ?? 'unknown'}`).join(', ') || 'N/A';
    const registrar = getRegistrar(data.entities);

    return { 
      success: true, 
      data: {
        handle: data.handle,
        registrar: registrar,
        status: data.status?.join(', '),
        events: events,
        raw: data
      }, 
      source: 'RDAP (ICANN)' 
    };
  } catch (error) {
    return { success: false, error: (error as Error).message, source: 'RDAP' };
  }
};

/* ─── 4. Data Breach Check (Backend/on-prem only) ─── */
export const checkBreach = async (query: string): Promise<OSINTApiResult> => {
  const trimmed = query.trim();
  if (!trimmed) {
    return { success: false, error: 'Query is required', source: 'Breach lookup provider' };
  }

  const result = await postBackendLookup('/api/osint/breach', { query: trimmed });
  return {
    success: result.success,
    data: result.data,
    error: result.error,
    source: result.source || 'Breach lookup provider',
  };
};
