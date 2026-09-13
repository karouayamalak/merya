import mongoose from 'mongoose';

const sizeVariantSchema = new mongoose.Schema({
  size: {
    type: String,
    required: true,
    trim: true,
    enum: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Standard', 'One Size']
  },
  stock: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  }
}, { _id: true });

const colorVariantSchema = new mongoose.Schema({
  colorName: {
    type: String,
    required: true,
    trim: true
  },
  // colorDisplayName: customer-facing localized name (FR/AR/EN)
  // colorName above remains the stable identity key for inventory, cart, and orders — never change it
  colorDisplayName: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({ fr: '', ar: '', en: '' }),
    get: getLocalizedString,
    set: normalizeLocalizedString
  },
  colorCode: {
    type: String,
    required: true,
    trim: true
  },
  images: [{
    type: String,
    required: true
  }],
  sizes: [sizeVariantSchema]
}, { _id: true });

export function normalizeLocalizedString(val) {
  if (typeof val === 'string') {
    return { fr: val.trim(), ar: '', en: '' };
  }
  if (val && typeof val === 'object') {
    return {
      fr: typeof val.fr === 'string' ? val.fr.trim() : (val.fr ? String(val.fr).trim() : ''),
      ar: typeof val.ar === 'string' ? val.ar.trim() : (val.ar ? String(val.ar).trim() : ''),
      en: typeof val.en === 'string' ? val.en.trim() : (val.en ? String(val.en).trim() : '')
    };
  }
  return { fr: '', ar: '', en: '' };
}

export function getLocalizedString(val) {
  if (typeof val === 'string') {
    return { fr: val, ar: '', en: '' };
  }
  return {
    fr: val?.fr || '',
    ar: val?.ar || '',
    en: val?.en || ''
  };
}

const productSchema = new mongoose.Schema({
  name: {
    type: mongoose.Schema.Types.Mixed,
    required: [true, 'Product name is required'],
    get: getLocalizedString,
    set: normalizeLocalizedString,
    validate: {
      validator: function(v) {
        if (!v) return false;
        if (typeof v === 'string') return v.trim().length > 0;
        if (typeof v === 'object') {
          return Boolean((v.fr && v.fr.trim().length > 0) || (v.en && v.en.trim().length > 0) || (v.ar && v.ar.trim().length > 0));
        }
        return false;
      },
      message: 'Product name must have at least one language translation provided.'
    }
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    index: true
  },
  description: {
    type: mongoose.Schema.Types.Mixed,
    required: [true, 'Product description is required'],
    get: getLocalizedString,
    set: normalizeLocalizedString,
    validate: {
      validator: function(v) {
        if (!v) return false;
        if (typeof v === 'string') return v.trim().length > 0;
        if (typeof v === 'object') {
          return Boolean((v.fr && v.fr.trim().length > 0) || (v.en && v.en.trim().length > 0) || (v.ar && v.ar.trim().length > 0));
        }
        return false;
      },
      message: 'Product description must have at least one language translation provided.'
    }
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true,
    index: true
  },
  sellingPrice: {
    type: Number,
    required: true,
    alias: 'basePrice',
    min: 0,
    validate: {
      validator: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
      message: '{VALUE} is not a valid integer DZD amount for sellingPrice'
    }
  },
  costPrice: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
      message: '{VALUE} is not a valid integer DZD amount for costPrice'
    }
  },
  promotion: {
    active: {
      type: Boolean,
      default: false
    },
    promotionalPrice: {
      type: Number,
      default: null,
      validate: {
        validator: function(v) {
          if (v === null || v === undefined) return true;
          return typeof v === 'number' && Number.isInteger(v) && v > 0;
        },
        message: '{VALUE} is not a valid integer DZD amount for promotionalPrice'
      }
    }
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  isArchived: {
    type: Boolean,
    default: false,
    index: true
  },
  isBestSeller: {
    type: Boolean,
    default: false,
    index: true
  },
  colors: [colorVariantSchema]
}, {
  timestamps: true,
  toJSON: { virtuals: true, getters: true },
  toObject: { virtuals: true, getters: true }
});

// Schema-level pre-validation to enforce promotion business rules
productSchema.pre('validate', function(next) {
  if (this.promotion && this.promotion.active) {
    if (typeof this.promotion.promotionalPrice !== 'number' || !Number.isInteger(this.promotion.promotionalPrice) || this.promotion.promotionalPrice <= 0) {
      this.invalidate('promotion.promotionalPrice', 'Promotional price must be a positive integer greater than zero.');
    } else if (this.promotion.promotionalPrice >= this.sellingPrice) {
      this.invalidate('promotion.promotionalPrice', 'Promotional price must be strictly lower than base price.');
    }
  }
  next();
});

// Virtual effective selling price (server-authoritative)
productSchema.virtual('effectivePrice').get(function() {
  if (this.promotion && this.promotion.active && typeof this.promotion.promotionalPrice === 'number' && this.promotion.promotionalPrice > 0 && this.promotion.promotionalPrice < this.sellingPrice) {
    return this.promotion.promotionalPrice;
  }
  return this.sellingPrice;
});

productSchema.index({ isArchived: 1, isActive: 1, category: 1 });
productSchema.index({ isArchived: 1, isActive: 1, isBestSeller: 1 });
productSchema.index({ "colors.colorName": 1 });
productSchema.index({ "name.fr": 1 });
productSchema.index({ "name.ar": 1 });
productSchema.index({ "name.en": 1 });

// Virtual: translation completeness status for admin UI badges
productSchema.virtual('translationStatus').get(function() {
  const n = typeof this.name === 'object' && this.name !== null ? this.name : { fr: this.name || '' };
  const d = typeof this.description === 'object' && this.description !== null ? this.description : { fr: this.description || '' };
  return {
    fr: Boolean(n.fr && n.fr.trim().length > 0 && d.fr && d.fr.trim().length > 0),
    ar: Boolean(n.ar && n.ar.trim().length > 0 && d.ar && d.ar.trim().length > 0),
    en: Boolean(n.en && n.en.trim().length > 0 && d.en && d.en.trim().length > 0)
  };
});

// Helper: check if product has complete FR, AR, EN translations (both name and description)
export function isProductFullyTranslated(product) {
  const n = typeof product.name === 'object' && product.name !== null ? product.name : { fr: product.name || '' };
  const d = typeof product.description === 'object' && product.description !== null ? product.description : { fr: product.description || '' };
  return Boolean(
    n.fr && n.fr.trim().length > 0 &&
    n.ar && n.ar.trim().length > 0 &&
    n.en && n.en.trim().length > 0 &&
    d.fr && d.fr.trim().length > 0 &&
    d.ar && d.ar.trim().length > 0 &&
    d.en && d.en.trim().length > 0
  );
}

// Virtual: denormalized total stock across all colors and sizes
productSchema.virtual('totalStock').get(function() {
  if (!this.colors || !this.colors.length) return 0;
  return this.colors.reduce((total, color) => {
    return total + (color.sizes || []).reduce((s, sz) => s + (sz.stock || 0), 0);
  }, 0);
});

export const Product = mongoose.model('Product', productSchema);

