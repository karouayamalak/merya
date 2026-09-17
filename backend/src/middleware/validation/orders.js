import { z } from 'zod';
import { DELIVERY_METHODS, ORDER_STATUS } from '../../config/constants.js';

// Checkout order validation schema
export const checkoutOrderSchema = z.object({
  idempotencyKey: z.string({ required_error: 'Idempotency key is required' })
    .min(8, 'Idempotency key must be at least 8 characters')
    .max(128, 'Idempotency key cannot exceed 128 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Idempotency key must be 8-128 alphanumeric characters, dashes, or underscores'),
  customer: z.object({
    fullName: z.string().min(2, 'Full name is required (min 2 characters)').max(100),
    phone: z.string().min(8, 'Phone number must be at least 8 digits').max(20),
    wilaya: z.object({
      code: z.number().int().min(1).max(58),
      name: z.string().min(2)
    }),
    deliveryMethod: z.enum([DELIVERY_METHODS.AGENCY, DELIVERY_METHODS.HOME]),
    agencyName: z.string().optional(),
    address: z.string().optional(),
    notes: z.string().max(500).optional()
  }).superRefine((data, ctx) => {
    if (data.deliveryMethod === DELIVERY_METHODS.AGENCY) {
      if (!data.agencyName || typeof data.agencyName !== 'string' || data.agencyName.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Agency name is required for agency delivery',
          path: ['agencyName']
        });
      } else if (data.agencyName.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Agency name must be at least 2 characters',
          path: ['agencyName']
        });
      } else if (data.agencyName.trim().length > 100) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Agency name cannot exceed 100 characters',
          path: ['agencyName']
        });
      }
    } else if (data.deliveryMethod === DELIVERY_METHODS.HOME) {
      if (!data.address || typeof data.address !== 'string' || data.address.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Detailed delivery address is required for home delivery',
          path: ['address']
        });
      } else if (data.address.trim().length < 4) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Detailed delivery address is required for home delivery (min 4 characters)',
          path: ['address']
        });
      } else if (data.address.trim().length > 300) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Address cannot exceed 300 characters',
          path: ['address']
        });
      }
    }
  }),
  items: z.array(z.object({
    productId: z.string().min(1, 'Product ID required'),
    colorName: z.string().min(1, 'Color is required'),
    size: z.string().min(1, 'Size is required'),
    quantity: z.number().int().min(1, 'Quantity must be at least 1').max(20)
  })).min(1, 'At least one item is required in cart')
});

// Cart quote validation schema
export const cartQuoteSchema = z.object({
  items: z.array(z.object({
    productId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid productId MongoDB ObjectId'),
    colorName: z.string().min(1).max(100),
    size: z.string().min(1).max(50),
    quantity: z.number().int().min(1).max(20),
    productName: z.string().max(200).optional(),
    unitPrice: z.number().int().positive().optional(),
    originalPrice: z.number().int().positive().optional(),
    colorCode: z.string().optional(),
    slug: z.string().optional(),
    image: z.string().optional()
  })).min(1, 'At least one item is required').max(50, 'Cannot quote more than 50 items at once'),
  wilayaCode: z.union([
    z.number().int().min(1).max(58),
    z.string().regex(/^(?:[1-9]|[1-4][0-9]|5[0-8])$/).transform(v => parseInt(v, 10))
  ]).optional(),
  deliveryMethod: z.enum([DELIVERY_METHODS.AGENCY, DELIVERY_METHODS.HOME]).optional()
});

// Tracking verification schema
export const trackingSchema = z.object({
  phone: z.string().min(8).max(20),
  orderCode: z.string().min(6).max(20)
});

// Status change schema
export const statusChangeSchema = z.object({
  status: z.enum(Object.values(ORDER_STATUS)),
  note: z.string().max(200).optional(),
  override: z.boolean().optional().default(false),
  overrideReason: z.string().max(500).optional()
}).superRefine((data, ctx) => {
  if (data.override === true) {
    if (!data.overrideReason || data.overrideReason.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['overrideReason'],
        message: 'overrideReason is required when override is true'
      });
    }
  }
});
