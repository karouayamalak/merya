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
    min: 0
  },
  costPrice: {
    type: Number,
    required: true,
    min: 0
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
  timestamps: true
});

productSchema.index({ isArchived: 1, isActive: 1, category: 1 });
productSchema.index({ isArchived: 1, isActive: 1, isBestSeller: 1 });
productSchema.index({ "colors.colorName": 1 });

export const Product = mongoose.model('Product', productSchema);
