import React, { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx-js-style';
import { caseAPI, ildAPI, ildFileAPI } from '../lib/apis';
import { ILD_OPERATORS, parseILD, type ILDOperator, type NormalizedILD } from '../utils/ildNormalization';

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

interface ILDUploadProps {
  caseId?: string;
  caseName?: string;
  caseOperator?: string;
  onUploadSuccess?: (caseId: string, caseName: string, operator: string, parsedData: NormalizedILD[], fileCount: number) => void;
}

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

export const ILDUpload: React.FC<ILDUploadProps> = ({ caseId, caseName, caseOperator, onUploadSuccess }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [formData, setFormData] = useState<FormData>({
    caseName: '',
    caseNumber: '',
    operator: 'Auto',
    description: '',
    startDate: '',
    endDate: ''
  });
  const [manualOperator, setManualOperator] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>({
    status: 'idle',
    progress: 0,
    message: ''
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
      operator: (caseOperator || prev.operator || 'AUTO').toUpperCase()
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
        message: 'Invalid file type(s). Please upload CSV or Excel files only.'
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

  const handleSubmit = async () => {
    if (!caseId && !formData.caseName.trim()) {
      setUploadState({ status: 'error', progress: 0, message: 'Case name is required' });
      return;
    }
    const selectedOperator = formData.operator || 'AUTO';
    const resolvedOperator = (selectedOperator === 'AUTO' ? 'JIO' : selectedOperator) as ILDOperator;

    if (selectedFiles.length === 0) {
      setUploadState({ status: 'error', progress: 0, message: 'Please select at least one ILD file to upload' });
      return;
    }

    try {
      setUploadState({ status: 'uploading', progress: 10, message: `Reading and parsing ${selectedFiles.length} file(s)...` });

      let allParsedData: NormalizedILD[] = [];

      for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex++) {
        const file = selectedFiles[fileIndex];
        const fileContent = await readTabularFileAsCsv(file);
        const parsedData = parseILD(fileContent, resolvedOperator);
        allParsedData = [...allParsedData, ...parsedData];

        const progress = 10 + Math.round((fileIndex + 1) / selectedFiles.length * 20);
        setUploadState({ status: 'uploading', progress, message: `Parsed ${allParsedData.length} records from ${fileIndex + 1}/${selectedFiles.length} files...` });
      }

      if (allParsedData.length === 0) {
        setUploadState({
          status: 'error',
          progress: 0,
          message: 'No valid ILD records found in any file. Please check file format matches the selected operator.'
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
          case_type: 'ILD'
        });
        targetCaseId = newCase.id;
        targetCaseName = formData.caseName;
      } else {
        setUploadState({ status: 'uploading', progress: 35, message: `Parsed ${allParsedData.length} total records. Using existing case...`, caseId: targetCaseId });
      }
      const effectiveCaseId = String(targetCaseId);
      const effectiveCaseName = String(targetCaseName);

      setUploadState({ status: 'uploading', progress: 50, message: `Uploading ${selectedFiles.length} file(s)...`, caseId: effectiveCaseId });

      for (const file of selectedFiles) {
        await ildFileAPI.upload(effectiveCaseId, file, resolvedOperator);
      }

      setUploadState({ status: 'uploading', progress: 70, message: 'Saving records to database...', caseId: effectiveCaseId });

      try {
        const insertedCount = await ildAPI.insertRecords(effectiveCaseId, allParsedData as unknown as Record<string, unknown>[]);
        console.log(`[ILDUpload] Saved ${insertedCount} records to database`);
      } catch (dbError) {
        console.warn('[ILDUpload] Database insert failed (continuing with client-side data):', dbError);
      }

      setUploadState({
        status: 'success',
        progress: 100,
        message: `Success! ${allParsedData.length} records parsed from ${selectedFiles.length} file(s).`,
        caseId: effectiveCaseId
      });

      setTimeout(() => {
        if (onUploadSuccess) {
          onUploadSuccess(effectiveCaseId, effectiveCaseName, resolvedOperator, allParsedData, selectedFiles.length);
        }
      }, 1500);

      setFormData({
        caseName: caseName || '',
        caseNumber: '',
        operator: (caseOperator || 'AUTO').toUpperCase(),
        description: '',
        startDate: '',
        endDate: ''
      });
      setSelectedFiles([]);
    } catch (error: unknown) {
      console.error('Upload error details:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setUploadState({
        status: 'error',
        progress: 0,
        message: `Error: ${errorMessage}`
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-background-light dark:bg-background-dark text-slate-900 dark:text-white overflow-hidden font-display relative z-0">
      <header className="h-16 border-b border-border-light dark:border-slate-800 bg-surface-light dark:bg-surface-dark flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <span className="material-symbols-outlined text-amber-600 dark:text-amber-400 text-2xl">call_merge</span>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">ILD Upload</h1>
          <span className="px-2 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-[10px] font-bold uppercase rounded">International Long Distance</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-xs font-mono">
            <span className="material-symbols-outlined text-sm">schedule</span>
            {formatTime(currentTime)}
          </div>
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs font-bold uppercase tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
            ILD Mode
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-surface-light dark:bg-surface-dark border border-border-light dark:border-slate-800 rounded-2xl shadow-lg overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-amber-500/5 to-orange-500/5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">call</span>
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">New ILD Case</h2>
                  <p className="text-xs text-slate-500">International Long Distance records with Jio header mapping</p>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase mb-2">Case Name *</label>
                  <input
                    type="text"
                    name="caseName"
                    value={formData.caseName}
                    onChange={handleInputChange}
                    placeholder="e.g., ILD Investigation 2025/001"
                    className="w-full px-4 py-3 rounded-lg bg-slate-50 dark:bg-background-dark border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase mb-2">Case Number</label>
                  <input
                    type="text"
                    name="caseNumber"
                    value={formData.caseNumber}
                    onChange={handleInputChange}
                    placeholder="e.g., FIR-2025-ILD-001"
                    className="w-full px-4 py-3 rounded-lg bg-slate-50 dark:bg-background-dark border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">ILD Format *</label>
                {manualOperator && (
                <select
                  name="operator"
                  value={formData.operator}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 rounded-lg bg-slate-50 dark:bg-background-dark border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all font-medium"
                >
                  <option value="">Select operator</option>
                  <option value="Auto">Auto</option>
                  {ILD_OPERATORS.map(op => (
                    <option key={op.value} value={op.value}>{op.label}</option>
                  ))}
                </select>
                )}
                <div className="flex items-center mt-2">
                  <input type="checkbox" id="manualOperator" checked={manualOperator} onChange={(e) => setManualOperator(e.target.checked)} className="mr-2" />
                  <label htmlFor="manualOperator" className="text-sm text-slate-600 dark:text-slate-400">Enable manual operator selection</label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase mb-2">Description</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="Optional case description..."
                  rows={3}
                  className="w-full px-4 py-3 rounded-lg bg-slate-50 dark:bg-background-dark border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all font-medium resize-none"
                />
              </div>

              <div className="border-t border-slate-200 dark:border-slate-700 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-amber-600 dark:text-amber-400">upload_file</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white">ILD Files</span>
                    <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">Jio ILD CSV/Excel files</p>
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

              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                  isDragging 
                    ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-500/5' 
                    : 'border-slate-300 dark:border-slate-700 hover:border-amber-400 dark:hover:border-amber-500'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xls,.xlsx"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
                />

                {selectedFiles.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {selectedFiles.length} file(s) selected
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {selectedFiles.map((file, index) => (
                        <div key={index} className="flex items-center justify-between bg-slate-100 dark:bg-slate-800 px-3 py-2 rounded text-xs">
                          <span className="truncate">{file.name}</span>
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
                    <span className={`material-symbols-outlined text-4xl transition-colors ${isDragging ? 'text-amber-500' : 'text-slate-500 dark:text-slate-600'}`}>
                      upload_file
                    </span>
                    <p className="text-sm text-slate-600 dark:text-slate-500 font-medium">
                      Drag & drop files here or <span className="text-amber-500 underline">browse</span>
                    </p>
                    <p className="text-xs text-slate-400">Supports multiple ILD CSV/Excel files</p>
                  </>
                )}
              </div>

              <button
                onClick={handleSubmit}
                disabled={uploadState.status === 'uploading'}
                className="w-full py-4 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploadState.status === 'uploading' ? (
                  <>
                    <span className="material-symbols-outlined animate-spin">sync</span>
                    {uploadState.message}
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined">rocket_launch</span>
                    Analyze ILD Records
                  </>
                )}
              </button>

              {uploadState.status === 'uploading' && (
                <div className="h-1 bg-slate-200 dark:bg-slate-700">
                  <div 
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-500" 
                    style={{ width: `${uploadState.progress}%` }}
                  />
                </div>
              )}

              {uploadState.status === 'error' && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
                  {uploadState.message}
                </div>
              )}

              {uploadState.status === 'success' && (
                <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg text-emerald-700 dark:text-emerald-400 text-sm">
                  {uploadState.message}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
