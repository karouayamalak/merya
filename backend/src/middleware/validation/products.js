import { z } from 'zod';
import { localizedFieldSchema, validateVariantUniqueness } from './common.js';

// Product validation schema
export const productSchema = z.object({
  name: localizedFieldSchema(150),
  description: localizedFieldSchema(3000),
  category: z.string().min(1, 'Category is required'),
  sellingPrice: z.coerce.number().int({ message: 'Selling price must be an integer in DZD' }).positive({ message: 'Selling price must be positive' }).optional(),
  basePrice: z.coerce.number().int({ message: 'Base price must be an integer in DZD' }).positive({ message: 'Base price must be positive' }).optional(),
  costPrice: z.coerce.number().int({ message: 'Cost price must be an integer in DZD' }).nonnegative({ message: 'Cost price cannot be negative' }),
  promotion: z.object({
    active: z.boolean().default(false),
    promotionalPrice: z.union([
      z.coerce.number().int({ message: 'Promotional price must be an integer in DZD' }).positive({ message: 'Promotional price must be positive' }),
      z.null(),
      z.literal(''),
      z.undefined()
    ]).optional().transform(v => (v === '' || v === null || v === undefined) ? null : Number(v))
  }).optional(),
  isActive: z.boolean().optional(),
  isBestSeller: z.boolean().optional(),
  colors: z.array(z.object({
    _id: z.any().optional(),
    colorName: z.string().min(1, 'Color name is required').max(100),
    colorDisplayName: localizedFieldSchema(100).optional(),
    colorCode: z.string().min(1, 'Color code is required'),
    images: z.array(z.string()).min(1, 'At least one image is required per color'),
    sizes: z.array(z.object({
      _id: z.any().optional(),
      size: z.enum(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Standard', 'One Size']),
      stock: z.coerce.number().int().nonnegative().optional().default(0)
    })).min(1, 'At least one size is required')
  })).min(1, 'At least one color variant is required')
}).superRefine((data, ctx) => {
  const effectiveBase = data.sellingPrice ?? data.basePrice;
  if (!effectiveBase) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sellingPrice'],
      message: 'Selling price is required'
    });
  }
  if (data.promotion && data.promotion.active) {
    if (data.promotion.promotionalPrice === null || data.promotion.promotionalPrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['promotion', 'promotionalPrice'],
        message: 'Promotional price is required when promotion is active'
      });
    } else if (effectiveBase && data.promotion.promotionalPrice >= effectiveBase) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['promotion', 'promotionalPrice'],
        message: 'Promotional price must be strictly lower than base price'
      });
    }
  }

  // Publishing completeness check
  if (data.isActive === true) {
    const n = data.name || {};
    const d = data.description || {};
    if (!n.fr?.trim() || !n.ar?.trim() || !n.en?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'Published products require name translations in French, Arabic, and English'
      });
    }
    if (!d.fr?.trim() || !d.ar?.trim() || !d.en?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['description'],
        message: 'Published products require description translations in French, Arabic, and English'
      });
    }
  } else {
    // Draft: at least one name language must be provided
    const n = data.name || {};
    if (!n.fr?.trim() && !n.ar?.trim() && !n.en?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['name'],
        message: 'Product name must have at least one language translation provided'
      });
    }
  }

  // Variant uniqueness check
  validateVariantUniqueness(data.colors, ctx);
});

// Update product validation schema
export const updateProductSchema = z.object({
  name: localizedFieldSchema(150).optional(),
  description: localizedFieldSchema(3000).optional(),
  category: z.string().min(1).optional(),
  sellingPrice: z.coerce.number().int({ message: 'Selling price must be an integer in DZD' }).positive({ message: 'Selling price must be positive' }).optional(),
  basePrice: z.coerce.number().int({ message: 'Base price must be an integer in DZD' }).positive({ message: 'Base price must be positive' }).optional(),
  costPrice: z.coerce.number().int({ message: 'Cost price must be an integer in DZD' }).nonnegative({ message: 'Cost price cannot be negative' }).optional(),
  promotion: z.object({
    active: z.boolean().default(false),
    promotionalPrice: z.union([
      z.coerce.number().int({ message: 'Promotional price must be an integer in DZD' }).positive({ message: 'Promotional price must be positive' }),
      z.null(),
      z.literal(''),
      z.undefined()
    ]).optional().transform(v => (v === '' || v === null || v === undefined) ? null : Number(v))
  }).optional(),
  isActive: z.boolean().optional(),
  isBestSeller: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
  colors: z.array(z.object({
    _id: z.any().optional(),
    colorName: z.string().min(1, 'Color name is required').max(100),
    colorDisplayName: localizedFieldSchema(100).optional(),
    colorCode: z.string().min(1, 'Color code is required'),
    images: z.array(z.string()).optional().default([]),
    sizes: z.array(z.object({
      _id: z.any().optional(),
      size: z.enum(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Standard', 'One Size']),
      stock: z.coerce.number().int().nonnegative().optional().default(0)
    })).optional()
  })).optional()
}).superRefine((data, ctx) => {
  const effectiveBase = data.sellingPrice ?? data.basePrice;
  if (data.promotion && data.promotion.active) {
    if (data.promotion.promotionalPrice === null || data.promotion.promotionalPrice === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['promotion', 'promotionalPrice'],
        message: 'Promotional price is required when promotion is active'
      });
    } else if (effectiveBase && data.promotion.promotionalPrice >= effectiveBase) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['promotion', 'promotionalPrice'],
        message: 'Promotional price must be strictly lower than base price'
      });
    }
  }

  if (data.colors) {
    validateVariantUniqueness(data.colors, ctx);
  }
});
