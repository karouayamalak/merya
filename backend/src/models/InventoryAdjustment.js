import mongoose from 'mongoose';

const inventoryAdjustmentSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: [true, 'Product ID is required for inventory adjustment audit'],
      index: true
    },
    colorName: {
      type: String,
      required: [true, 'Color name is required'],
      trim: true
    },
    size: {
      type: String,
      required: [true, 'Size is required'],
      trim: true
    },
    previousStock: {
      type: Number,
      required: [true, 'Previous stock is required'],
      min: [0, 'Previous stock cannot be negative']
    },
    newStock: {
      type: Number,
      required: [true, 'New stock is required'],
      min: [0, 'New stock cannot be negative']
    },
    admin: {
      type: String,
      required: [true, 'Admin identity is required'],
      trim: true,
      default: 'Admin'
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    },
    reason: {
      type: String,
      trim: true,
      default: 'Manual adjustment'
    }
  },
  {
    timestamps: true
  }
);

inventoryAdjustmentSchema.index({ productId: 1, timestamp: -1 });

export const InventoryAdjustment = mongoose.model('InventoryAdjustment', inventoryAdjustmentSchema);
