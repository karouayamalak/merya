import { z } from 'zod';
import { DELIVERY_METHODS, ORDER_STATUS } from '../config/constants.js';

// Localized string: accepts a plain string OR a {fr, ar, en} object
const localizedStringSchema = z.union([
  z.string(),
  z.object({
    fr: z.string().optional().default(''),
    ar: z.string().optional().default(''),
    en: z.string().optional().default('')
  })
]);

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

// Admin login schema
export const adminLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

// Strict multilingual schemas for product name & description
const multilingualStringSchema = (maxLength = 150) => z.object({
  fr: z.string({ invalid_type_error: 'French translation must be a string' }).max(maxLength).nullable().optional().transform(v => (v ?? '').trim()),
  ar: z.string({ invalid_type_error: 'Arabic translation must be a string' }).max(maxLength).nullable().optional().transform(v => (v ?? '').trim()),
  en: z.string({ invalid_type_error: 'English translation must be a string' }).max(maxLength).nullable().optional().transform(v => (v ?? '').trim())
}, { invalid_type_error: 'Must be an object with language keys: fr, ar, en' });

const localizedFieldSchema = (maxLength = 150) => z.union([
  multilingualStringSchema(maxLength),
  z.string().max(maxLength).transform(s => ({ fr: s.trim(), ar: '', en: '' })),
  z.null().transform(() => ({ fr: '', ar: '', en: '' })),
  z.undefined().transform(() => ({ fr: '', ar: '', en: '' }))
]);

// Helper to validate color and size uniqueness
function validateVariantUniqueness(colors, ctx) {
  if (!Array.isArray(colors)) return;
  const seenColors = new Set();
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    const normColor = c.colorName?.trim().toLowerCase();
    if (seenColors.has(normColor)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['colors', i, 'colorName'],
        message: `Duplicate colorName "${c.colorName}". Color names must be unique (case-insensitive).`
      });
    }
    seenColors.add(normColor);

    if (Array.isArray(c.sizes)) {
      const seenSizes = new Set();
      for (let j = 0; j < c.sizes.length; j++) {
        const s = c.sizes[j];
        if (seenSizes.has(s.size)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['colors', i, 'sizes', j, 'size'],
            message: `Duplicate size "${s.size}" in color "${c.colorName}". Sizes per color must be unique.`
          });
        }
        seenSizes.add(s.size);
      }
    }
  }
}

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

// Category validation schemas — strict: rejects unknown fields, oversized strings, invalid types
export const categorySchema = z.object({
  name: localizedFieldSchema(100),
  description: localizedFieldSchema(1000).optional(),
  image: z.string().min(1, 'Category image URL/path is required').max(500, 'Image URL too long'),
  displayOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional()
}).strict();

export const updateCategorySchema = z.object({
  name: localizedFieldSchema(100).optional(),
  description: localizedFieldSchema(1000).optional(),
  image: z.string().min(1).max(500).optional(),
  displayOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
  isArchived: z.boolean().optional()
}).strict();

// Banner validation schemas — strict: rejects unknown fields, oversized strings, invalid types
export const bannerSchema = z.object({
  title: localizedFieldSchema(150),
  subtitle: localizedFieldSchema(300).optional(),
  badgeText: localizedFieldSchema(100).optional(),
  buttonText: localizedFieldSchema(100).optional(),
  ctaText: localizedFieldSchema(100).optional(),
  link: z.string().max(300).optional(),
  ctaLink: z.string().max(300).optional(),
  image: z.string().max(500).optional(),
  placement: z.enum(['home_hero', 'home_middle', 'top_announcement', 'promo_bar', 'hero', 'homepage-strip', 'shop-top', 'sidebar', 'popup']).optional(),
  displayOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional()
}).strict();

export const updateBannerSchema = z.object({
  title: localizedFieldSchema(150).optional(),
  subtitle: localizedFieldSchema(300).optional(),
  badgeText: localizedFieldSchema(100).optional(),
  buttonText: localizedFieldSchema(100).optional(),
  ctaText: localizedFieldSchema(100).optional(),
  link: z.string().max(300).optional(),
  ctaLink: z.string().max(300).optional(),
  image: z.string().max(500).optional(),
  placement: z.enum(['home_hero', 'home_middle', 'top_announcement', 'promo_bar', 'hero', 'homepage-strip', 'shop-top', 'sidebar', 'popup']).optional(),
  displayOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional()
}).strict();

