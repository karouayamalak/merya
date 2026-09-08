import mongoose from 'mongoose';

const wilayaRateSchema = new mongoose.Schema({
  wilayaCode: {
    type: Number,
    required: true
  },
  wilayaName: {
    type: String,
    required: true
  },
  wilayaNameAr: {
    type: String
  },
  homeFee: {
    type: Number,
    required: true,
    min: 0,
    default: 800
  },
  agencyFee: {
    type: Number,
    required: true,
    min: 0,
    default: 500
  },
  isAvailable: {
    type: Boolean,
    default: true
  }
}, { _id: false });

const deliverySettingSchema = new mongoose.Schema({
  agencyDeliveryFee: {
    type: Number,
    required: true,
    min: 0,
    default: 500 // Global fallback
  },
  homeDeliveryFee: {
    type: Number,
    required: true,
    min: 0,
    default: 800 // Global fallback
  },
  freeDeliveryThreshold: {
    type: Number,
    min: 0,
    default: 0 // 0 means disabled
  },
  wilayaRates: [wilayaRateSchema],
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

export const DeliverySetting = mongoose.model('DeliverySetting', deliverySettingSchema);
