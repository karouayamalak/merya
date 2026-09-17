/**
 * validation.js (Facade)
 *
 * Modularized validation schemas live in ./validation/:
 * - common.js: validate middleware, localized schemas, variant uniqueness check
 * - auth.js: adminLoginSchema
 * - orders.js: checkoutOrderSchema, cartQuoteSchema, trackingSchema, statusChangeSchema
 * - products.js: productSchema, updateProductSchema
 * - categories.js: categorySchema, updateCategorySchema
 * - banners.js: bannerSchema, updateBannerSchema
 */

export {
  validate,
  localizedStringSchema,
  multilingualStringSchema,
  localizedFieldSchema,
  validateVariantUniqueness,
  adminLoginSchema,
  checkoutOrderSchema,
  cartQuoteSchema,
  trackingSchema,
  statusChangeSchema,
  productSchema,
  updateProductSchema,
  categorySchema,
  updateCategorySchema,
  bannerSchema,
  updateBannerSchema
} from './validation/index.js';
