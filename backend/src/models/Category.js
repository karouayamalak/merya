import mongoose from 'mongoose';

export function normalizeLocalizedString(val) {
  if (typeof val === 'string') {
    return { fr: val.trim(), ar: '', en: '' };
  }
  if (val && typeof val === 'object') {
    return {
      fr: typeof val.fr === 'string' ? val.fr.trim() : (val.fr ? String(val.fr).trim() : ''),
      ar: typeof val.ar === 'string' ? val.ar.trim() : (val.ar ? String(val.ar).trim() : ''),
      en: typeof val.en === 'string' ? val.en.trim() : (val.en ? String(val.en).trim() : '')
    };
  }
  return { fr: '', ar: '', en: '' };
}

export function getLocalizedString(val) {
  if (typeof val === 'string') {
    return { fr: val, ar: '', en: '' };
  }
  return {
    fr: val?.fr || '',
    ar: val?.ar || '',
    en: val?.en || ''
  };
}

const categorySchema = new mongoose.Schema({
  name: {
    type: mongoose.Schema.Types.Mixed,
    required: [true, 'Category name is required'],
    get: getLocalizedString,
    set: normalizeLocalizedString,
    validate: {
      validator: function(v) {
        if (!v) return false;
        if (typeof v === 'string') return v.trim().length > 0;
        if (typeof v === 'object') {
          return Boolean((v.fr && v.fr.trim().length > 0) || (v.en && v.en.trim().length > 0) || (v.ar && v.ar.trim().length > 0));
        }
        return false;
      },
      message: 'Category name must have at least one language translation provided.'
    }
  },
  slug: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    index: true
  },
  description: {
    type: mongoose.Schema.Types.Mixed,
    default: () => ({ fr: '', ar: '', en: '' }),
    get: getLocalizedString,
    set: normalizeLocalizedString
  },
  image: {
    type: String,
    required: true
  },
  displayOrder: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  isArchived: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true, getters: true },
  toObject: { virtuals: true, getters: true }
});

categorySchema.index({ isArchived: 1, isActive: 1, displayOrder: 1 });
categorySchema.index({ "name.fr": 1 });
categorySchema.index({ "name.ar": 1 });
categorySchema.index({ "name.en": 1 });

// Virtual: translation completeness status for admin UI badges
categorySchema.virtual('translationStatus').get(function() {
  const n = this.name;
  if (!n || typeof n !== 'object') return { fr: false, ar: false, en: false };
  return {
    fr: Boolean(n.fr && n.fr.trim().length > 0),
    ar: Boolean(n.ar && n.ar.trim().length > 0),
    en: Boolean(n.en && n.en.trim().length > 0)
  };
});

export const Category = mongoose.model('Category', categorySchema);
