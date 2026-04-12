export const toInt = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : null;
};

export const parsePaginationParams = (query = {}) => {
  const page = toInt(query.page);
  const pageSize = toInt(query.pageSize || query.limit);

  if (!page || !pageSize) {
    return {
      paginated: false,
      page: 1,
      pageSize: 0,
      offset: 0,
    };
  }

  const safePage = Math.max(1, page);
  const safePageSize = Math.max(1, Math.min(500, pageSize));

  return {
    paginated: true,
    page: safePage,
    pageSize: safePageSize,
    offset: (safePage - 1) * safePageSize,
  };
};

export const buildPaginationPayload = ({ page, pageSize, total }) => ({
  page,
  pageSize,
  total: Number(total || 0) || 0,
});

export const asText = (value) => String(value || '').trim();

export const parseCsvIntList = (value) => {
  if (value === undefined || value === null) return [];
  return String(value)
    .split(',')
    .map((entry) => toInt(entry.trim()))
    .filter((entry) => entry !== null && entry > 0);
};
