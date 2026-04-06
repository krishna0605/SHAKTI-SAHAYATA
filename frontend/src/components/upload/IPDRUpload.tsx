import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx-js-style';
import { caseAPI, ipdrFileAPI, ipdrAPI } from '../lib/apis';
import { parseIPDR, type IPDROperator, type NormalizedIPDR, IPDR_OPERATORS } from '../utils/ipdrNormalization';

interface FormData {
  caseName: string;
  caseNumber: string;
  operator: string;
  description: string;
  startDate: string;
  endDate: string;
}

interface UploadState {
  status: 'idle' | 'uploading' | 'success' | 'error';
  progress: number;
  message: string;
  caseId?: string;
}

interface IPDRUploadProps {
  caseId?: string;
  caseName?: string;
  caseOperator?: string;
  onUploadSuccess?: (caseId: string, caseName: string, operator: string, parsedData: NormalizedIPDR[], fileCount: number) => void;
}

const pickBestIpdrSheet = (workbook: XLSX.WorkBook) => {
  const keyword = /(ipdr|gprs|data|internet|packet|session|cdr|usage|traffic)/i;
  const headerKeyword = /(msisdn|imsi|imei|source.?ip|destination.?ip|session|apn|pgw|uplink|downlink)/i;
  let bestName = workbook.SheetNames[0] || '';
  let bestScore = -1;

  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name];
    if (!ws) continue;
    const sampleRows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false, defval: '' });
    const headerLine = (sampleRows[0] || []).map(String).join(' ');
    const rowCount = sampleRows.length;
    let score = 0;
    if (keyword.test(name)) score += 6;
    if (headerKeyword.test(headerLine)) score += 8;
    score += Math.min(6, Math.floor(rowCount / 500));
    if (score > bestScore) {
      bestScore = score;
      bestName = name;
    }
  }

  return bestName;
};

const readTabularFileAsCsv = async (file: File): Promise<{ content: string; sheetName?: string }> => {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const selectedSheet = pickBestIpdrSheet(workbook);
    if (!selectedSheet) return { content: '' };
    return {
      content: XLSX.utils.sheet_to_csv(workbook.Sheets[selectedSheet]),
      sheetName: selectedSheet
    };
  }
  return { content: await file.text() };
};

export const IPDRUpload: React.FC<IPDRUploadProps> = ({ caseId, caseName, caseOperator, onUploadSuccess }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [formData, setFormData] = useState<FormData>({
    caseName: '',
    caseNumber: '',
    operator: 'Auto',
    description: '',
    startDate: '',
    endDate: '',
  });
  const [manualOperator, setManualOperator] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>({
    status: 'idle',
    progress: 0,
    message: '',
  });
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!caseId) return;
    setFormData((prev) => ({
      ...prev,
      caseName: caseName || prev.caseName,
      operator: (caseOperator || prev.operator || 'AIRTEL').toUpperCase()
    }));
  }, [caseId, caseName, caseOperator]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileSelect = (files: FileList | File[]) => {
    const validTypes = new Set([
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]);
    const validExtensions = ['.csv', '.xls', '.xlsx'];
    
    const validFiles: File[] = [];
    const fileArray = Array.from(files);
    
    for (const file of fileArray) {
      const hasValidExtension = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
      if (hasValidExtension || validTypes.has(file.type)) {
        validFiles.push(file);
      }
    }
    
    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
      setUploadState({ status: 'idle', progress: 0, message: '' });
    } else {
      setUploadState({
        status: 'error',
        progress: 0,
        message: 'Invalid file type(s). Please upload CSV or Excel files only.',
      });
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

  const getErrorMessage = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error';
    }
  };

  const validateBeforeSubmit = () => {
    if (!caseId && !formData.caseName.trim()) return 'Case name is required';
    if (!formData.operator) return 'Please select a telecom operator';
    if (selectedFiles.length === 0) return 'Please select at least one IPDR file to upload';
    return null;
  };

  const parseSelectedFiles = async (files: File[], operator: IPDROperator) => {
    let allParsedData: NormalizedIPDR[] = [];

    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const file = files[fileIndex];
      const parsedFile = await readTabularFileAsCsv(file);
      const fileContent = parsedFile.content;
      console.log(`[IPDRUpload] Processing file ${fileIndex + 1}/${files.length}: ${file.name}`);
      if (parsedFile.sheetName) {
        console.log(`[IPDRUpload] Selected sheet: ${parsedFile.sheetName}`);
      }
      console.log('[IPDRUpload] File content length:', fileContent.length);

      const parsedData = parseIPDR(fileContent, operator);
      console.log(`[IPDRUpload] Parsed ${parsedData.length} records from ${file.name}`);

      const taggedData = parsedData.map(record => ({
        ...record,
        file_index: fileIndex,
        file_name: file.name
      }));

      allParsedData = [...allParsedData, ...taggedData];

      const progress = 10 + Math.round((fileIndex + 1) / files.length * 20);
      setUploadState({ status: 'uploading', progress, message: `Parsed ${allParsedData.length} records from ${fileIndex + 1}/${files.length} files...` });
    }

    return allParsedData;
  };

  const uploadSelectedFiles = async (caseId: string, operator: string, files: File[]) => {
    for (const file of files) {
      await ipdrFileAPI.upload(caseId, file, operator);
    }
  };

  const handleDropzoneKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const handleRemoveFile = (file: File) => {
    const removeIndex = selectedFiles.findIndex((f) => f.name === file.name && f.lastModified === file.lastModified);
    if (removeIndex >= 0) removeFile(removeIndex);
  };

  const dragIconClass = `material-symbols-outlined text-4xl transition-colors ${
    isDragging ? 'text-indigo-500' : 'text-slate-500 dark:text-slate-600'
  }`;

  const renderSelectedFiles = () => (
    <div className="w-full p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="material-symbols-outlined text-2xl text-indigo-500">check_circle</span>
        <p className="text-sm text-indigo-700 dark:text-indigo-400 font-medium">
          {selectedFiles.length} file(s) selected
        </p>
      </div>
      <div className="space-y-2 max-h-40 overflow-y-auto">
        {selectedFiles.map((file) => {
          const fileKey = `${file.name}-${file.lastModified}`;
          return (
            <div key={fileKey} className="flex items-center justify-between bg-white dark:bg-slate-800 rounded px-3 py-2 text-sm">
              <span className="text-slate-700 dark:text-slate-300 truncate flex-1">{file.name}</span>
              <span className="text-slate-500 text-xs mx-2">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveFile(file);
                }}
                className="text-red-500 hover:text-red-700 ml-2"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-500 mt-2 text-center">Click to add more files</p>
    </div>
  );

  const renderEmptyDropzone = () => (
    <>
      <span className={dragIconClass}>upload_file</span>
      <p className="text-sm text-slate-600 dark:text-slate-500 font-medium">
        Drag & drop files here or <span className="text-indigo-500 underline">browse</span>
      </p>
      <p className="text-xs text-slate-400">Supports multiple IPDR CSV/Excel files</p>
    </>
  );

  const dropzoneContent = selectedFiles.length > 0 ? renderSelectedFiles() : renderEmptyDropzone();

  const dropzoneClass = (() => {
    const base = 'w-full min-h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer transition-all';
    if (selectedFiles.length > 0 || isDragging) {
      return `${base} border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20`;
    }
    return `${base} border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 hover:bg-slate-100 dark:hover:bg-background-dark hover:border-indigo-500/50`;
  })();

  const handleSubmit = async () => {
    const validationError = validateBeforeSubmit();
    if (validationError) {
      setUploadState({ status: 'error', progress: 0, message: validationError });
      return;
    }

    try {
      setUploadState({ status: 'uploading', progress: 10, message: `Reading and parsing ${selectedFiles.length} file(s)...` });

      const normalizedOperator = String(caseOperator || formData.operator || 'AIRTEL').toUpperCase();
      const resolvedOperator = (normalizedOperator === 'AUTO' ? 'AIRTEL' : normalizedOperator) as IPDROperator;
      const allParsedData = await parseSelectedFiles(selectedFiles, resolvedOperator);

      if (allParsedData.length === 0) {
        setUploadState({ 
          status: 'error', 
          progress: 0, 
          message: 'No valid IPDR records found in any file. Please check file format matches the selected operator.' 
        });
        return;
      }

      let targetCaseId = caseId;
      let targetCaseName = caseName || formData.caseName;
      if (!targetCaseId) {
        setUploadState({ status: 'uploading', progress: 35, message: `Parsed ${allParsedData.length} total records. Creating case...` });
        const newCase = await caseAPI.create({
          case_name: formData.caseName,
          case_number: formData.caseNumber || undefined,
          description: formData.description || undefined,
          operator: resolvedOperator,
          case_type: 'IPDR',
        });
        targetCaseId = newCase.id;
        targetCaseName = formData.caseName;
      } else {
        setUploadState({ status: 'uploading', progress: 35, message: `Parsed ${allParsedData.length} total records. Using existing case...`, caseId: targetCaseId });
      }
      const effectiveCaseId = String(targetCaseId);
      const effectiveCaseName = String(targetCaseName);

      setUploadState({ status: 'uploading', progress: 50, message: `Uploading ${selectedFiles.length} file(s)...`, caseId: effectiveCaseId });

      // 3. Upload files to IPDR storage bucket
      await uploadSelectedFiles(effectiveCaseId, resolvedOperator, selectedFiles);

      setUploadState({ status: 'uploading', progress: 70, message: 'Saving records to database...', caseId: effectiveCaseId });

      // 4. Save records to database for persistence
      const insertedCount = await ipdrAPI.insertRecords(
        effectiveCaseId,
        allParsedData as unknown as Record<string, unknown>[],
        undefined,
        {
          chunkSize: 1000,
          onProgress: (inserted, total) => {
            const ratio = total > 0 ? inserted / total : 0;
            const progress = 70 + Math.round(ratio * 25);
            setUploadState({
              status: 'uploading',
              progress: Math.min(progress, 95),
              message: `Saving records to database... ${inserted}/${total}`,
              caseId: effectiveCaseId
            });
          }
        }
      );
      if (insertedCount <= 0) {
        throw new Error('No IPDR records were inserted into the database.');
      }

      console.log(`[IPDRUpload] Saved ${insertedCount} records to database`);
      console.log(`[IPDRUpload] Total ${allParsedData.length} records from ${selectedFiles.length} files; IP enrichment stored in source/destination IP info fields`);

      try {
        setUploadState({
          status: 'uploading',
          progress: 96,
          message: 'Enriching IP intelligence...',
          caseId: effectiveCaseId
        });
        await ipdrAPI.enrichCase(effectiveCaseId, 5000);
      } catch (enrichError) {
        console.warn('[IPDRUpload] IP intelligence backfill skipped:', enrichError);
      }

      setUploadState({ 
        status: 'success', 
        progress: 100, 
        message: `Success! ${insertedCount}/${allParsedData.length} records inserted and enriched from ${selectedFiles.length} file(s). Redirecting to analysis...`,
        caseId: effectiveCaseId 
      });

      // Redirect to analytics page with parsed data
      setTimeout(() => {
        if (onUploadSuccess) {
          onUploadSuccess(effectiveCaseId, effectiveCaseName, resolvedOperator, [], selectedFiles.length);
        }
      }, 1500);

      // Reset form
      setFormData({
        caseName: caseName || '',
        caseNumber: '',
        operator: (caseOperator || 'AUTO').toUpperCase(),
        description: '',
        startDate: '',
        endDate: '',
      });
      setSelectedFiles([]);

    } catch (error: unknown) {
      console.error('Upload error details:', error);
      const errorMessage = getErrorMessage(error);
      setUploadState({
        status: 'error',
        progress: 0,
        message: `Error: ${errorMessage}`,
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-background-light dark:bg-background-dark text-slate-900 dark:text-white overflow-hidden font-display relative z-0">
      <header className="h-16 border-b border-border-light dark:border-slate-800 bg-surface-light dark:bg-surface-dark flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-indigo-600 dark:text-indigo-400 text-2xl">wifi</span>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">IPDR Upload</h1>
          <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 text-[10px] font-bold uppercase rounded">IP Data Records</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-xs font-mono">
            <span className="material-symbols-outlined text-sm">schedule</span>
            {formatTime(currentTime)}
          </div>
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 dark:text-indigo-400 text-xs font-bold uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
            <span>IPDR Mode</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          {/* Form Card */}
          <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-slate-800 rounded-2xl shadow-lg overflow-hidden">
            {/* Card Header */}
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-indigo-500/5 to-purple-500/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <span className="material-symbols-outlined text-indigo-600 dark:text-indigo-400">lan</span>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">New IPDR Case</h2>
                  <p className="text-xs text-slate-500">IP Detail Records for network traffic analysis</p>
                </div>
              </div>
            </div>

            {/* Form Body */}
            <div className="p-6 space-y-6">
              {/* Case Details */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="ipdr-case-name" className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase mb-2">Case Name *</label>
                  <input
                    id="ipdr-case-name"
                    type="text"
                    name="caseName"
                    value={formData.caseName}
                    onChange={handleInputChange}
                    placeholder="e.g., Investigation 2024/001"
                    className="w-full px-4 py-3 rounded-lg bg-slate-50 dark:bg-background-dark border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium"
                  />
                </div>
                <div>
                  <label htmlFor="ipdr-case-number" className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase mb-2">Case Number</label>
                  <input
                    id="ipdr-case-number"
                    type="text"
                    name="caseNumber"
                    value={formData.caseNumber}
                    onChange={handleInputChange}
                    placeholder="e.g., FIR-2024-12345"
                    className="w-full px-4 py-3 rounded-lg bg-slate-50 dark:bg-background-dark border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium"
                  />
                </div>
              </div>

              {/* Operator Selection */}
              <div>
                <label htmlFor="ipdr-operator" className="text-sm font-medium text-slate-700 dark:text-slate-300 tracking-wide">IPDR Format *</label>
                {manualOperator && (
                <select
                  id="ipdr-operator"
                  name="operator"
                  value={formData.operator}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 rounded-lg bg-slate-50 dark:bg-background-dark border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium"
                >
                  <option value="">Select IPDR format...</option>
                  <option value="Auto">Auto</option>
                  {IPDR_OPERATORS.map(op => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>
                )}
                <div className="flex items-center mt-2">
                  <input type="checkbox" id="manualOperator" checked={manualOperator} onChange={(e) => setManualOperator(e.target.checked)} className="mr-2" />
                  <label htmlFor="manualOperator" className="text-sm text-slate-600 dark:text-slate-400">Enable manual operator selection</label>
                </div>
              </div>

              {/* Description */}
              <div>
                <label htmlFor="ipdr-description" className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase mb-2">Description</label>
                <textarea
                  id="ipdr-description"
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  rows={2}
                  placeholder="Brief description of the investigation..."
                  className="w-full px-4 py-3 rounded-lg bg-slate-50 dark:bg-background-dark border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium resize-none"
                />
              </div>

              {/* File Upload Section */}
              <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-indigo-600 dark:text-indigo-400">upload_file</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">IPDR Files</span>
                    <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">Secure forensic data ingestion</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <span className="px-2 py-1 bg-slate-50 dark:bg-background-dark border border-slate-200 dark:border-slate-700 rounded text-[10px] text-slate-600 dark:text-slate-400 font-mono flex items-center gap-1">
                    <span className="material-symbols-outlined text-[10px]">description</span> CSV, Excel
                  </span>
                  <span className="px-2 py-1 bg-slate-50 dark:bg-background-dark border border-slate-200 dark:border-slate-700 rounded text-[10px] text-slate-600 dark:text-slate-400 font-mono flex items-center gap-1">
                    <span className="material-symbols-outlined text-[10px]">hard_drive</span> Max 50MB
                  </span>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xls,.xlsx"
                multiple
                onChange={(e) => e.target.files && e.target.files.length > 0 && handleFileSelect(e.target.files)}
                className="hidden"
              />

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onKeyDown={handleDropzoneKeyDown}
                tabIndex={0}
                aria-label="Add IPDR files"
                className={dropzoneClass}
              >
                {dropzoneContent}
              </button>
            </div>

            {/* Submit Button */}
            <button
              onClick={handleSubmit}
              disabled={uploadState.status === 'uploading'}
              className="w-full py-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploadState.status === 'uploading' ? (
                <>
                  <span className="material-symbols-outlined animate-spin">sync</span>
                  {uploadState.message}
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined">rocket_launch</span>
                  <span>Analyze IPDR Records</span>
                </>
              )}
            </button>

            {/* Progress Bar */}
            {uploadState.status === 'uploading' && (
              <div className="h-1 bg-slate-200 dark:bg-slate-700">
                <div 
                  className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300"
                  style={{ width: `${uploadState.progress}%` }}
                />
              </div>
            )}

            {/* Status Message */}
            {uploadState.status === 'error' && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border-t border-red-200 dark:border-red-800 flex items-center gap-3">
                <span className="material-symbols-outlined text-red-500">error</span>
                <p className="text-red-700 dark:text-red-400 text-sm font-medium">{uploadState.message}</p>
              </div>
            )}

            {uploadState.status === 'success' && (
              <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border-t border-emerald-200 dark:border-emerald-800 flex items-center gap-3">
                <span className="material-symbols-outlined text-emerald-500">check_circle</span>
                <p className="text-emerald-700 dark:text-emerald-400 text-sm font-medium">{uploadState.message}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
