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
    enum: ['home_hero', 'home_middle', 'top_announcement', 'promo_bar', 'hero', 'homepage-strip', 'shop-top', 'sidebar', 'popup'],
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

// Virtual: translation completeness status for admin UI badges
bannerSchema.virtual('translationStatus').get(function() {
  const t = this.title;
  if (!t || typeof t !== 'object') return { fr: false, ar: false, en: false };
  const fr = Boolean(t.fr && t.fr.trim().length > 0);
  const ar = Boolean(t.ar && t.ar.trim().length > 0);
  const en = Boolean(t.en && t.en.trim().length > 0);
  return {
    fr,
    ar,
    en
  };
});

// Helper: check if banner has complete FR, AR, EN translations
export function isBannerFullyTranslated(banner) {
  const t = typeof banner.title === 'object' && banner.title !== null ? banner.title : { fr: banner.title || '' };
  return Boolean(t.fr && t.fr.trim().length > 0 && t.ar && t.ar.trim().length > 0 && t.en && t.en.trim().length > 0);
}

export const Banner = mongoose.model('Banner', bannerSchema);
