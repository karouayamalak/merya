import mongoose from 'mongoose';
import { ORDER_STATUS, DELIVERY_METHODS } from '../config/constants.js';

const orderItemSnapshotSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  colorName: {
    type: String,
    required: true
  },
  colorCode: {
    type: String
  },
  size: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    validate: {
      validator: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1,
      message: '{VALUE} is not a valid integer quantity'
    }
  },
  unitPrice: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
      message: '{VALUE} is not a valid integer DZD unitPrice'
    }
  },
  unitCost: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
      message: '{VALUE} is not a valid integer DZD unitCost'
    }
  },
  image: {
    type: String
  }
}, { _id: false });

const auditEntrySchema = new mongoose.Schema({
  action: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  performedBy: {
    type: String,
    required: true
  },
  note: {
    type: String
  },
  details: {
    type: mongoose.Schema.Types.Mixed
  }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderCode: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  idempotencyKey: {
    type: String,
    sparse: true,
    unique: true,
    index: true
  },
  idempotencyFingerprint: {
    type: String,
    index: true
  },
  customer: {
    fullName: {
      type: String,
      required: true,
      trim: true
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      index: true
    },
    wilaya: {
      code: { type: Number, required: true },
      name: { type: String, required: true }
    },
    deliveryMethod: {
      type: String,
      enum: Object.values(DELIVERY_METHODS),
      required: true,
      index: true
    },
    agencyName: {
      type: String,
      trim: true
    },
    address: {
      type: String,
      trim: true
    },
    notes: {
      type: String,
      trim: true
    }
  },
  items: [orderItemSnapshotSchema],
  subtotal: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
      message: '{VALUE} is not a valid integer DZD subtotal'
    }
  },
  deliveryFee: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
      message: '{VALUE} is not a valid integer DZD deliveryFee'
    }
  },
  totalPrice: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
      message: '{VALUE} is not a valid integer DZD totalPrice'
    }
  },
  status: {
    type: String,
    enum: Object.values(ORDER_STATUS),
    default: ORDER_STATUS.PENDING,
    index: true
  },
  stockRestored: {
    type: Boolean,
    default: false
  },
  auditHistory: [auditEntrySchema]
}, {
  timestamps: true
});

orderSchema.index({ "customer.phone": 1, orderCode: 1 });
orderSchema.index({ status: 1, createdAt: -1 });

export const Order = mongoose.model('Order', orderSchema);
