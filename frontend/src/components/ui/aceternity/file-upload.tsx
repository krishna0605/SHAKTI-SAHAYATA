"use client";
import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Upload, X } from "lucide-react";

export const FileUpload = ({
  onChange,
}: {
  onChange?: (files: File[]) => void;
}) => {
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (newFiles: File[]) => {
    const updated = [...files, ...newFiles];
    setFiles(updated);
    onChange && onChange(updated);
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full" onClick={handleClick}>
      <div className="relative overflow-hidden p-10 border border-dashed border-slate-300 dark:border-slate-800 rounded-[2rem] hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors group cursor-pointer">
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          multiple
          onChange={(e) => handleFileChange(Array.from(e.target.files || []))}
        />
        <div className="flex flex-col items-center justify-center space-y-4">
          <motion.div
            animate={{
              y: [0, -5, 0],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              repeatType: "reverse",
            }}
            className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-500"
          >
            <Upload className="w-8 h-8" />
          </motion.div>
          <div className="text-center">
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">
              Upload Files
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Drag and drop your files here or click to browse.
            </p>
          </div>
        </div>
      </div>
      {files.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {files.map((file, idx) => (
            <div
              key={idx}
              className="flex justify-between items-center p-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-950 shadow-sm"
            >
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-slate-800 flex items-center justify-center text-xs font-semibold text-blue-600 dark:text-blue-400">
                  {file.name.split('.').pop()?.toUpperCase() || 'FILE'}
                </div>
                <span className="text-sm text-slate-700 dark:text-slate-300 truncate max-w-[200px] sm:max-w-[400px]">
                  {file.name}
                </span>
              </div>
              <button
                className="text-slate-400 hover:text-red-500 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  const newFiles = files.filter((_, i) => i !== idx);
                  setFiles(newFiles);
                  onChange && onChange(newFiles);
                }}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
