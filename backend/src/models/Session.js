import mongoose from 'mongoose';

const sessionSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    index: true
  },
  refreshTokenHash: {
    type: String,
    required: true
  },
  userAgent: {
    type: String,
    trim: true,
    maxlength: 500,
    default: null
  },
  ipAddress: {
    type: String,
    trim: true,
    maxlength: 100,
    default: null
  },
  expiresAt: {
    type: Date,
    required: true
  },
  revokedAt: {
    type: Date,
    default: null,
    index: true
  },
  revokeReason: {
    type: String,
    enum: ['LOGOUT', 'LOGOUT_ALL', 'TOKEN_ROTATION_REUSE', 'ADMIN_DEACTIVATED', 'ADMIN_DELETED', 'SUPERSEDED'],
    default: null
  },
  failedRotationAttempts: {
    type: Number,
    default: 0
  },
  lastUsedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound indexes for performant query patterns
sessionSchema.index({ adminId: 1, expiresAt: 1 });
sessionSchema.index({ adminId: 1, revokedAt: 1 });

// MongoDB TTL index for automatic async cleanup of expired sessions
// Note: Runtime checks still explicitly verify expiresAt > now and revokedAt === null
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

sessionSchema.methods.isActive = function () {
  return !this.revokedAt && this.expiresAt > new Date();
};

export const Session = mongoose.model('Session', sessionSchema);
