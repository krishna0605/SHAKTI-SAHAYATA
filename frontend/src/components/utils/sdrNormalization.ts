/**
 * SDR Normalization - Multi-operator CSV parsing for Subscriber Data Records
 * Uses mapping.json to normalize various column names to standard fields
 */

import mappingData from './mappings/sdrMapping.json';

export interface NormalizedSDR {
  [key: string]: string | number | null;
}

// Load mapping from JSON
const SDR_MAPPING: Record<string, string[] | string[][]> = mappingData;

// Reverse mapping: column name -> standard field
const COLUMN_TO_FIELD: Record<string, string> = {};

for (const [standardField, variations] of Object.entries(SDR_MAPPING)) {
  const flatVariations = Array.isArray(variations[0]) ? variations.flat() : variations;
  for (const variation of flatVariations) {
    if (typeof variation === 'string') {
      COLUMN_TO_FIELD[variation.toLowerCase().trim()] = standardField;
    }
  }
}

// Normalize header for matching (lowercase, trim, remove special chars)
const normalizeHeader = (header: string): string => {
  return header.toLowerCase().trim()
    .replace(/[_\-()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

// Find standard field for a header
const findStandardField = (header: string): string | null => {
  const normalized = normalizeHeader(header);

  // Direct match
  if (COLUMN_TO_FIELD[normalized]) {
    return COLUMN_TO_FIELD[normalized];
  }

  // Partial match
  for (const [col, field] of Object.entries(COLUMN_TO_FIELD)) {
    if (normalized.includes(col) || col.includes(normalized)) {
      return field;
    }
  }

  return null;
};

// Infer field type from sample value
const inferFieldFromValue = (value: string): string | null => {
  if (!value || value.length < 2) return null;

  const val = value.toLowerCase().trim();

  // Phone number patterns
  if (/^\d{10,15}$/.test(val.replace(/[-\s]/g, ''))) {
    return 'TelephoneNumber';
  }

  // Email pattern
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
    return 'Email ID';
  }

  // Date patterns
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(val) || /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    return 'Date Of Birth'; // Could be activation date too
  }

  // Gender
  if (['male', 'female', 'm', 'f', 'other'].includes(val)) {
    return 'Gender';
  }

  // ID numbers (long numbers)
  if (/^\d{12,16}$/.test(val.replace(/\s/g, ''))) {
    return 'IDCard';
  }

  // Names (contains letters, possibly with spaces)
  if (/^[a-zA-Z\s]{3,50}$/.test(val) && !val.includes('@')) {
    return 'Name of Subscriber';
  }

  // Addresses (longer text with numbers/commas)
  if (val.length > 10 && (val.includes(',') || val.includes('!') || /\d/.test(val))) {
    return 'Permanent Address';
  }

  return null;
};

// Parse CSV content and return normalized records
export const parseSDRCsv = (csvContent: string): NormalizedSDR[] => {
  console.log(`[SDR Parser] ======= STARTING PARSE =======`);
  console.log(`[SDR Parser] Content length: ${csvContent.length} chars`);

  // Handle single-line data (no line breaks)
  let lines: string[];
  if (!csvContent.includes('\n') && !csvContent.includes('\r')) {
    // Single line data - treat as one record
    lines = [csvContent];
    console.log(`[SDR Parser] Detected single-line data, treating as one record`);
  } else {
    lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
  }

  console.log(`[SDR Parser] Total lines: ${lines.length}`);

  if (lines.length < 2) {
    console.error('[SDR Parser] CSV has less than 2 lines!');
    return [];
  }

  // Detect delimiter by analyzing the first few lines
  const detectDelimiter = (sampleLines: string[]): string => {
    const delimiters = [',', '|', ';', '\t', '!']; // Added ! as potential delimiter
    let bestDelimiter = '|'; // Default to pipe since it's common in SDR data
    let maxColumns = 0;

    for (const delimiter of delimiters) {
      const columnCounts = sampleLines.map(line => {
        // Simple split for detection - count occurrences
        const parts = line.split(delimiter);
        return parts.length;
      });
      const avgColumns = columnCounts.reduce((a, b) => a + b, 0) / columnCounts.length;

      console.log(`[SDR Parser] Testing delimiter '${delimiter}': avg ${avgColumns.toFixed(1)} columns`);

      // Prefer delimiters that give more columns
      if (avgColumns > maxColumns && avgColumns > 3) { // Reduced requirement
        maxColumns = avgColumns;
        bestDelimiter = delimiter;
      }
    }

    console.log(`[SDR Parser] Selected delimiter: '${bestDelimiter}' (${maxColumns} columns)`);
    return bestDelimiter;
  };

  const delimiter = detectDelimiter(lines.slice(0, Math.min(5, lines.length)));
  console.log(`[SDR Parser] Using delimiter: '${delimiter}'`);

  // For single-line data, skip header detection and treat as headerless
  let rawHeaders: string[];
  let actualHeaderRowIndex = -1;

  if (lines.length === 1) {
    // Single line data - create generic headers
    const columnCount = lines[0].split(delimiter).length;
    rawHeaders = Array.from({ length: columnCount }, (_, i) => `Column_${i + 1}`);
    console.log(`[SDR Parser] Single-line data detected, using generic headers:`, rawHeaders);
  } else {
    // Multi-line data - try to detect headers
    // Find the actual header row (skip metadata rows)
    let headerRowIndex = 0;
    const headerKeywords = ['name', 'number', 'mobile', 'phone', 'address', 'date', 'id', 'subscriber', 'customer', 'poi', 'poa'];

    // First, try to find a row with many columns (likely data/header row)
    let maxColumns = 0;

    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const columnCount = lines[i].split(delimiter).length;
      if (columnCount > maxColumns) {
        maxColumns = columnCount;
        headerRowIndex = i;
      }
    }

    // Use the row with most columns as potential header, but check for keywords
    for (let i = 0; i < Math.min(20, lines.length); i++) {
      const lineLower = lines[i].toLowerCase();
      const columnCount = lines[i].split(delimiter).length;

      // Skip lines with very few columns
      if (columnCount < 5) continue;

      // Check if this line has SDR-related keywords
      const matchCount = headerKeywords.filter(keyword => lineLower.includes(keyword)).length;

      if (matchCount >= 1 || columnCount >= maxColumns - 2) { // Accept if has keywords OR is close to max columns
        headerRowIndex = i;
        console.log(`[SDR Parser] Found header row at line ${i + 1} (${columnCount} columns, ${matchCount} keywords)`);
        break;
      }
    }

    console.log(`[SDR Parser] Using line ${headerRowIndex + 1} as header row`);

    // Check if we actually have headers or if this is headerless data
    const potentialHeaders = lines[headerRowIndex].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
    const looksLikeHeaders = potentialHeaders.some(h =>
      headerKeywords.some(keyword => h.toLowerCase().includes(keyword))
    );

    if (looksLikeHeaders) {
      rawHeaders = potentialHeaders;
      actualHeaderRowIndex = headerRowIndex;
      console.log(`[SDR Parser] Detected headers:`, rawHeaders.slice(0, 10));
    } else {
      // Create generic headers for headerless data
      const columnCount = lines[headerRowIndex].split(delimiter).length;
      rawHeaders = Array.from({ length: columnCount }, (_, i) => `Column_${i + 1}`);
      console.log(`[SDR Parser] No headers detected, using generic headers:`, rawHeaders);
      // This row is actually data, so start parsing from this row
      actualHeaderRowIndex = -1; // Signal that we don't have a header row
    }
  }

  console.log(`[SDR Parser] Final headers (${rawHeaders.length}):`, rawHeaders);

  // Determine data start index
  const dataStartIndex = actualHeaderRowIndex >= 0 ? actualHeaderRowIndex + 1 : 0;

  // Build header to field mapping
  const headerToField: Record<number, string> = {};
  const mappedHeaders: string[] = [];
  const unmappedHeaders: string[] = [];

  // If we have generic headers (single-line or headerless), try to infer mapping from the data
  if (actualHeaderRowIndex === -1 && dataStartIndex < lines.length) {
    const firstDataRow = lines[dataStartIndex].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
    console.log(`[SDR Parser] Analyzing first data row for mapping:`, firstDataRow.slice(0, 10));

    rawHeaders.forEach((header, index) => {
      const sampleValue = firstDataRow[index] || '';
      const inferredField = inferFieldFromValue(sampleValue);
      if (inferredField) {
        headerToField[index] = inferredField;
        mappedHeaders.push(`Column_${index + 1} -> ${inferredField} (from "${sampleValue.substring(0, 20)}...")`);
      } else {
        unmappedHeaders.push(header);
      }
    });
  } else {
    // Normal header mapping
    rawHeaders.forEach((header, index) => {
      const field = findStandardField(header);
      if (field) {
        headerToField[index] = field;
        mappedHeaders.push(`"${header}" -> ${field}`);
      } else {
        unmappedHeaders.push(header);
      }
    });
  }

  console.log(`[SDR Parser] Mapped ${mappedHeaders.length} columns:`);
  mappedHeaders.forEach(m => console.log(`  - ${m}`));

  if (unmappedHeaders.length > 0) {
    console.log(`[SDR Parser] Unmapped columns (${unmappedHeaders.length}):`, unmappedHeaders.join(', '));
  }

  if (mappedHeaders.length === 0) {
    console.error('[SDR Parser] NO COLUMNS MAPPED! Headers might not match expected format.');
    console.log('[SDR Parser] Please check if headers match: name, mobile, address, date, etc.');
    return [];
  }

  const results: NormalizedSDR[] = [];

  // Start parsing data rows
  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Parse CSV row (handle quoted values with detected delimiter)
    const row: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        row.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current.trim().replace(/^"|"$/g, ''));

    if (row.length <= 1 || row.every(v => !v)) continue; // Skip empty rows

    const normalized: NormalizedSDR = {};

    Object.entries(headerToField).forEach(([indexStr, field]) => {
      const index = parseInt(indexStr);
      const value = row[index] || '';

      if (!value || value === 'NULL' || value === 'null' || value === '-' || value === 'NA' || value === 'N/A') {
        normalized[field] = null;
      } else {
        normalized[field] = value;
      }
    });

    // Include if we have at least some data
    if (Object.values(normalized).some(v => v !== null)) {
      results.push(normalized);
    }
  }

  console.log(`[SDR Parser] Parsed ${results.length} valid records`);
  if (results.length > 0) {
    console.log('[SDR Parser] Sample record keys:', Object.keys(results[0]));
    console.log('[SDR Parser] Sample record (first 3 fields):', JSON.stringify(Object.fromEntries(Object.entries(results[0]).slice(0, 3)), null, 2));
  } else {
    console.error('[SDR Parser] NO RECORDS PARSED! First few data rows:');
    for (let i = 1; i < Math.min(4, lines.length); i++) {
      console.log(`  Row ${i}: ${lines[i].substring(0, 200)}...`);
      const testParse = lines[i].split(delimiter);
      console.log(`  Parsed into ${testParse.length} columns: [${testParse.slice(0, 5).join(', ')}...]`);
    }
  }
  console.log(`[SDR Parser] ======= PARSE COMPLETE =======`);

  return results;
};

// Alias
export const normalizeSDRCsv = parseSDRCsv;
