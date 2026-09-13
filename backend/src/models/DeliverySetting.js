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
  wilayaNameEn: {
    type: String
  },
  wilayaNameFr: {
    type: String
  },
  homeFee: {
    type: Number,
    required: true,
    min: 0,
    default: 800,
    validate: {
      validator: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
      message: '{VALUE} is not a valid integer DZD homeFee'
    }
  },
  agencyFee: {
    type: Number,
    required: true,
    min: 0,
    default: 500,
    validate: {
      validator: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
      message: '{VALUE} is not a valid integer DZD agencyFee'
    }
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
    default: 500,
    validate: {
      validator: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
      message: '{VALUE} is not a valid integer DZD agencyDeliveryFee'
    }
  },
  homeDeliveryFee: {
    type: Number,
    required: true,
    min: 0,
    default: 800,
    validate: {
      validator: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
      message: '{VALUE} is not a valid integer DZD homeDeliveryFee'
    }
  },
  freeDeliveryThreshold: {
    type: Number,
    min: 0,
    default: 0, // 0 means disabled
    validate: {
      validator: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0,
      message: '{VALUE} is not a valid integer DZD freeDeliveryThreshold'
    }
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
