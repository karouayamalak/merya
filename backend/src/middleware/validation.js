import { z } from 'zod';
import { DELIVERY_METHODS, ORDER_STATUS } from '../config/constants.js';

export const validate = (schema) => (req, res, next) => {
  try {
    const parsed = schema.parse(req.body);
    req.body = parsed;
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: issues
      });
    }
    next(error);
  }
};

// Checkout order validation schema
export const checkoutOrderSchema = z.object({
  idempotencyKey: z.string().optional(),
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

// Tracking verification schema
export const trackingSchema = z.object({
  phone: z.string().min(8).max(20),
  orderCode: z.string().min(6).max(20)
});

// Admin login schema
export const adminLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

// Product validation schema
export const productSchema = z.object({
  name: z.string().min(3).max(150),
  description: z.string().min(5),
  category: z.string().min(1),
  sellingPrice: z.number().positive(),
  costPrice: z.number().nonnegative(),
  isActive: z.boolean().optional(),
  isBestSeller: z.boolean().optional(),
  colors: z.array(z.object({
    colorName: z.string().min(1),
    colorCode: z.string().min(1),
    images: z.array(z.string()).min(1, 'At least one image is required per color'),
    sizes: z.array(z.object({
      size: z.enum(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Standard', 'One Size'])
      // stock is intentionally absent: initial stock is always 0.
      // Use the inventory adjustment endpoint (POST /admin/inventory/adjust) to set stock.
    })).min(1, 'At least one size is required')
  })).min(1, 'At least one color variant is required')
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
