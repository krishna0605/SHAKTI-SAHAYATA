import React, { useEffect, useMemo, useState } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { settingsAPI } from '../lib/apis';
import {
  fetchIPDetails,
  fetchPhoneDetails,
  fetchDomainDetails,
  checkBreach,
  crawlUrls,
  fetchCustomProviderDetails
} from '../../lib/osintApi';
import type { OSINTApiResult, CrawlResult, CustomOSINTProviderConfig } from '../../lib/osintApi';

type BuiltInTab = 'phone' | 'ip' | 'social' | 'domain';
type Tab = BuiltInTab | string;

interface LinkResult {
  title: string;
  url: string;
  description: string;
}

interface OSINTResult {
  query: string;
  type: Tab;
  timestamp: string;
  summary: string;
  details: Record<string, unknown>;
  rawData: unknown;
  links: LinkResult[];
  crawls: CrawlResult[];
  source?: string;
}

interface TabItem {
  id: Tab;
  label: string;
  icon: string;
  provider?: CustomOSINTProviderConfig;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const formatValue = (value: unknown) => {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const prettifyJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const getDisplayDetails = (data: unknown): Record<string, unknown> => {
  if (isRecord(data)) return data;
  if (Array.isArray(data)) return { items: data, count: data.length };
  return { result: data };
};

const getPrimitiveSummaryRows = (details: Record<string, unknown>) =>
  Object.entries(details).filter(([, value]) =>
    value === null || ['string', 'number', 'boolean'].includes(typeof value)
  );

const normalizeProviderList = (settings: Record<string, unknown>): CustomOSINTProviderConfig[] => {
  const osint = isRecord(settings.osint) ? settings.osint : null;
  const rows = osint && Array.isArray(osint.providers) ? osint.providers : [];
  return rows
    .filter((row): row is Record<string, unknown> => isRecord(row))
    .map((row, index): CustomOSINTProviderConfig => ({
      id: typeof row.id === 'string' && row.id.trim() ? row.id : `custom_${index}`,
      name: typeof row.name === 'string' ? row.name.trim() : '',
      apiUrl: typeof row.apiUrl === 'string' ? row.apiUrl.trim() : '',
      token: typeof row.token === 'string' ? row.token : '',
      enabled: typeof row.enabled === 'boolean' ? row.enabled : true,
      method: row.method === 'POST' ? 'POST' : 'GET',
      queryParam: typeof row.queryParam === 'string' && row.queryParam.trim() ? row.queryParam : 'query',
      tokenHeader: typeof row.tokenHeader === 'string' && row.tokenHeader.trim() ? row.tokenHeader : 'Authorization',
      tokenPrefix: typeof row.tokenPrefix === 'string' ? row.tokenPrefix : 'Bearer'
    }))
    .filter((provider) => provider.enabled !== false && provider.name && provider.apiUrl);
};

const buildGenericSummary = (providerName: string, data: unknown) => {
  if (Array.isArray(data)) {
    return `${providerName} returned an array response with ${data.length} item(s).`;
  }
  if (isRecord(data)) {
    const keys = Object.keys(data);
    return `${providerName} returned JSON object with ${keys.length} field(s): ${keys.slice(0, 6).join(', ')}${keys.length > 6 ? ', ...' : ''}`;
  }
  if (typeof data === 'string') {
    return `${providerName} returned text response (${data.length} chars).`;
  }
  return `${providerName} returned a ${typeof data} response.`;
};

const JsonViewer: React.FC<{ data: unknown }> = ({ data }) => (
  <pre className="text-xs leading-5 text-slate-800 dark:text-slate-200 bg-slate-50 dark:bg-slate-900/60 rounded-lg border border-slate-200 dark:border-slate-700 p-4 overflow-auto max-h-[420px] whitespace-pre-wrap break-all">
    {prettifyJson(data)}
  </pre>
);

export const OSINT: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('phone');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<OSINTResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customProviders, setCustomProviders] = useState<CustomOSINTProviderConfig[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const settings = await settingsAPI.get();
        setCustomProviders(normalizeProviderList(settings));
      } catch {
        setCustomProviders([]);
      }
    })();
  }, []);

  const tabs = useMemo<TabItem[]>(() => ([
    { id: 'phone', label: 'Phone Lookup', icon: 'call' },
    { id: 'ip', label: 'IP Analysis', icon: 'dns' },
    { id: 'social', label: 'Social Media', icon: 'share' },
    { id: 'domain', label: 'Domain Info', icon: 'language' },
    ...customProviders.map((provider) => ({
      id: provider.id,
      label: provider.name,
      icon: 'api',
      provider
    }))
  ]), [customProviders]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab('phone');
      setQuery('');
      setResults(null);
      setError(null);
    }
  }, [activeTab, tabs]);

  const activeTabItem = tabs.find((tab) => tab.id === activeTab);

  const generateLinks = (type: Tab, q: string, provider?: CustomOSINTProviderConfig): LinkResult[] => {
    switch (type) {
      case 'phone':
        return [
          { title: 'TrueCaller Search', url: `https://www.truecaller.com/search/in/${q}`, description: 'Check number on TrueCaller' },
          { title: 'WhatsApp Check', url: `https://wa.me/${q.replace('+', '')}`, description: 'Direct WhatsApp link' },
          { title: 'Google Dork (Social)', url: `https://www.google.com/search?q=site:facebook.com+OR+site:instagram.com+OR+site:linkedin.com+"${q}"`, description: 'Search number on social media' },
          { title: 'Google Dork (Files)', url: `https://www.google.com/search?q=filetype:pdf+OR+filetype:xls+OR+filetype:csv+"${q}"`, description: 'Search number in public documents' },
        ];
      case 'ip':
        return [
          { title: 'VirusTotal', url: `https://www.virustotal.com/gui/ip-address/${q}`, description: 'Check for malware/threats' },
          { title: 'AbuseIPDB', url: `https://www.abuseipdb.com/check/${q}`, description: 'Check abuse reports' },
          { title: 'Shodan', url: `https://www.shodan.io/host/${q}`, description: 'IoT and port scan results' },
        ];
      case 'social':
        return [
          { title: 'Facebook', url: `https://www.facebook.com/${q}`, description: 'Facebook Profile' },
          { title: 'Instagram', url: `https://www.instagram.com/${q}`, description: 'Instagram Profile' },
          { title: 'Twitter/X', url: `https://twitter.com/${q}`, description: 'Twitter Profile' },
          { title: 'LinkedIn', url: `https://www.google.com/search?q=site:linkedin.com/in/+"${q}"`, description: 'LinkedIn Search' },
          { title: 'Sherlock (Github)', url: `https://github.com/sherlock-project/sherlock`, description: 'Use Sherlock tool for more' },
        ];
      case 'domain':
        return [
          { title: 'Whois Lookup', url: `https://www.whois.com/whois/${q}`, description: 'Domain registration info' },
          { title: 'DNS Dumpster', url: `https://dnsdumpster.com/`, description: 'DNS records and mapping' },
          { title: 'Subdomain Finder', url: `https://www.google.com/search?q=site:${q}-www.${q}`, description: 'Find subdomains via Google' },
          { title: 'Wayback Machine', url: `https://web.archive.org/web/*/${q}`, description: 'Historical view of site' },
        ];
      default:
        return provider
          ? [{ title: `${provider.name} Endpoint`, url: provider.apiUrl, description: 'Configured custom OSINT API endpoint' }]
          : [];
    }
  };

  const getInputLabel = (tabId: Tab) => {
    if (tabId === 'phone') return 'Phone Number';
    if (tabId === 'ip') return 'IP Address';
    if (tabId === 'social') return 'Username / Handle';
    if (tabId === 'domain') return 'Domain Name';
    return 'Query';
  };

  const getInputPlaceholder = (tabId: Tab) => {
    if (tabId === 'phone') return 'e.g., 9876543210';
    if (tabId === 'ip') return 'e.g., 8.8.8.8';
    if (tabId === 'social') return 'e.g., john_doe';
    if (tabId === 'domain') return 'e.g., example.com';
    return 'Enter value to search';
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setResults(null);
    setError(null);

    try {
      let details: Record<string, unknown> = {};
      let rawData: unknown = {};
      let summary = '';
      let apiResult: OSINTApiResult = { success: false, source: 'Unknown' };

      switch (activeTab) {
        case 'ip': {
          apiResult = await fetchIPDetails(query);
          if (!apiResult.success) throw new Error(apiResult.error);
          rawData = apiResult.data;
          details = getDisplayDetails(apiResult.data);
          const city = typeof details.city === 'string' ? details.city : '';
          const region = typeof details.region === 'string' ? details.region : '';
          const country = typeof details.country_name === 'string' ? details.country_name : '';
          const org = typeof details.org === 'string' ? details.org : '';
          summary = `IP located in ${[city, region, country].filter(Boolean).join(', ') || 'Unknown location'}. ISP: ${org || 'Unknown'}.`;
          break;
        }
        case 'phone': {
          apiResult = await fetchPhoneDetails(query);
          if (!apiResult.success) throw new Error(apiResult.error);
          rawData = apiResult.data;
          details = getDisplayDetails(apiResult.data);
          const country = typeof details.country_name === 'string' ? details.country_name : '';
          const carrier = typeof details.carrier === 'string' ? details.carrier : '';
          const location = typeof details.location === 'string' ? details.location : '';
          summary = `Phone Number Validated: ${country || 'Unknown'} (${carrier || 'Unknown'}). Location: ${location || 'Unknown'}.`;
          break;
        }
        case 'domain': {
          apiResult = await fetchDomainDetails(query);
          if (!apiResult.success) throw new Error(apiResult.error);
          rawData = apiResult.data;
          details = getDisplayDetails(apiResult.data);
          const registrar = typeof details.registrar === 'string' ? details.registrar : '';
          const status = typeof details.status === 'string' ? details.status : '';
          summary = `Domain: ${query}. Registrar: ${registrar || 'Unknown'}. Status: ${status || 'Unknown'}.`;
          break;
        }
        case 'social': {
          apiResult = await checkBreach(query);
          if (!apiResult.success) throw new Error(apiResult.error);
          rawData = apiResult.data;
          details = getDisplayDetails(apiResult.data);
          const found = typeof details.found === 'boolean' ? details.found : false;
          const breachCount = typeof details.breach_count === 'number' ? details.breach_count : 0;
          summary = found
            ? `ALERT: Query matched ${breachCount} breach dataset(s) in the configured provider response.`
            : 'No breach matches were returned by the configured provider.';
          break;
        }
        default: {
          const provider = customProviders.find((item) => item.id === activeTab);
          if (!provider) throw new Error('Selected custom OSINT provider is not available. Reload settings.');
          apiResult = await fetchCustomProviderDetails(provider, query);
          if (!apiResult.success) throw new Error(apiResult.error || 'Custom OSINT request failed');
          rawData = apiResult.data;
          details = getDisplayDetails(apiResult.data);
          summary = buildGenericSummary(provider.name, apiResult.data);
          break;
        }
      }

      const links = generateLinks(activeTab, query, activeTabItem?.provider);
      const crawls = await crawlUrls(links.map(link => link.url));

      setResults({
        query,
        type: activeTab,
        timestamp: new Date().toISOString(),
        summary,
        details,
        rawData,
        links,
        crawls,
        source: apiResult.source
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred during the search.';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const generatePDF = () => {
    if (!results) return;

    type AutoTableDoc = jsPDF & { lastAutoTable?: { finalY?: number } };
    const doc = new jsPDF() as AutoTableDoc;

    doc.setFontSize(22);
    doc.setTextColor(0, 51, 153);
    doc.text('SHAKTI HYBRID ANALYTICS', 105, 20, { align: 'center' });

    doc.setFontSize(16);
    doc.setTextColor(200, 0, 0);
    doc.text('CONFIDENTIAL - OSINT REPORT', 105, 30, { align: 'center' });

    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text(`Generated on: ${new Date(results.timestamp).toLocaleString()}`, 15, 45);
    doc.text(`Target: ${results.query}`, 15, 50);
    doc.text(`Type: ${String(results.type).toUpperCase()}`, 15, 55);
    if (results.source) doc.text(`Source: ${results.source}`, 15, 60);

    doc.setFontSize(14);
    doc.text('Executive Summary', 15, 75);
    doc.setFontSize(11);
    const splitSummary = doc.splitTextToSize(results.summary, 180);
    doc.text(splitSummary, 15, 85);

    const detailsBody = Object.entries(results.details).map(([key, value]) => [
      key.replace(/_/g, ' ').toUpperCase(),
      formatValue(value)
    ]);

    autoTable(doc, {
      startY: 100,
      head: [['Parameter', 'Value']],
      body: detailsBody.length > 0 ? detailsBody : [['RESPONSE', formatValue(results.rawData)]],
      theme: 'grid',
      headStyles: { fillColor: [0, 51, 153] },
    });

    let currentY = doc.lastAutoTable?.finalY || 100;
    if (results.crawls.length > 0) {
      doc.setFontSize(14);
      doc.text('Web Crawl Findings', 15, currentY + 15);
      const crawlData = results.crawls.map(c => [c.title, c.status.toUpperCase(), c.snippet, c.url]);
      autoTable(doc, {
        startY: currentY + 25,
        head: [['Source', 'Status', 'Snippet', 'URL']],
        body: crawlData,
        theme: 'grid',
        headStyles: { fillColor: [0, 51, 153] },
        columnStyles: {
          2: { cellWidth: 70, overflow: 'linebreak' },
          3: { cellWidth: 60, overflow: 'linebreak' }
        }
      });
      currentY = doc.lastAutoTable?.finalY || currentY + 25;
    }

    doc.setFontSize(14);
    doc.text('Investigation Links', 15, currentY + 15);

    const linkData = results.links.map(l => [l.title, l.description, l.url]);
    autoTable(doc, {
      startY: currentY + 25,
      head: [['Source', 'Description', 'URL']],
      body: linkData,
      theme: 'striped',
      headStyles: { fillColor: [50, 50, 50] },
      columnStyles: {
        2: { cellWidth: 80, overflow: 'linebreak' }
      }
    });

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Page ${i} of ${pageCount} - OFFICIAL USE ONLY`, 105, 290, { align: 'center' });
    }

    doc.save(`OSINT_Report_${results.query}.pdf`);
  };

  const primitiveRows = results ? getPrimitiveSummaryRows(results.details) : [];
  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-900 p-6 overflow-y-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">OSINT Tools</h1>
        <p className="text-slate-600 dark:text-slate-400">Open Source Intelligence Gathering & Analysis</p>
      </div>

      <div className="flex gap-4 mb-6 border-b border-slate-200 dark:border-slate-700 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={String(tab.id)}
            onClick={() => {
              setActiveTab(tab.id);
              setQuery('');
              setResults(null);
              setError(null);
            }}
            className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-medium'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <span className="material-symbols-outlined text-xl">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 mb-6">
        <form onSubmit={handleSearch} className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              {getInputLabel(activeTab)}
            </label>
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={getInputPlaceholder(activeTab)}
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              />
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                search
              </span>
            </div>
            {activeTabItem?.provider && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Custom provider: {activeTabItem.provider.method || 'GET'} {activeTabItem.provider.apiUrl}
              </p>
            )}
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={!query.trim() || loading}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
            >
              {loading ? (
                <>
                  <span className="animate-spin material-symbols-outlined text-xl">refresh</span>
                  Searching...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-xl">travel_explore</span>
                  Start Analysis
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-4 rounded-lg mb-6 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      {results && (
        <div className="bg-white dark:bg-slate-800 rounded-xl p-6 shadow-sm border border-slate-200 dark:border-slate-700 flex-1">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-green-500">check_circle</span>
              Investigation Report
            </h2>
            <button
              onClick={generatePDF}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined">picture_as_pdf</span>
              Download Report
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg border border-blue-100 dark:border-blue-800">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <h3 className="font-semibold text-blue-900 dark:text-blue-300">Executive Summary</h3>
                </div>
                <p className="text-slate-700 dark:text-slate-300">{results.summary}</p>
                {results.source && (
                  <p className="mt-2 text-xs text-blue-700 dark:text-blue-200">Source: {results.source}</p>
                )}
              </div>

              {results.crawls.length > 0 && (
                <div className="bg-white dark:bg-slate-900/60 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                  <h3 className="font-semibold text-slate-900 dark:text-white mb-3">Web Crawl Findings</h3>
                  <div className="space-y-3">
                    {results.crawls.map((crawl, idx) => (
                      <div key={`${crawl.url}-${idx}`} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                        <div className="flex items-center justify-between mb-1 gap-2">
                          <a href={crawl.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:underline break-all">
                            {crawl.title}
                          </a>
                          <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${crawl.status === 'ok' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'}`}>
                            {crawl.status.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400">{crawl.snippet}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {primitiveRows.length > 0 && (
                <div className="bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      <tr>
                        <th className="px-4 py-3 font-semibold">Parameter</th>
                        <th className="px-4 py-3 font-semibold">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {primitiveRows.map(([key, value]) => (
                        <tr key={key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="px-4 py-3 font-medium text-slate-600 dark:text-slate-400 capitalize">
                            {key.replace(/_/g, ' ')}
                          </td>
                          <td className="px-4 py-3 text-slate-900 dark:text-white font-mono break-all">
                            {formatValue(value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="bg-white dark:bg-slate-900/60 rounded-lg border border-slate-200 dark:border-slate-700 p-4">
                <h3 className="font-semibold text-slate-900 dark:text-white mb-3">JSON Response</h3>
                <JsonViewer data={results.rawData} />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-slate-900 dark:text-white mb-2">Investigation Tools</h3>
              <div className="grid gap-3">
                {results.links.map((link, idx) => (
                  <a
                    key={`${link.url}-${idx}`}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all group"
                  >
                    <div className="flex items-center justify-between mb-1 gap-2">
                      <span className="font-medium text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 break-all">
                        {link.title}
                      </span>
                      <span className="material-symbols-outlined text-slate-400 text-sm group-hover:text-blue-500">
                        open_in_new
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 break-all">{link.description}</p>
                  </a>
                ))}
                {results.links.length === 0 && (
                  <div className="p-3 rounded-lg border border-dashed border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                    No suggested links for this provider.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {!results && !loading && (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
          <span className="material-symbols-outlined text-6xl mb-4 opacity-20">travel_explore</span>
          <p className="text-lg">Select a tool and enter a query to begin OSINT analysis</p>
          <p className="text-sm mt-2">Custom API tabs appear here after you add them in Settings and save.</p>
        </div>
      )}
    </div>
  );
};
