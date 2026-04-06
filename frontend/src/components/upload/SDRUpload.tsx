import React, { useEffect, useRef, useState } from 'react';
import { sdrAPI } from '../lib/apis';
import { parseSDRCsv, type NormalizedSDR } from '../utils/sdrNormalization';

interface UploadState {
  status: 'idle' | 'uploading' | 'success' | 'error';
  progress: number;
  message: string;
}

interface SDRUploadProps {
  caseId?: string;
}

export const SDRUpload: React.FC<SDRUploadProps> = ({ caseId }) => {
  type SDRRow = Record<string, unknown>;
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>({ status: 'idle', progress: 0, message: '' });
  const [isDragging, setIsDragging] = useState(false);
  const [tables, setTables] = useState<string[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [rows, setRows] = useState<SDRRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SDRRow[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const refreshTables = async () => {
    try {
      // Check if subscriber_data table exists and has records
      const data = await sdrAPI.getTable('subscriber_data', caseId, 1);
      setTables(data.length > 0 ? ['subscriber_data'] : []);
    } catch {
      setTables([]);
    }
  };

  useEffect(() => {
    refreshTables();
  }, []);

  const handleFileSelect = (files: FileList | File[]) => {
    const validExtensions = ['.csv', '.xls', '.xlsx'];
    const validFiles: File[] = [];
    const fileArray = Array.from(files);
    for (const file of fileArray) {
      const hasValidExtension = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
      if (hasValidExtension) validFiles.push(file);
    }
    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
      setUploadState({ status: 'idle', progress: 0, message: '' });
    } else {
      setUploadState({ status: 'error', progress: 0, message: 'Invalid file type(s). Please upload CSV or Excel files only.' });
    }
  };

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFileSelect(files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      setUploadState({ status: 'error', progress: 0, message: 'Please select at least one SDR file to upload' });
      return;
    }
    try {
      setUploadState({ status: 'uploading', progress: 10, message: `Reading and parsing ${selectedFiles.length} file(s)...` });

      // Parse all files client-side
      let allParsedData: NormalizedSDR[] = [];

      for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex++) {
        const file = selectedFiles[fileIndex];
        const fileContent = await file.text();
        console.log(`[SDRUpload] Processing file ${fileIndex + 1}/${selectedFiles.length}: ${file.name}`);
        console.log('[SDRUpload] File content length:', fileContent.length);

        const parsedData = parseSDRCsv(fileContent);
        console.log(`[SDRUpload] Parsed ${parsedData.length} records from ${file.name}`);

        // Add file_index to each record for tracking
        const taggedData = parsedData.map(record => ({
          ...record,
          file_index: fileIndex,
          file_name: file.name
        }));

        allParsedData = [...allParsedData, ...taggedData];

        const progress = 10 + Math.round((fileIndex + 1) / selectedFiles.length * 30);
        setUploadState({ status: 'uploading', progress, message: `Parsed ${allParsedData.length} records from ${fileIndex + 1}/${selectedFiles.length} files...` });
      }

      if (allParsedData.length === 0) {
        setUploadState({
          status: 'error',
          progress: 0,
          message: 'No valid SDR records found in any file. Please check file format matches expected SDR structure.'
        });
        return;
      }

      setUploadState({ status: 'uploading', progress: 40, message: `Parsed ${allParsedData.length} total records. Storing data...` });

      // Store all normalized data in a single SDR records table
      console.log(`[SDRUpload] Storing ${allParsedData.length} normalized records`);
      const res = await sdrAPI.replaceTable(caseId, 'subscriber_data', allParsedData);
      console.log(`[SDRUpload] Saved ${res.inserted} records`);

      await refreshTables();
      setUploadState({ status: 'success', progress: 100, message: `Upload complete! Stored ${res.inserted} normalized SDR records.` });
      setSelectedFiles([]);
    } catch (error: unknown) {
      console.error('Upload error details:', error);
      setUploadState({ status: 'error', progress: 0, message: `Error: ${getErrorMessage(error)}` });
    }
  };

  const openTable = async (name: string) => {
    try {
      setActiveTable(name);
      const data = await sdrAPI.getTable(name, caseId, 100);
      setRows(data);
      setSearchResults([]);
    } catch (error: unknown) {
      setUploadState({ status: 'error', progress: 0, message: `Failed to open table: ${getErrorMessage(error)}` });
    }
  };

  const deleteTable = async (name: string) => {
    try {
      await sdrAPI.dropTable(caseId, name);
      if (activeTable === name) {
        setActiveTable(null);
        setRows([]);
      }
      await refreshTables();
    } catch (error: unknown) {
      setUploadState({ status: 'error', progress: 0, message: `Failed to delete table: ${getErrorMessage(error)}` });
    }
  };

  const search = async () => {
    try {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }
      const results = await sdrAPI.search(searchQuery.trim(), caseId);
      setSearchResults(results);
    } catch (error: unknown) {
      setUploadState({ status: 'error', progress: 0, message: `Search failed: ${getErrorMessage(error)}` });
    }
  };

  return (
    <div className="flex flex-col h-full bg-background-light dark:bg-background-dark text-slate-900 dark:text-white overflow-hidden font-display relative z-0">
      <header className="h-16 border-b border-border-light dark:border-slate-800 bg-surface-light dark:bg-surface-dark flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-slate-700 dark:text-white text-2xl">satellite_alt</span>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">SDR Upload</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-xs font-mono">
            <span className="material-symbols-outlined text-sm">schedule</span>
            {formatTime(currentTime)}
          </div>
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-xs font-bold uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>System Online</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-20">
          <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 shadow-sm dark:shadow-xl overflow-hidden">
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider ml-1">Upload SDR Files</label>
                  <div
                    className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer ${isDragging ? 'border-blue-500 bg-blue-500/10' : 'border-slate-300 dark:border-slate-700'}`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input ref={fileInputRef} type="file" accept=".csv,.xls,.xlsx" multiple className="hidden" onChange={(e) => e.target.files && handleFileSelect(e.target.files)} />
                    <div className="flex flex-col items-center gap-2">
                      <span className="material-symbols-outlined text-4xl text-slate-500">upload_file</span>
                      <p className="text-sm text-slate-600 dark:text-slate-400">Drop CSV/Excel files here or click to browse</p>
                    </div>
                  </div>
                  {selectedFiles.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {selectedFiles.map((file, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-slate-100 dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700">
                          <span className="text-sm font-mono truncate">{file.name}</span>
                          <button className="text-red-600 text-xs font-bold" onClick={() => removeFile(idx)}>Remove</button>
                        </div>
                      ))}
                      <button className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold shadow" onClick={handleUpload}>Upload</button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider ml-1">Global Search</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="flex-1 px-3 py-2 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm"
                      placeholder="Enter name, number, address..."
                    />
                    <button className="px-4 py-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg text-sm font-bold" onClick={search}>Search</button>
                  </div>
                  {searchResults.length > 0 && (
                    <div className="mt-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-2 max-h-56 overflow-y-auto">
                      <table className="min-w-full text-xs">
                        <thead className="bg-slate-100 dark:bg-slate-700 sticky top-0">
                          <tr>
                            {Object.keys(searchResults[0]).map(k => (
                              <th key={k} className="px-2 py-1 text-left font-semibold border-b border-slate-200 dark:border-slate-600">{k}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {searchResults.map((r, i) => (
                            <tr key={i} className="odd:bg-white even:bg-slate-50 dark:odd:bg-background-dark dark:even:bg-slate-900">
                              {Object.keys(searchResults[0]).map(k => (
                                <td key={k} className="px-2 py-1 border-b border-slate-100 dark:border-slate-800">{String(r[k] ?? '')}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider ml-1">Tables</label>
                  <div className="bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 max-h-40 overflow-y-auto">
                    <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                      {tables.map(t => (
                        <li key={t} className="flex items-center justify-between px-3 py-2">
                          <button className="text-sm text-blue-600 dark:text-blue-400 font-semibold" onClick={() => openTable(t)}>{t}</button>
                          <button className="text-xs text-red-600" onClick={() => deleteTable(t)}>Delete</button>
                        </li>
                      ))}
                      {tables.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No tables found</li>}
                    </ul>
                  </div>
                </div>
              </div>

              {uploadState.message && (
                <div className={`p-4 rounded-lg border ${
                  uploadState.status === 'error' 
                    ? 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400'
                    : uploadState.status === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400'
                    : 'bg-blue-500/10 border-blue-500/30 text-blue-700 dark:text-blue-400'
                }`}>
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined">
                      {uploadState.status === 'error' ? 'error' : uploadState.status === 'success' ? 'check_circle' : 'hourglass_empty'}
                    </span>
                    <span className="font-medium">{uploadState.message}</span>
                  </div>
                  {uploadState.status === 'uploading' && (
                    <div className="mt-3 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${uploadState.progress}%` }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {activeTable && (
            <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Table: {activeTable}</h3>
                <button
                  className="px-3 py-1 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded text-xs font-bold"
                  onClick={async () => {
                    const data = await sdrAPI.getTable(activeTable, caseId);
                    setRows(data);
                  }}
                >
                  Refresh
                </button>
              </div>
              <div className="overflow-auto border border-slate-200 dark:border-slate-700 rounded-lg">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-100 dark:bg-slate-800">
                    <tr>
                      {rows[0] ? Object.keys(rows[0]).map(k => (
                        <th key={k} className="px-3 py-2 text-left font-semibold border-b border-slate-200 dark:border-slate-700">{k}</th>
                      )) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="odd:bg-white even:bg-slate-50 dark:odd:bg-background-dark dark:even:bg-slate-900">
                        {Object.keys(rows[0] || {}).map(k => (
                          <td key={k} className="px-3 py-2 border-b border-slate-100 dark:border-slate-800">
                            <input
                              className="w-full bg-transparent outline-none"
                              value={r[k] != null ? String(r[k]) : ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setRows(prev => {
                                  const copy = [...prev];
                                  copy[i] = { ...copy[i], [k]: val };
                                  return copy;
                                });
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td className="px-3 py-4 text-slate-500" colSpan={1}>No rows loaded</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-bold"
                  onClick={async () => {
                    if (!activeTable) return;
                    const res = await sdrAPI.replaceTable(caseId, activeTable, rows);
                    setUploadState({ status: 'success', progress: 100, message: `Saved table ${activeTable}: ${res.inserted} new, ${res.skipped} duplicates skipped` });
                  }}
                >
                  Save Changes
                </button>
                <button
                  className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded-lg text-sm font-bold"
                  onClick={async () => {
                    if (!activeTable) return;
                    const more = await sdrAPI.getTable(activeTable, caseId);
                    setRows(more);
                  }}
                >
                  Load Full Table
                </button>
                <button
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-bold"
                  onClick={() => activeTable && deleteTable(activeTable)}
                >
                  Delete Table
                </button>
              </div>
            </div>
          )}

          
        </div>
      </div>
    </div>
  );
};
