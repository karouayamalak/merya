import mongoose from 'mongoose';

const socialLinksSchema = new mongoose.Schema({
  facebook: {
    type: String,
    trim: true,
    default: '',
    maxlength: 300
  },
  instagram: {
    type: String,
    trim: true,
    default: '',
    maxlength: 300
  },
  tiktok: {
    type: String,
    trim: true,
    default: '',
    maxlength: 300
  }
}, { _id: false });

const storeSettingSchema = new mongoose.Schema({
  singletonKey: {
    type: String,
    required: true,
    unique: true,
    default: 'default'
  },
  logoVariant: {
    type: String,
    enum: ['white', 'original'],
    default: 'white'
  },
  deliveryNoticeDays: {
    type: Number,
    min: 1,
    max: 30,
    default: 3,
    validate: {
      validator: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 30,
      message: '{VALUE} is not a valid deliveryNoticeDays integer between 1 and 30'
    }
  },
  socialLinks: {
    type: socialLinksSchema,
    default: () => ({ facebook: '', instagram: '', tiktok: '' })
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true
});

storeSettingSchema.pre('save', function(next) {
  if (!this.singletonKey) {
    this.singletonKey = 'default';
  }
  next();
});

storeSettingSchema.statics.getSingleton = async function(session = null) {
  const opts = session ? { session } : {};
  let setting = await this.findOne({ singletonKey: 'default' }, null, opts);
  if (!setting) {
    const all = await this.find({}, null, opts).sort({ updatedAt: -1, _id: -1 });
    if (all.length > 0) {
      setting = all[0];
    } else {
      // Create initial singleton
      try {
        setting = await this.create([{
          singletonKey: 'default',
          logoVariant: 'white',
          deliveryNoticeDays: 3,
          socialLinks: { facebook: '', instagram: '', tiktok: '' }
        }], opts);
        if (Array.isArray(setting)) setting = setting[0];
      } catch (err) {
        // If race condition on unique singletonKey, retry fetch
        setting = await this.findOne({ singletonKey: 'default' }, null, opts);
      }
    }
  }
  return setting;
};

export const StoreSetting = mongoose.model('StoreSetting', storeSettingSchema);
