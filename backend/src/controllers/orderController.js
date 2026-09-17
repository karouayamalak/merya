/**
 * orderController.js (Facade)
 *
 * Modularized controller endpoints live in ./order/:
 * - checkoutController.js: Public checkout & authoritative cart quotes
 * - adminOrderQueryController.js: Admin order listing, filtering, pagination & detail queries
 * - orderStatusController.js: State transitions & admin overrides
 * - customerDetailsController.js: Customer destination & delivery fee recalculation
 * - inventoryAdjustController.js: Direct stock adjustments with audit logging
 * - orderItemsController.js: Admin line item edits & price override protection
 */

export {
  checkout,
  getCartQuote,
  getAllOrdersAdmin,
  getOrderByIdAdmin,
  changeOrderStatus,
  updateOrderCustomerDetails,
  adjustVariantStock,
  updateOrderItems
} from './order/index.js';
