/**
 * Strict Pagination Parameter Parser and Validator.
 * Rejects NaN, Infinity, negative values, decimals, and malformed strings with HTTP 400.
 * Enforces positive integer page (1..10000) and bounded positive integer limit (1..maxLimit).
 */
export function parsePaginationParams(query = {}, { defaultLimit = 24, maxLimit = 100, maxPage = 10000 } = {}) {
  const rawPage = query.page !== undefined ? query.page : 1;
  const rawLimit = query.limit !== undefined ? query.limit : defaultLimit;

  // Validate page
  let pageNum;
  if (typeof rawPage === 'number') {
    if (!Number.isFinite(rawPage) || !Number.isInteger(rawPage) || rawPage < 1) {
      return { valid: false, error: 'page must be a positive integer.' };
    }
    pageNum = rawPage;
  } else if (typeof rawPage === 'string') {
    const trimmed = rawPage.trim();
    if (!/^[1-9]\d*$/.test(trimmed)) {
      return { valid: false, error: 'page must be a positive integer.' };
    }
    pageNum = parseInt(trimmed, 10);
  } else {
    return { valid: false, error: 'page must be a positive integer.' };
  }

  if (pageNum > maxPage) {
    return { valid: false, error: `page cannot exceed ${maxPage}.` };
  }

  // Validate limit
  let limitNum;
  if (typeof rawLimit === 'number') {
    if (!Number.isFinite(rawLimit) || !Number.isInteger(rawLimit) || rawLimit < 1) {
      return { valid: false, error: 'limit must be a positive integer.' };
    }
    limitNum = rawLimit;
  } else if (typeof rawLimit === 'string') {
    const trimmed = rawLimit.trim();
    if (!/^[1-9]\d*$/.test(trimmed)) {
      return { valid: false, error: 'limit must be a positive integer.' };
    }
    limitNum = parseInt(trimmed, 10);
  } else {
    return { valid: false, error: 'limit must be a positive integer.' };
  }

  if (limitNum > maxLimit) {
    return { valid: false, error: `limit cannot exceed ${maxLimit}.` };
  }

  const skip = (pageNum - 1) * limitNum;
  return { valid: true, pageNum, limitNum, skip };
}
