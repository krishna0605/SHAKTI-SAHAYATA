/* ── File Classifier — Heuristic Scoring Engine (§16.2) ── */
import fs from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

/* Each file type has known column headers. We score how many match. */
const FILE_TEMPLATES = {
  cdr: {
    required: ['a_party', 'b_party', 'call_date', 'duration'],
    optional: ['call_type', 'call_time', 'imei', 'imsi', 'cell_id', 'roaming'],
    aliases: {
      'calling_number': 'a_party', 'caller': 'a_party', 'calling': 'a_party',
      'called_number': 'b_party', 'called': 'b_party', 'callee': 'b_party',
      'date': 'call_date', 'call_start_date': 'call_date', 'date_time': 'call_date',
      'duration_sec': 'duration', 'call_duration': 'duration', 'dur': 'duration',
      'type': 'call_type', 'call_category': 'call_type',
      'first_cell_id': 'cell_id', 'cell_id_a': 'cell_id',
    }
  },
  ipdr: {
    required: ['source_ip', 'start_time'],
    optional: ['destination_ip', 'msisdn', 'imsi', 'uplink_volume', 'downlink_volume', 'cell_id', 'port'],
    aliases: {
      'src_ip': 'source_ip', 'private_ip': 'source_ip', 'source': 'source_ip',
      'dest_ip': 'destination_ip', 'dst_ip': 'destination_ip', 'public_ip': 'destination_ip',
      'session_start_time': 'start_time', 'allocation_start_time': 'start_time', 'event_start_time': 'start_time',
      'subscriber_msisdn': 'msisdn', 'mobile_number': 'msisdn',
      'data_volume_uplink': 'uplink_volume', 'ul_bytes': 'uplink_volume',
      'data_volume_downlink': 'downlink_volume', 'dl_bytes': 'downlink_volume',
      'source_port': 'port', 'src_port': 'port',
    }
  },
  sdr: {
    required: ['subscriber_name', 'msisdn'],
    optional: ['imsi', 'imei', 'activation_date', 'address', 'id_proof_type', 'id_proof_number'],
    aliases: {
      'name': 'subscriber_name', 'customer_name': 'subscriber_name', 'applicant_name': 'subscriber_name',
      'mobile_number': 'msisdn', 'phone_number': 'msisdn', 'mdn': 'msisdn',
      'sim_activation': 'activation_date', 'doa': 'activation_date',
      'document_type': 'id_proof_type', 'kyc_type': 'id_proof_type',
    }
  },
  tower_dump: {
    required: ['cell_id', 'imsi'],
    optional: ['a_party', 'imei', 'call_date', 'call_time', 'duration_sec', 'lat', 'long', 'azimuth', 'site_name'],
    aliases: {
      'tower_id': 'cell_id', 'cgi': 'cell_id', 'first_cell_id': 'cell_id',
      'calling_number': 'a_party', 'msisdn': 'a_party',
      'latitude': 'lat', 'longitude': 'long', 'lng': 'long',
    }
  },
  ild: {
    required: ['calling_number', 'called_number', 'country_code'],
    optional: ['call_date', 'call_time', 'duration', 'call_direction', 'imei'],
    aliases: {
      'caller': 'calling_number', 'a_party': 'calling_number', 'calling_party': 'calling_number',
      'callee': 'called_number', 'b_party': 'called_number', 'called_party': 'called_number',
      'destination_country': 'country_code', 'intl_code': 'country_code',
      'call_duration': 'duration', 'duration_sec': 'duration',
    }
  }
};

function normalizeHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export function extractHeadersFromFile(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();

  if (ext === '.csv') {
    const raw = fs.readFileSync(filePath, 'utf8');
    const [firstLine = ''] = raw.split(/\r?\n/, 1);
    return firstLine
      .split(',')
      .map((header) => header.replace(/^"|"$/g, '').trim())
      .filter(Boolean);
  }

  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.readFile(filePath, { cellDates: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return [];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, raw: false });
    const firstRow = Array.isArray(rows[0]) ? rows[0] : [];
    return firstRow.map((header) => String(header || '').trim()).filter(Boolean);
  }

  return [];
}

function scoreAgainstTemplate(headers, template) {
  const normalized = headers.map(normalizeHeader);
  let matched = 0;
  const matchedHeaders = [];
  const allExpected = [...template.required, ...template.optional];
  const aliasMap = template.aliases || {};

  for (const expected of allExpected) {
    if (normalized.includes(expected)) { matched++; matchedHeaders.push(expected); continue; }
    const aliasHit = Object.entries(aliasMap).find(([alias]) => normalized.includes(alias));
    if (aliasHit && aliasHit[1] === expected) { matched++; matchedHeaders.push(`${aliasHit[0]}->${expected}`); }
  }

  let requiredMatched = 0;
  for (const req of template.required) {
    if (normalized.includes(req)) { requiredMatched++; continue; }
    const aliasHit = Object.entries(aliasMap).find(([a]) => normalized.includes(a) && aliasMap[a] === req);
    if (aliasHit) requiredMatched++;
  }

  const total = allExpected.length;
  const confidence = total > 0 ? matched / total : 0;
  const requiredCoverage = template.required.length > 0 ? requiredMatched / template.required.length : 0;
  return { matched, total, matchedHeaders, confidence, requiredCoverage };
}

export function classifyFile(headers, expectedType) {
  const normalizedExpectedType = String(expectedType || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  const scores = {};
  let bestType = null;
  let bestScore = 0;

  for (const [type, template] of Object.entries(FILE_TEMPLATES)) {
    const score = scoreAgainstTemplate(headers, template);
    scores[type] = score;
    if (score.confidence > bestScore) { bestScore = score.confidence; bestType = type; }
  }

  const expectedScore = scores[normalizedExpectedType];
  const bestMetrics = bestType ? scores[bestType] : null;

  if (!expectedScore || expectedScore.confidence < 0.15) {
    if (bestScore >= 0.3) {
      return {
        result: 'WRONG_TYPE',
        detectedType: bestType,
        confidence: bestScore,
        scores,
        matchedColumns: bestMetrics?.matched ?? 0,
        totalColumns: Array.isArray(headers) ? headers.length : 0,
        message: `Expected ${normalizedExpectedType || 'unknown'}, detected ${bestType || 'unknown'}.`
      };
    }
    return {
      result: 'REJECTED',
      detectedType: null,
      confidence: 0,
      scores,
      matchedColumns: 0,
      totalColumns: Array.isArray(headers) ? headers.length : 0,
      message: 'Could not classify file from the detected headers.'
    };
  }
  if (expectedScore.requiredCoverage < 0.5) {
    if (bestType !== expectedType && bestScore > expectedScore.confidence + 0.15)
      return {
        result: 'WRONG_TYPE',
        detectedType: bestType,
        confidence: bestScore,
        scores,
        matchedColumns: bestMetrics?.matched ?? 0,
        totalColumns: Array.isArray(headers) ? headers.length : 0,
        message: `Expected ${normalizedExpectedType}, but headers align better with ${bestType}.`
      };
    return {
      result: 'REJECTED',
      detectedType: normalizedExpectedType,
      confidence: expectedScore.confidence,
      scores,
      matchedColumns: expectedScore.matched,
      totalColumns: Array.isArray(headers) ? headers.length : 0,
      message: `Required ${normalizedExpectedType.toUpperCase()} columns are missing.`
    };
  }
  if (bestType !== normalizedExpectedType && bestScore > expectedScore.confidence + 0.2)
    return {
      result: 'WRONG_TYPE',
      detectedType: bestType,
      confidence: bestScore,
      scores,
      matchedColumns: bestMetrics?.matched ?? 0,
      totalColumns: Array.isArray(headers) ? headers.length : 0,
      message: `Expected ${normalizedExpectedType}, but detected ${bestType}.`
    };

  return {
    result: 'ACCEPTED',
    detectedType: normalizedExpectedType,
    confidence: expectedScore.confidence,
    scores,
    matchedColumns: expectedScore.matched,
    totalColumns: Array.isArray(headers) ? headers.length : 0,
    message: `${normalizedExpectedType.toUpperCase()} headers accepted.`
  };
}

export default { classifyFile };
