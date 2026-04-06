import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx-js-style';
import { caseAPI, towerDumpAPI, towerDumpFileAPI } from '../lib/apis';
import type { NormalizedTowerDump } from '../utils/towerDumpNormalization';
import { parseTowerDumpCsvAsync } from '../utils/towerDumpParserAsync';
import { TowerDumpAnalysis } from '../analysis/TowerDumpAnalysis';

interface FormData {
  caseName: string;
  towerId: string;
  operator: string;
  startDate: string;
  endDate: string;
}

interface UploadState {
  status: 'idle' | 'uploading' | 'success' | 'error';
  progress: number;
  message: string;
  caseId?: string;
}

interface TowerDumpProps {
  caseId?: string;
  caseName?: string;
  caseOperator?: string;
  onUploadSuccess?: (caseId: string, caseName: string, operator: string, data: TowerDumpRecord[], fileCount: number) => void;
}

type TowerDumpRecord = NormalizedTowerDump & {
  source_file?: string;
  _source_file?: string;
  row_index?: number;
  _row_index?: number;
  file_index?: number;
  tower_id?: string;
  case_id?: string;
  operator: string;
};

const readTabularFileAsCsv = async (file: File): Promise<string> => {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) return '';
    return XLSX.utils.sheet_to_csv(workbook.Sheets[firstSheetName]);
  }
  return file.text();
};

const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const normalizeTowerUploadRecords = async (
  parsedRecords: NormalizedTowerDump[],
  file: File,
  fileIndex: number,
  towerId: string,
  selectedOperator: string
): Promise<TowerDumpRecord[]> => {
  // Larger chunks reduce overhead for typical 10k-100k row files.
  const chunkSize = 10000;
  const normalized: TowerDumpRecord[] = [];

  for (let start = 0; start < parsedRecords.length; start += chunkSize) {
    const chunk = parsedRecords.slice(start, start + chunkSize);
    for (let i = 0; i < chunk.length; i++) {
      const recordIndex = start + i;
      const record = chunk[i];
      normalized.push({
        ...record,
        source_file: file.name,
        _source_file: file.name,
        row_index: recordIndex,
        _row_index: recordIndex,
        file_index: fileIndex,
        tower_id: towerId,
        operator: record.operator || selectedOperator,
        case_id: ''
      });
    }
    await yieldToUI();
  }

  return normalized;
};

export const TowerDump: React.FC<TowerDumpProps> = ({ caseId, caseName, caseOperator, onUploadSuccess }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [formData, setFormData] = useState<FormData>({
    caseName: '',
    towerId: '',
    operator: 'AUTO',
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

  // Analysis state
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [analysisData, setAnalysisData] = useState<{
    caseId: string;
    caseName: string;
    operator: string;
    data: TowerDumpRecord[];
    fileCount: number;
  } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!caseId) return;
    setFormData((prev) => ({
      ...prev,
      caseName: caseName || prev.caseName,
      operator: (caseOperator || prev.operator || 'AUTO').toUpperCase()
    }));
  }, [caseId, caseName, caseOperator]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'operator') {
      setFormData(prev => ({ ...prev, [name]: String(value || '').toUpperCase() }));
      return;
    }
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileSelect = (files: FileList | File[]) => {
    const validTypes = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
    const validExtensions = ['.csv', '.xls', '.xlsx'];

    const validFiles: File[] = [];
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      const hasValidExtension = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
      if (hasValidExtension || validTypes.includes(file.type)) {
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

  const handleBackToUpload = () => {
    setShowAnalysis(false);
    setAnalysisData(null);
    setUploadState({ status: 'idle', progress: 0, message: '' });
    setSelectedFiles([]);
    setFormData({
      caseName: '',
      towerId: '',
      operator: 'AUTO',
      startDate: '',
      endDate: '',
    });
  };

  const handleSubmit = async () => {
    const selectedOperator = manualOperator ? (formData.operator || 'AUTO') : 'AUTO';

    // Validation
    if (!caseId && !formData.caseName.trim()) {
      setUploadState({ status: 'error', progress: 0, message: 'Case name is required' });
      return;
    }
    if (!formData.towerId.trim()) {
      setUploadState({ status: 'error', progress: 0, message: 'Tower ID is required' });
      return;
    }
    if (selectedFiles.length === 0) {
      setUploadState({ status: 'error', progress: 0, message: 'Please select at least one tower dump file to upload' });
      return;
    }

    try {
      setUploadState({ status: 'uploading', progress: 10, message: `Reading and parsing ${selectedFiles.length} file(s)...` });

      // 1. Read and parse ALL files client-side with normalization
      let allParsedData: TowerDumpRecord[] = [];
      let totalRecords = 0;

      for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex++) {
        const file = selectedFiles[fileIndex];
        await yieldToUI();
        const fileContent = await readTabularFileAsCsv(file);
        console.log(`[TowerDump] Processing file ${fileIndex + 1}/${selectedFiles.length}: ${file.name}`);

        // Parse CSV using proper parser
        const parsedRecords = await parseTowerDumpCsvAsync(fileContent, selectedOperator === 'AUTO' ? undefined : selectedOperator);

        console.log(`[TowerDump] Found ${parsedRecords.length} parsed records in ${file.name}`);

        // Add metadata to each record
        const normalizedRecords = await normalizeTowerUploadRecords(
          parsedRecords,
          file,
          fileIndex,
          formData.towerId,
          selectedOperator
        );

        console.log(`[TowerDump] Successfully normalized ${normalizedRecords.length}/${parsedRecords.length} records from ${file.name}`);

        allParsedData = allParsedData.concat(normalizedRecords);
        totalRecords += normalizedRecords.length;

        const progress = 10 + Math.round((fileIndex + 1) / selectedFiles.length * 20);
        setUploadState({ status: 'uploading', progress, message: `Normalized ${totalRecords} records from ${fileIndex + 1}/${selectedFiles.length} files...` });
      }

      if (allParsedData.length === 0) {
        setUploadState({
          status: 'error',
          progress: 0,
          message: 'No valid tower dump records found in any file. Please check file format and operator selection.'
        });
        return;
      }

      const resolvedOperator = selectedOperator === 'AUTO'
        ? (caseOperator || allParsedData.find(record => record.operator)?.operator || 'AUTO')
        : selectedOperator;

      let targetCaseId = caseId;
      let targetCaseName = caseName || formData.caseName;
      if (!targetCaseId) {
        setUploadState({ status: 'uploading', progress: 35, message: `Normalized ${allParsedData.length} total records. Creating case...` });
        const newCase = await caseAPI.create({
          case_name: formData.caseName,
          case_number: formData.towerId,
          description: `Tower Dump Analysis - ${formData.towerId}`,
          operator: resolvedOperator,
          case_type: 'TOWER',
        });
        targetCaseId = newCase.id;
        targetCaseName = formData.caseName;
      } else {
        setUploadState({ status: 'uploading', progress: 35, message: `Normalized ${allParsedData.length} total records. Using existing case...`, caseId: targetCaseId });
      }
      const effectiveCaseId = String(targetCaseId);
      const effectiveCaseName = String(targetCaseName);

      allParsedData = allParsedData.map(record => ({ ...record, case_id: effectiveCaseId }));

      setUploadState({ status: 'uploading', progress: 50, message: `Uploading ${selectedFiles.length} file(s)...`, caseId: effectiveCaseId });

      // 3. Upload files to storage
      for (const file of selectedFiles) {
        await yieldToUI();
        await towerDumpFileAPI.upload(effectiveCaseId, file, resolvedOperator);
      }

      setUploadState({ status: 'uploading', progress: 70, message: 'Inserting normalized tower dump records...', caseId: effectiveCaseId });

      // 4. Insert normalized records into database (required)
      const insertedCount = await towerDumpAPI.insertRecords(
        effectiveCaseId,
        null,
        allParsedData as unknown as Record<string, unknown>[],
        {
          chunkSize: 2000,
          onProgress: (inserted, total) => {
            const ratio = total > 0 ? inserted / total : 0;
            const progress = 70 + Math.round(ratio * 25);
            setUploadState({
              status: 'uploading',
              progress: Math.min(progress, 95),
              message: `Inserting normalized tower dump records... ${inserted}/${total}`,
              caseId: effectiveCaseId
            });
          }
        }
      );
      if (insertedCount <= 0) {
        throw new Error('No tower dump records were inserted into the database.');
      }
      console.log(`[TowerDump] Successfully inserted ${insertedCount} normalized records`);
      setUploadState({
        status: 'success',
        progress: 100,
        message: `Success! ${insertedCount}/${allParsedData.length} records inserted from ${selectedFiles.length} file(s). Showing analysis...`,
        caseId: effectiveCaseId
      });

      // Show analysis page
      setAnalysisData({
        caseId: effectiveCaseId,
        caseName: effectiveCaseName,
        operator: resolvedOperator,
        data: [],
        fileCount: selectedFiles.length
      });
      setShowAnalysis(true);

      // Also call the callback if provided
      if (onUploadSuccess) {
        onUploadSuccess(effectiveCaseId, effectiveCaseName, resolvedOperator, [], selectedFiles.length);
      }

      // Reset form
      setFormData({
        caseName: caseName || '',
        towerId: '',
        operator: (caseOperator || 'AUTO').toUpperCase(),
        startDate: '',
        endDate: '',
      });
      setSelectedFiles([]);

    } catch (error: unknown) {
      console.error('Upload error details:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setUploadState({
        status: 'error',
        progress: 0,
        message: `Error: ${errorMessage}`,
      });
    }
  };

  // Show analysis page if we have analysis data
  if (showAnalysis && analysisData) {
    return (
      <TowerDumpAnalysis
        caseId={analysisData.caseId}
        caseName={analysisData.caseName}
        operator={analysisData.operator}
        fileCount={analysisData.fileCount}
        onBack={handleBackToUpload}
      />
    );
  }

  return (
    <div className="flex flex-col h-full bg-background-light dark:bg-background-dark text-slate-900 dark:text-white overflow-hidden font-display relative z-0">
      <header className="h-16 border-b border-border-light dark:border-slate-800 bg-surface-light dark:bg-surface-dark flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-slate-700 dark:text-white text-2xl">cell_tower</span>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Tower Dump Analysis</h1>
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
        <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-20">
          {/* Header Section */}
          <div className="relative bg-surface-light dark:bg-surface-dark rounded-2xl border border-border-light dark:border-slate-800 p-8 overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500"></div>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
              <div className="flex flex-col gap-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-widest w-fit">
                  <span className="material-symbols-outlined text-sm">security</span>
                  SECURE UPLOAD
                </div>
                <div className="flex items-center gap-4">
                  <span className="material-symbols-outlined text-5xl text-slate-600 dark:text-slate-300">cell_tower</span>
                  <div>
                    <h2 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white tracking-wide">
                      <span className="text-blue-600 dark:text-blue-500">TOWER DUMP</span> FORENSIC{' '}
                      <span className="text-pink-600 dark:text-pink-500">ANALYSIS</span>
                    </h2>
                    <p className="text-slate-600 dark:text-slate-400 text-sm font-mono mt-1">
                      Location-Based Intelligence • Map-Driven Investigation Platform
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Status Message */}
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
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${uploadState.progress}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Case Assignment Section */}
          <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 shadow-sm dark:shadow-xl overflow-hidden">
            <div className="p-1 bg-gradient-to-r from-slate-200 dark:from-slate-800 to-transparent opacity-50"></div>
            <div className="p-6">
              <div className="flex justify-between items-start mb-8">
                <div className="flex items-center gap-4">
                  <div className="size-10 rounded-lg bg-gradient-to-br from-blue-600 to-blue-400 flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <span className="material-symbols-outlined text-white">folder_managed</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-wide">CASE ASSIGNMENT</h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">Assign tower dump data to investigation case</p>
                  </div>
                </div>
                <span className="px-3 py-1 bg-orange-500/20 text-orange-700 dark:text-orange-400 border border-orange-500/20 rounded text-[10px] font-bold uppercase tracking-widest">
                  Classified
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                {/* Case Name */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider ml-1">
                    Case Name *
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="material-symbols-outlined text-slate-500 group-focus-within:text-blue-500 transition-colors text-lg">sell</span>
                    </div>
                    <input
                      type="text"
                      name="caseName"
                      value={formData.caseName}
                      onChange={handleInputChange}
                      className="block w-full pl-10 pr-3 py-3 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                      placeholder="Enter case name"
                    />
                  </div>
                </div>

                {/* Tower ID */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider ml-1">
                    Tower ID / Cell ID *
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <span className="material-symbols-outlined text-slate-500 group-focus-within:text-blue-500 transition-colors text-lg">cell_tower</span>
                    </div>
                    <input
                      type="text"
                      name="towerId"
                      value={formData.towerId}
                      onChange={handleInputChange}
                      className="block w-full pl-10 pr-3 py-3 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-600 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                      placeholder="Enter tower/cell identifier"
                    />
                  </div>
                </div>

                {/* Telecom Operator */}
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider ml-1">Telecom Operator *</label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <span className="material-symbols-outlined text-slate-500 group-focus-within:text-blue-500 transition-colors text-lg">apartment</span>
                      </div>
                      {manualOperator && (
                      <select
                        name="operator"
                        value={formData.operator}
                        onChange={handleInputChange}
                        className="block w-full pl-10 pr-10 py-3 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-300 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all appearance-none cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900"
                      >
                        <option value="">Select Operator</option>
                        <option value="AUTO">Auto</option>
                        <option value="AIRTEL">Bharti Airtel</option>
                        <option value="JIO">Reliance Jio</option>
                        <option value="VODAFONE">Vodafone Idea</option>
                        <option value="BSNL">BSNL</option>
                        <option value="OTHER">Other</option>
                      </select>
                      )}
                      <div className="flex items-center mt-2">
                        <input type="checkbox" id="manualOperator" checked={manualOperator} onChange={(e) => setManualOperator(e.target.checked)} className="mr-2" />
                        <label htmlFor="manualOperator" className="text-sm text-slate-600 dark:text-slate-400">Enable manual operator selection</label>
                      </div>
                      <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                        <span className="material-symbols-outlined text-slate-500 text-lg">expand_more</span>
                      </div>
                    </div>
                </div>
              </div>
            </div>
          </div>

          {/* Date Filters Section */}
          <div className="bg-surface-light dark:bg-surface-dark rounded-xl border border-border-light dark:border-slate-800 shadow-sm dark:shadow-xl overflow-hidden">
            <div className="p-1 bg-gradient-to-r from-emerald-200/60 dark:from-emerald-900/50 to-transparent opacity-30"></div>
            <div className="p-6">
              <div className="flex justify-between items-start mb-8">
                <div className="flex items-center gap-4">
                  <div className="size-10 rounded-lg bg-gradient-to-br from-emerald-600 to-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                    <span className="material-symbols-outlined text-white">calendar_month</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-wide">DATE FILTERS</h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">Specify investigation timeframe</p>
                  </div>
                </div>
                <span className="text-emerald-700 dark:text-emerald-400 text-xs font-bold tracking-widest">OPTIONAL</span>
              </div>

              <div className="flex flex-col lg:flex-row gap-6">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider ml-1">Start Date</label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <span className="material-symbols-outlined text-slate-500 group-focus-within:text-emerald-500 transition-colors text-lg">event</span>
                      </div>
                      <input
                        type="date"
                        name="startDate"
                        value={formData.startDate}
                        onChange={handleInputChange}
                        className="block w-full pl-10 pr-3 py-3 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider ml-1">End Date</label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <span className="material-symbols-outlined text-slate-500 group-focus-within:text-emerald-500 transition-colors text-lg">event</span>
                      </div>
                      <input
                        type="date"
                        name="endDate"
                        value={formData.endDate}
                        onChange={handleInputChange}
                        className="block w-full pl-10 pr-3 py-3 bg-white dark:bg-background-dark border border-slate-300 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-white focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* File Upload Section */}
          <div
            className={`bg-surface-light dark:bg-surface-dark rounded-xl border shadow-sm dark:shadow-xl overflow-hidden relative transition-colors ${
              isDragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-border-light dark:border-slate-800 hover:border-blue-500/30'
            }`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <div className="p-1 bg-gradient-to-r from-blue-200/40 dark:from-blue-900/20 to-transparent opacity-30"></div>
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <div className="flex items-center gap-4">
                  <div className="size-10 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                    <span className="material-symbols-outlined text-white">cloud_upload</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-wide">TOWER DUMP FILE UPLOAD *</h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">Secure location data ingestion</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <span className="px-2 py-1 bg-slate-50 dark:bg-background-dark border border-slate-200 dark:border-slate-700 rounded text-[10px] text-slate-600 dark:text-slate-400 font-mono flex items-center gap-1">
                    <span className="material-symbols-outlined text-[10px]">description</span> CSV, Excel
                  </span>
                  <span className="px-2 py-1 bg-slate-50 dark:bg-background-dark border border-slate-200 dark:border-slate-700 rounded text-[10px] text-slate-600 dark:text-slate-400 font-mono flex items-center gap-1">
                    <span className="material-symbols-outlined text-[10px]">hard_drive</span> Max 100MB
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

              <div
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`w-full min-h-32 border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer transition-all ${
                  selectedFiles.length > 0
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                    : isDragging
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-background-dark/50 hover:bg-slate-100 dark:hover:bg-background-dark hover:border-blue-500/50'
                }`}
              >
                {selectedFiles.length > 0 ? (
                  <div className="w-full p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="material-symbols-outlined text-2xl text-emerald-500">check_circle</span>
                      <p className="text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                        {selectedFiles.length} file(s) selected
                      </p>
                    </div>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {selectedFiles.map((file, index) => (
                        <div key={index} className="flex items-center justify-between bg-white dark:bg-slate-800 rounded px-3 py-2 text-sm">
                          <span className="text-slate-700 dark:text-slate-300 truncate flex-1">{file.name}</span>
                          <span className="text-slate-500 text-xs mx-2">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                            className="text-red-500 hover:text-red-700 ml-2"
                          >
                            <span className="material-symbols-outlined text-sm">close</span>
                          </button>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500 mt-2 text-center">Click to add more files</p>
                  </div>
                ) : (
                  <>
                    <span className={`material-symbols-outlined text-4xl transition-colors ${isDragging ? 'text-blue-500' : 'text-slate-500 dark:text-slate-600'}`}>
                      upload_file
                    </span>
                    <p className="text-sm text-slate-600 dark:text-slate-500 font-medium">
                      Drag & drop tower dump files here or <span className="text-blue-500 underline">browse</span>
                    </p>
                    <p className="text-xs text-slate-400">Supports multiple CSV/Excel files with location coordinates</p>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Submit Button */}
          <button
            onClick={handleSubmit}
            disabled={uploadState.status === 'uploading'}
            className={`w-full py-4 rounded-xl font-bold text-lg uppercase tracking-wider flex items-center justify-center gap-3 transition-all ${
              uploadState.status === 'uploading'
                ? 'bg-slate-400 cursor-not-allowed text-white'
                : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/40'
            }`}
          >
            {uploadState.status === 'uploading' ? (
              <>
                <span className="material-symbols-outlined animate-spin">progress_activity</span>
                Processing Tower Dump...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined">cell_tower</span>
                Create Case & Upload Tower Dump
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
