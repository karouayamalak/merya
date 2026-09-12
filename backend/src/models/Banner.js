import mongoose from 'mongoose';
import { normalizeLocalizedString, getLocalizedString } from './Product.js';

const localizedSubSchema = {
  type: mongoose.Schema.Types.Mixed,
  default: () => ({ fr: '', ar: '', en: '' }),
  get: getLocalizedString,
  set: normalizeLocalizedString
};

const bannerSchema = new mongoose.Schema({
  title: {
    ...localizedSubSchema,
    required: [true, 'Banner title is required'],
    validate: {
      validator: function(v) {
        if (!v) return false;
        if (typeof v === 'string') return v.trim().length > 0;
        if (typeof v === 'object') {
          return Boolean((v.fr && v.fr.trim().length > 0) || (v.en && v.en.trim().length > 0) || (v.ar && v.ar.trim().length > 0));
        }
        return false;
      },
      message: 'Banner title must have at least one language translation provided.'
    }
  },
  subtitle: localizedSubSchema,
  badgeText: localizedSubSchema,
  buttonText: localizedSubSchema,
  link: {
    type: String,
    trim: true,
    default: '/shop'
  },
  image: {
    type: String,
    trim: true,
    default: ''
  },
  placement: {
    type: String,
    enum: ['home_hero', 'home_middle', 'top_announcement', 'promo_bar'],
    default: 'top_announcement',
    index: true
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  displayOrder: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true, getters: true },
  toObject: { virtuals: true, getters: true }
});

bannerSchema.index({ isActive: 1, placement: 1, displayOrder: 1 });

export const Banner = mongoose.model('Banner', bannerSchema);
