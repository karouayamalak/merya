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
    ...localizedSubSchema
    // title is optional — image-only banners (e.g. hero) don't require a title
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
    default: false,
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

bannerSchema.virtual('ctaText')
  .get(function() { return this.buttonText; })
  .set(function(v) { this.buttonText = v; });

bannerSchema.virtual('ctaLink')
  .get(function() { return this.link; })
  .set(function(v) { this.link = v; });

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

// Helper: check if banner is publishable.
// Title is optional — image-only banners (hero) are valid with just an image.
// If title is provided, it should have at least one language translation.
export function isBannerFullyTranslated(banner) {
  // If banner has no title at all, it's fine (image-only banner)
  const t = typeof banner.title === 'object' && banner.title !== null ? banner.title : { fr: banner.title || '', ar: '', en: '' };
  const hasAnyTitle = Boolean(
    (t.fr && t.fr.trim().length > 0) ||
    (t.ar && t.ar.trim().length > 0) ||
    (t.en && t.en.trim().length > 0)
  );
  // If title has any content, require all 3 languages. If no title at all, that's acceptable.
  if (!hasAnyTitle) return true;
  return Boolean(t.fr && t.fr.trim().length > 0 && t.ar && t.ar.trim().length > 0 && t.en && t.en.trim().length > 0);
}

export const Banner = mongoose.model('Banner', bannerSchema);
