import mongoose from 'mongoose';
import { normalizeLocalizedString, getLocalizedString } from './Product.js';

const localizedSubSchema = {
  type: mongoose.Schema.Types.Mixed,
  default: () => ({ fr: '', ar: '', en: '' }),
  get: getLocalizedString,
  set: normalizeLocalizedString
};

const gameQuestionOptionSchema = new mongoose.Schema({
  text: localizedSubSchema,
  isCorrect: {
    type: Boolean,
    default: false
  }
}, { _id: true });

const gameQuestionSchema = new mongoose.Schema({
  question: localizedSubSchema,
  options: [gameQuestionOptionSchema]
}, { _id: true });

const gameSchema = new mongoose.Schema({
  title: {
    ...localizedSubSchema,
    required: [true, 'Game title is required'],
    validate: {
      validator: function(v) {
        if (!v) return false;
        if (typeof v === 'string') return v.trim().length > 0;
        if (typeof v === 'object') {
          return Boolean((v.fr && v.fr.trim().length > 0) || (v.en && v.en.trim().length > 0) || (v.ar && v.ar.trim().length > 0));
        }
        return false;
      },
      message: 'Game title must have at least one language translation provided.'
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
  type: {
    type: String,
    enum: ['wheel', 'quiz', 'scratch', 'style_matcher'],
    default: 'wheel'
  },
  gameType: {
    type: String,
    enum: ['wheel', 'quiz', 'scratch', 'style_matcher'],
    default: 'wheel'
  },
  coverImage: {
    type: String,
    default: ''
  },
  description: localizedSubSchema,
  instructions: localizedSubSchema,
  rules: localizedSubSchema,
  winnerMessage: localizedSubSchema,
  loserMessage: localizedSubSchema,
  reward: {
    discountCode: { type: String, trim: true, default: 'MERYAVIP' },
    discountPercent: { type: Number, min: 0, max: 100, default: 10 },
    minOrderAmount: { type: Number, min: 0, default: 0 }
  },
  questions: [gameQuestionSchema],
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

// Pre-validate synchronization: ensure instructions & rules, type & gameType stay mutually coherent
gameSchema.pre('validate', function(next) {
  if (this.gameType && !this.type) this.type = this.gameType;
  if (this.type && !this.gameType) this.gameType = this.type;

  // If rules is provided but instructions is blank, copy rules -> instructions
  if ((!this.instructions?.fr && !this.instructions?.ar && !this.instructions?.en) &&
      (this.rules?.fr || this.rules?.ar || this.rules?.en)) {
    this.instructions = this.rules;
  }
  // If instructions is provided but rules is blank, copy instructions -> rules
  if ((!this.rules?.fr && !this.rules?.ar && !this.rules?.en) &&
      (this.instructions?.fr || this.instructions?.ar || this.instructions?.en)) {
    this.rules = this.instructions;
  }
  next();
});

gameSchema.index({ isActive: 1, displayOrder: 1 });

// Virtual: translation completeness status for admin UI badges
gameSchema.virtual('translationStatus').get(function() {
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

// Helper: check if game has complete FR, AR, EN translations
export function isGameFullyTranslated(game) {
  const t = typeof game.title === 'object' && game.title !== null ? game.title : { fr: game.title || '' };
  return Boolean(t.fr && t.fr.trim().length > 0 && t.ar && t.ar.trim().length > 0 && t.en && t.en.trim().length > 0);
}

export const Game = mongoose.model('Game', gameSchema);
