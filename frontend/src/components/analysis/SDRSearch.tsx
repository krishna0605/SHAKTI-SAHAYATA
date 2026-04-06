import React, { useState } from 'react';
import { sdrAPI } from '../lib/apis';

type SDRData = Record<string, string | number | null | undefined>;

interface SDRRecord {
  id: string;
  subscriber_name: string;
  father_husband_name: string;
  permanent_address: string;
  local_address: string;
  telephone_number: string;
  poi_no: string;
  poi_name: string;
  poa_no: string;
  poa_name: string;
  date_of_activation: string;
  date_of_birth: string;
  gender: string;
  nationality: string;
  email_id: string;
  alternate_phone_no: string;
  installation_date: string;
  connection_type: string;
  point_of_sale: string;
  data?: SDRData;
  source_file: string;
  created_at: string;
}

interface SDRSearchProps {
  caseId?: string;
}

export const SDRSearch: React.FC<SDRSearchProps> = ({ caseId }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SDRRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const searchResults = await sdrAPI.search(query.trim(), caseId);
      setResults(searchResults as unknown as SDRRecord[]);
    } catch (err) {
      console.error('Search error:', err);
      setError('Failed to perform search. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    try {
      return new Date(dateStr).toLocaleDateString('en-GB');
    } catch {
      return dateStr;
    }
  };

  const pickValue = (record: SDRRecord, field: keyof SDRRecord, dataKeys: string[]) => {
    const direct = record[field];
    if (direct !== undefined && direct !== null && String(direct).trim() !== '') return String(direct);
    const data = record.data;
    if (!data) return '';
    for (const key of dataKeys) {
      const value = data[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') return String(value);
    }
    return '';
  };

  return (
    <div className="flex flex-col h-full bg-background-light dark:bg-background-dark">
      {/* Header */}
      <header className="h-16 border-b border-border-light dark:border-slate-800 bg-surface-light dark:bg-surface-dark flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-slate-700 dark:text-slate-100 text-2xl">search</span>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">SDR Search</h1>
        </div>
      </header>

      {/* Search Form */}
      <div className="p-6 border-b border-border-light dark:border-slate-800 bg-surface-light dark:bg-surface-dark">
        <form onSubmit={handleSearch} className="max-w-2xl">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by phone number, name, email, or other subscriber details..."
                className="w-full px-4 py-3 pl-12 border border-border-light dark:border-slate-700 rounded-lg bg-background-light dark:bg-background-dark text-slate-900 dark:text-white placeholder-slate-500 dark:placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
              />
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>
            </div>
            <button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-bold rounded-lg flex items-center gap-2 transition-colors"
            >
              {isLoading ? (
                <span className="material-symbols-outlined animate-spin">sync</span>
              ) : (
                <span className="material-symbols-outlined">search</span>
              )}
              Search
            </button>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
            Enter a phone number (10-15 digits) for exact subscriber lookup, or search by name, email, or other details
          </p>
        </form>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <span className="material-symbols-outlined">error</span>
              <span className="font-medium">{error}</span>
            </div>
          </div>
        )}

        {results.length > 0 && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              Found {results.length} subscriber{results.length !== 1 ? 's' : ''}
            </h2>
          </div>
        )}

        {results.length === 0 && query && !isLoading && !error && (
          <div className="text-center py-12">
            <span className="material-symbols-outlined text-6xl text-slate-300 dark:text-slate-600">search_off</span>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white mt-4">No results found</h3>
            <p className="text-slate-600 dark:text-slate-400 mt-2">
              Try adjusting your search terms or check the spelling
            </p>
          </div>
        )}

        <div className="space-y-4">
          {results.map((record) => (
            <div
              key={record.id}
              className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-slate-800 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Primary Info */}
                <div className="space-y-2">
                  <h3 className="font-bold text-slate-900 dark:text-white text-lg">
                    {pickValue(record, 'subscriber_name', ['Name of Subscriber']) || 'Unknown'}
                  </h3>
                  <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                    <span className="material-symbols-outlined text-sm">phone</span>
                    <span className="font-mono">
                      {pickValue(record, 'telephone_number', ['TelephoneNumber']) || 'N/A'}
                    </span>
                  </div>
                  {pickValue(record, 'alternate_phone_no', ['AlternatePhoneNo']) && (
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                      <span className="material-symbols-outlined text-sm">phone</span>
                      <span className="font-mono text-sm">
                        Alt: {pickValue(record, 'alternate_phone_no', ['AlternatePhoneNo'])}
                      </span>
                    </div>
                  )}
                  {pickValue(record, 'email_id', ['Email ID']) && (
                    <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                      <span className="material-symbols-outlined text-sm">email</span>
                      <span className="text-sm">{pickValue(record, 'email_id', ['Email ID'])}</span>
                    </div>
                  )}
                </div>

                {/* ID Documents */}
                <div className="space-y-2">
                  <h4 className="font-semibold text-slate-700 dark:text-slate-300">ID Documents</h4>
                  {pickValue(record, 'poi_no', ['POI NO', 'IDCard']) && (
                    <div className="text-sm">
                      <span className="text-slate-600 dark:text-slate-400">POI:</span>
                      <span className="font-mono ml-2">
                        {pickValue(record, 'poi_no', ['POI NO', 'IDCard'])}
                      </span>
                      {pickValue(record, 'poi_name', ['POI Name']) && (
                        <span className="ml-2">({pickValue(record, 'poi_name', ['POI Name'])})</span>
                      )}
                    </div>
                  )}
                  {pickValue(record, 'poa_no', ['POA No']) && (
                    <div className="text-sm">
                      <span className="text-slate-600 dark:text-slate-400">POA:</span>
                      <span className="font-mono ml-2">{pickValue(record, 'poa_no', ['POA No'])}</span>
                      {pickValue(record, 'poa_name', ['POA Name']) && (
                        <span className="ml-2">({pickValue(record, 'poa_name', ['POA Name'])})</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Additional Details */}
                <div className="space-y-2">
                  <h4 className="font-semibold text-slate-700 dark:text-slate-300">Details</h4>
                  {pickValue(record, 'date_of_birth', ['Date Of Birth']) && (
                    <div className="text-sm">
                      <span className="text-slate-600 dark:text-slate-400">DOB:</span>
                      <span className="ml-2">{formatDate(pickValue(record, 'date_of_birth', ['Date Of Birth']))}</span>
                    </div>
                  )}
                  {pickValue(record, 'gender', ['Gender']) && (
                    <div className="text-sm">
                      <span className="text-slate-600 dark:text-slate-400">Gender:</span>
                      <span className="ml-2">{pickValue(record, 'gender', ['Gender'])}</span>
                    </div>
                  )}
                  {pickValue(record, 'connection_type', ['Connection Type']) && (
                    <div className="text-sm">
                      <span className="text-slate-600 dark:text-slate-400">Connection:</span>
                      <span className="ml-2">{pickValue(record, 'connection_type', ['Connection Type'])}</span>
                    </div>
                  )}
                  {pickValue(record, 'point_of_sale', ['Retailer']) && (
                    <div className="text-sm">
                      <span className="text-slate-600 dark:text-slate-400">POS:</span>
                      <span className="ml-2">{pickValue(record, 'point_of_sale', ['Retailer'])}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Addresses */}
              {(pickValue(record, 'permanent_address', ['Permanent Address']) || pickValue(record, 'local_address', ['Local Address'])) && (
                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700">
                  <h4 className="font-semibold text-slate-700 dark:text-slate-300 mb-2">Addresses</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    {pickValue(record, 'permanent_address', ['Permanent Address']) && (
                      <div>
                        <span className="text-slate-600 dark:text-slate-400 font-medium">Permanent:</span>
                        <p className="mt-1 text-slate-700 dark:text-slate-300">
                          {pickValue(record, 'permanent_address', ['Permanent Address'])}
                        </p>
                      </div>
                    )}
                    {pickValue(record, 'local_address', ['Local Address']) && (
                      <div>
                        <span className="text-slate-600 dark:text-slate-400 font-medium">Local:</span>
                        <p className="mt-1 text-slate-700 dark:text-slate-300">
                          {pickValue(record, 'local_address', ['Local Address'])}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Metadata */}
              <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Source: {record.source_file || 'Unknown'}</span>
                <span>Added: {formatDate(record.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
