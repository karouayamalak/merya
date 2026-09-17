/**
 * orderService.js (Facade)
 *
 * Modularized domain implementation lives in ./order/:
 * - orderFingerprint.js: Deterministic SHA-256 fingerprinting for idempotency
 * - placeOrder.js: Transactional order placement with CAS & inventory deduction
 * - statusTransition.js: Transactional state transitions & inventory restoration
 * - financialAnalytics.js: Authoritative delivered revenue & realized profit aggregations
 * - orderItemEditing.js: Transactional line-item editing & historical price protection
 */

export {
  computeOrderFingerprint,
  placeOrder,
  updateOrderStatus,
  getFinancialAnalytics,
  updateOrderItemsService
} from './order/index.js';
