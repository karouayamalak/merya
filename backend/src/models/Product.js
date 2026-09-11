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

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 150
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
    type: String,
    required: true,
    trim: true
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
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
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

export const Product = mongoose.model('Product', productSchema);

