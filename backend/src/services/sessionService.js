import mongoose from 'mongoose';
import { Session } from '../models/Session.js';
import { AUTH_CONFIG } from '../config/authConfig.js';
import {
  generateAccessToken,
  generateRefreshToken,
  hashToken,
  verifyTokenHash
} from '../utils/tokenUtils.js';

/**
 * Create a new device session and issue initial access & refresh tokens.
 */
export async function createSession({ adminId, userAgent, ipAddress }) {
  const expiresAt = new Date(Date.now() + AUTH_CONFIG.refreshTokenMaxAgeMs);

  const session = new Session({
    adminId,
    userAgent: userAgent ? String(userAgent).slice(0, 500) : null,
    ipAddress: ipAddress ? String(ipAddress).slice(0, 100) : null,
    expiresAt,
    refreshTokenHash: 'pending_initial_hash'
  });

  await session.save();

  // Issue paired tokens tied to this exact session ID
  const refreshToken = generateRefreshToken({ adminId, sessionId: session._id });
  const accessToken = generateAccessToken({ adminId, sessionId: session._id });

  session.refreshTokenHash = hashToken(refreshToken);
  await session.save();

  return {
    session,
    accessToken,
    refreshToken
  };
}

/**
 * Validate and safely rotate a session's refresh token.
 * Uses an atomic MongoDB compare-and-set (findOneAndUpdate) to prevent
 * race conditions where two simultaneous refresh requests using the same
 * old refresh token could both succeed.
 *
 * Concurrent race safety: when two requests arrive with the same valid
 * old refresh token, only one wins. The losing request is rejected WITHOUT
 * revoking the session — the winning request's new credentials remain valid.
 *
 * Genuine reuse detection: tracks failed rotation attempts on the session.
 * If failed attempts exceed a threshold, the session is revoked.
 */
export async function rotateSessionToken({ session, presentedRefreshToken }) {
  if (!session || !session.isActive()) {
    const err = new Error('Session is inactive or expired');
    err.code = 'SESSION_INACTIVE';
    throw err;
  }

  const oldHash = hashToken(presentedRefreshToken);

  const newRefreshToken = generateRefreshToken({
    adminId: session.adminId,
    sessionId: session._id
  });
  const newAccessToken = generateAccessToken({
    adminId: session.adminId,
    sessionId: session._id
  });
  const newHash = hashToken(newRefreshToken);

  // Atomic compare-and-set: update the stored hash ONLY if it still matches
  // the old hash AND the session is active.
  const result = await Session.findOneAndUpdate(
    {
      _id: session._id,
      refreshTokenHash: oldHash,
      revokedAt: null,
      expiresAt: { $gt: new Date() }
    },
    {
      $set: { refreshTokenHash: newHash, lastUsedAt: new Date() },
      $inc: { failedRotationAttempts: 0 } // no-op: keeps Mongoose trackDirty happy
    },
    { new: true }
  );

  if (!result) {
    const current = await Session.findById(session._id);

    if (!current || current.revokedAt || (current.expiresAt && current.expiresAt <= new Date())) {
      const err = new Error('Session is inactive or expired');
      err.code = 'SESSION_INACTIVE';
      throw err;
    }

    // Session is still active but the stored hash has already changed.
    // This means another legitimate request already rotated this token.
    // Do NOT revoke the session — the winning request's new credentials
    // are valid and the session must remain active.
    //
    // Track failed rotation attempts to detect genuine reuse attacks
    // over time (repeated attempts with consumed tokens).
    const failedAttempts = (current.failedRotationAttempts || 0) + 1;
    current.failedRotationAttempts = failedAttempts;

    if (failedAttempts >= 3) {
      // Too many failed rotation attempts on this active session →
      // likely a genuine token-reuse/security attack. Revoke.
      current.revokedAt = new Date();
      current.revokeReason = 'TOKEN_ROTATION_REUSE';
      await current.save();

      const err = new Error('Token reuse detected: session revoked');
      err.code = 'REFRESH_TOKEN_REUSE';
      throw err;
    }

    // Not enough failed attempts → concurrent race, not a security event.
    // Just reject without revoking.
    await current.save();

    const err = new Error('Token already rotated — concurrent refresh rejected');
    err.code = 'REFRESH_TOKEN_REUSE';
    throw err;
  }

  // Successful rotation: reset failed attempt counter
  await Session.findByIdAndUpdate(session._id, { $set: { failedRotationAttempts: 0 } });

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken
  };
}

/**
 * Revoke a single session (normal per-device logout).
 */
export async function revokeSession(sessionId, reason = 'LOGOUT') {
  if (!sessionId) return null;
  if (!mongoose.Types.ObjectId.isValid(sessionId)) return null;
  return Session.findByIdAndUpdate(
    sessionId,
    {
      $set: {
        revokedAt: new Date(),
        revokeReason: reason
      }
    },
    { new: true }
  );
}

/**
 * Revoke all sessions belonging to an admin account.
 */
export async function revokeAllAdminSessions(adminId, reason = 'LOGOUT_ALL') {
  if (!adminId) return 0;
  const result = await Session.updateMany(
    {
      adminId,
      revokedAt: null
    },
    {
      $set: {
        revokedAt: new Date(),
        revokeReason: reason
      }
    }
  );
  return result.modifiedCount;
}

/**
 * Find an active, unrevoked, non-expired session.
 */
export async function findActiveSession(sessionId, adminId) {
  if (!sessionId || !adminId) return null;
  if (!mongoose.Types.ObjectId.isValid(sessionId)) return null;

  const session = await Session.findOne({
    _id: sessionId,
    adminId,
    revokedAt: null,
    expiresAt: { $gt: new Date() }
  });

  return session;
}

/**
 * List safe session metadata for the current admin.
 */
export async function getAdminSessions(adminId, currentSessionId = null) {
  const sessions = await Session.find({
    adminId,
    revokedAt: null,
    expiresAt: { $gt: new Date() }
  })
    .sort({ lastUsedAt: -1 })
    .lean();

  return sessions.map((s) => ({
    id: s._id.toString(),
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt,
    expiresAt: s.expiresAt,
    userAgent: s.userAgent,
    ipAddress: s.ipAddress,
    isCurrent: currentSessionId ? s._id.toString() === String(currentSessionId) : false
  }));
}
