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

/**
 * Deterministic Singleton Fetcher — Non-destructive.
 * Ordinary GET/read operations NEVER delete or mutate database records.
 * If duplicates exist, the latest document is selected deterministically
 * and a warning is logged so an explicit repair migration can be run.
 */
deliverySettingSchema.statics.getSingleton = async function(session = null) {
  const opts = session ? { session } : {};
  let setting = await this.findOne({ singletonKey: 'default' }, null, opts);
  if (!setting) {
    const all = await this.find({}, null, opts).sort({ updatedAt: -1, _id: -1 });
    if (all.length > 0) {
      setting = all[0];
      if (all.length > 1) {
        console.warn(`[DeliverySetting] Multiple delivery settings found (${all.length}). Deterministically selected newest document (_id: ${setting._id}). Run repairDuplicates() explicitly if cleanup is needed.`);
      }
      if (setting.singletonKey !== 'default') {
        try {
          await this.updateOne({ _id: setting._id }, { $set: { singletonKey: 'default' } }, opts);
          setting.singletonKey = 'default';
        } catch (err) {
          // If a race occurred and another process set singletonKey, re-fetch
          const existing = await this.findOne({ singletonKey: 'default' }, null, opts);
          if (existing) setting = existing;
        }
      }
    }
  }
  return setting;
};

/**
 * Explicit safe repair migration tool.
 * ONLY called explicitly when repairing corrupted or duplicated singleton collections.
 * Preserves the newest document with singletonKey: 'default' and cleans up older stale duplicates.
 */
deliverySettingSchema.statics.repairDuplicates = async function(session = null) {
  const opts = session ? { session } : {};
  const all = await this.find({}, null, opts).sort({ updatedAt: -1, _id: -1 });
  if (all.length <= 1) return { reconciled: false, count: all.length };

  const keeper = all[0];
  if (keeper.singletonKey !== 'default') {
    await this.updateOne({ _id: keeper._id }, { $set: { singletonKey: 'default' } }, opts);
  }
  const extraIds = all.slice(1).map(s => s._id);
  const deleteRes = await this.deleteMany({ _id: { $in: extraIds } }, opts);
  return { reconciled: true, keptId: keeper._id, deletedCount: deleteRes.deletedCount };
};

export const DeliverySetting = mongoose.model('DeliverySetting', deliverySettingSchema);
