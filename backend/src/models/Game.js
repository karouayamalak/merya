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
    enum: ['quiz', 'wheel', 'scratch', 'style_matcher'],
    default: 'quiz'
  },
  description: localizedSubSchema,
  instructions: localizedSubSchema,
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

gameSchema.index({ isActive: 1, displayOrder: 1 });

export const Game = mongoose.model('Game', gameSchema);
