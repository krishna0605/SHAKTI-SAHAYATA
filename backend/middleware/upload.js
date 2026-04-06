import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '52428800'); // 50MB

// Allowed MIME types for telecom data files
const ALLOWED_MIMES = [
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream', // Some CSVs come through as this
];

const ALLOWED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${Date.now()}-${randomUUID()}${ext}`;
    cb(null, uniqueName);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    cb(new Error(`Invalid file type: ${ext}. Only CSV and Excel files are allowed.`), false);
    return;
  }

  cb(null, true);
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
  },
});

// Error handler middleware for multer errors
export function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `File too large. Maximum size is ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB.`,
        code: 'FILE_TOO_LARGE',
      });
    }
    return res.status(400).json({ error: err.message, code: 'UPLOAD_ERROR' });
  }
  if (err) {
    return res.status(400).json({ error: err.message, code: 'UPLOAD_ERROR' });
  }
  next();
}
