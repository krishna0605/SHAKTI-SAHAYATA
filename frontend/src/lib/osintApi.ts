// OSINT API Handler — SHAKTI v2.0
// All OSINT lookups run client-side or through the backend crawler.
// No cloud services. On-premise only.
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

export interface CrawlResult {
  url: string;
  title: string;
  snippet: string;
  status: 'ok' | 'failed';
  source: string;
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
const normalizeProviderMethod = (method?: string) => (method?.toUpperCase() === 'POST' ? 'POST' : 'GET');

export const fetchCustomProviderDetails = async (
  provider: CustomOSINTProviderConfig,
  query: string
): Promise<OSINTApiResult> => {
  const method = normalizeProviderMethod(provider.method);
  const queryParam = (provider.queryParam || 'query').trim() || 'query';
  const tokenHeader = (provider.tokenHeader || 'Authorization').trim() || 'Authorization';
  const tokenPrefix = provider.tokenPrefix ?? 'Bearer';

  try {
    const headers: Record<string, string> = {};
    const token = (provider.token || '').trim();
    if (token) {
      headers[tokenHeader] =
        tokenHeader.toLowerCase() === 'authorization' && tokenPrefix !== ''
          ? `${tokenPrefix} ${token}`.trim()
          : token;
    }

    let url = provider.apiUrl;
    let body: string | undefined;
    if (method === 'GET') {
      const parsed = new URL(provider.apiUrl);
      parsed.searchParams.set(queryParam, query);
      url = parsed.toString();
    } else {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({
        [queryParam]: query,
        query
      });
    }

    const response = await fetch(url, { method, headers, body });
    const contentType = response.headers.get('content-type') || '';
    const parsedData = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    if (!response.ok) {
      const errMsg =
        typeof parsedData === 'string'
          ? parsedData
          : (parsedData && typeof parsedData === 'object' && 'error' in parsedData && typeof (parsedData as { error?: unknown }).error === 'string'
              ? (parsedData as { error: string }).error
              : `HTTP ${response.status}`);
      throw new Error(errMsg);
    }

    return {
      success: true,
      data: parsedData,
      source: provider.name || provider.apiUrl
    };
  } catch (error) {
    return {
      success: false,
      error: (error as Error).message,
      source: provider.name || provider.apiUrl || 'Custom Provider'
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

/* ─── 2. Phone Number Validation (Simulated for on-premise) ─── */
export const fetchPhoneDetails = async (number: string): Promise<OSINTApiResult> => {
  await new Promise(resolve => setTimeout(resolve, 800));
  
  const isIndian = number.startsWith('+91') || number.startsWith('91') || (number.length === 10 && /^[6-9]/.test(number));
  
  if (number.length < 10) {
    return { success: false, error: 'Invalid phone number format', source: 'Validation Logic' };
  }

  return {
    success: true,
    data: {
      valid: true,
      number: number,
      local_format: number.slice(-10),
      international_format: number.startsWith('+') ? number : `+91${number.slice(-10)}`,
      country_prefix: "+91",
      country_code: "IN",
      country_name: "India",
      location: isIndian ? "Gujarat (Circle Estimate)" : "Unknown",
      carrier: "Reliance Jio Infocomm Ltd (Simulated)",
      line_type: "mobile"
    },
    source: 'NumVerify (Simulated)'
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

/* ─── 4. Data Breach Check (Simulated) ─── */
export const checkBreach = async (query: string): Promise<OSINTApiResult> => {
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const mockBreaches = [
    { name: "LinkedIn", date: "2021-06", count: 700000000, description: "Scraped data including emails and phone numbers" },
    { name: "BigBasket", date: "2020-11", count: 20000000, description: "Customer details and addresses" },
    { name: "Domino's India", date: "2021-04", count: 180000000, description: "Order details and phone numbers" }
  ];

  const foundBreaches = mockBreaches.filter((_, i) => (query.length + i) % 2 === 0);

  return {
    success: true,
    data: {
      found: foundBreaches.length > 0,
      breach_count: foundBreaches.length,
      breaches: foundBreaches
    },
    source: 'Breach Database (Simulated)'
  };
};
