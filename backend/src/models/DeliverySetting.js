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
  singletonKey: {
    type: String,
    required: true,
    unique: true,
    default: 'default'
  },
  /**
   * @deprecated DEPRECATED — NOT USED FOR PRICING.
   * Legacy global fallback fee preserved strictly for backward compatibility.
   * The authoritative delivery fee for customer checkout, cart quotes,
   * order creation, and admin order recalculation is strictly derived
   * per-Wilaya from the wilayaRates array (agencyFee / homeFee).
   */
  agencyDeliveryFee: {
    type: Number,
    required: false,
    min: 0,
    default: 500,
    validate: {
      validator: (v) => v === undefined || v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0),
      message: '{VALUE} is not a valid integer DZD agencyDeliveryFee'
    }
  },
  /**
   * @deprecated DEPRECATED — NOT USED FOR PRICING.
   * Legacy global fallback fee preserved strictly for backward compatibility.
   * The authoritative delivery fee for customer checkout, cart quotes,
   * order creation, and admin order recalculation is strictly derived
   * per-Wilaya from the wilayaRates array (agencyFee / homeFee).
   */
  homeDeliveryFee: {
    type: Number,
    required: false,
    min: 0,
    default: 800,
    validate: {
      validator: (v) => v === undefined || v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0),
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

deliverySettingSchema.pre('save', function(next) {
  if (!this.singletonKey) {
    this.singletonKey = 'default';
  }
  next();
});

deliverySettingSchema.statics.getSingleton = async function(session = null) {
  const opts = session ? { session } : {};
  let setting = await this.findOne({ singletonKey: 'default' }, null, opts);
  if (!setting) {
    const all = await this.find({}, null, opts).sort({ updatedAt: -1 });
    if (all.length > 0) {
      setting = all[0];
      if (setting.singletonKey !== 'default') {
        await this.updateOne({ _id: setting._id }, { $set: { singletonKey: 'default' } }, opts);
        setting.singletonKey = 'default';
      }
      // Reconcile any duplicate stale settings
      if (all.length > 1) {
        const extraIds = all.slice(1).map(s => s._id);
        await this.deleteMany({ _id: { $in: extraIds } }, opts);
      }
    }
  }
  return setting;
};

export const DeliverySetting = mongoose.model('DeliverySetting', deliverySettingSchema);
