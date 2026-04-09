const DEFAULT_IST_OFFSET = '+05:30';

const MONTHS = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

const isBlank = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  return !normalized || ['-', '--', '---', 'null', 'undefined', 'n/a', 'na'].includes(normalized);
};

const pad2 = (value) => String(value).padStart(2, '0');

const normalizeYear = (value) => {
  const year = String(value ?? '').trim();
  if (year.length === 2) {
    const numeric = Number.parseInt(year, 10);
    return numeric >= 70 ? `19${year}` : `20${year}`;
  }
  return year;
};

export const normalizeDateString = (value) => {
  if (isBlank(value)) return null;

  const trimmed = String(value).trim();

  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const slashMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    let [, first, second, year] = slashMatch;
    const firstNum = Number.parseInt(first, 10);
    const secondNum = Number.parseInt(second, 10);
    year = normalizeYear(year);

    // Default to day-first, but recover obvious month-first inputs like 8/31/24.
    const [day, month] =
      secondNum > 12 && firstNum <= 12
        ? [second, first]
        : [first, second];

    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  const monthNameMatch = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (monthNameMatch) {
    const [, day, monthToken, yearToken] = monthNameMatch;
    const month = MONTHS[monthToken.toLowerCase()];
    if (!month) return null;
    return `${normalizeYear(yearToken)}-${month}-${pad2(day)}`;
  }

  return null;
};

export const normalizeTimeString = (value) => {
  if (isBlank(value)) return null;

  const trimmed = String(value).trim();
  const directMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (directMatch) {
    let [, hour, minute, second = '00'] = directMatch;
    const hourNum = Number.parseInt(hour, 10);
    if (hourNum < 0 || hourNum > 23) return null;
    return `${pad2(hour)}:${pad2(minute)}:${pad2(second)}`;
  }

  const meridiemMatch = trimmed.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\s*(AM|PM)$/i);
  if (meridiemMatch) {
    let [, hour, minute, second = '00', meridiem] = meridiemMatch;
    let hourNum = Number.parseInt(hour, 10);
    if (hourNum < 1 || hourNum > 12) return null;
    if (meridiem.toUpperCase() === 'PM' && hourNum !== 12) hourNum += 12;
    if (meridiem.toUpperCase() === 'AM' && hourNum === 12) hourNum = 0;
    return `${pad2(hourNum)}:${pad2(minute)}:${pad2(second)}`;
  }

  return null;
};

const buildIstIsoString = (datePart, timePart) => `${datePart}T${timePart}${DEFAULT_IST_OFFSET}`;

export const combineDateAndTime = (dateValue, timeValue) => {
  const datePart = normalizeDateString(dateValue);
  const timePart = normalizeTimeString(timeValue);
  if (!datePart || !timePart) return null;
  return buildIstIsoString(datePart, timePart);
};

export const parseLooseTimestamp = (value) => {
  if (isBlank(value)) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }

  const trimmed = String(value).trim();

  const isoNoZoneMatch = trimmed.match(/^(\d{4}-\d{1,2}-\d{1,2})[T\s](\d{1,2}:\d{1,2}(?::\d{1,2})?)$/);
  if (isoNoZoneMatch) {
    const [, datePart, timePart] = isoNoZoneMatch;
    const normalizedDate = normalizeDateString(datePart);
    const normalizedTime = normalizeTimeString(timePart);
    if (normalizedDate && normalizedTime) {
      return buildIstIsoString(normalizedDate, normalizedTime);
    }
  }

  const dayFirstMatch = trimmed.match(/^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s+(.+)$/);
  if (dayFirstMatch) {
    const [, datePart, timePart] = dayFirstMatch;
    const combined = combineDateAndTime(datePart, timePart);
    if (combined) return combined;
  }

  const nativeDate = new Date(trimmed);
  if (
    Number.isFinite(nativeDate.getTime())
    && (/[zZ]$/.test(trimmed) || /[+\-]\d{2}:?\d{2}$/.test(trimmed))
  ) {
    return nativeDate.toISOString();
  }

  return null;
};

export const buildTimelineTimestamp = ({ eventTime, fallbackDate, fallbackTime, fallbackTimestamp }) => {
  if (eventTime) {
    return eventTime instanceof Date ? eventTime.toISOString() : eventTime;
  }

  const fromTimestamp = parseLooseTimestamp(fallbackTimestamp);
  if (fromTimestamp) return fromTimestamp;

  return combineDateAndTime(fallbackDate, fallbackTime);
};
