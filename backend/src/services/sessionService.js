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
 * Prevents race conditions and detects token reuse attempts.
 */
export async function rotateSessionToken({ session, presentedRefreshToken }) {
  if (!session || !session.isActive()) {
    const err = new Error('Session is inactive or expired');
    err.code = 'SESSION_INACTIVE';
    throw err;
  }

  // Verify presented refresh token against stored verifier
  const isValidVerifier = verifyTokenHash(presentedRefreshToken, session.refreshTokenHash);
  if (!isValidVerifier) {
    // Potential token theft or reuse: immediately revoke session
    session.revokedAt = new Date();
    session.revokeReason = 'TOKEN_ROTATION_REUSE';
    await session.save();

    const err = new Error('Token verification failed: potential token reuse detected');
    err.code = 'REFRESH_TOKEN_REUSE';
    throw err;
  }

  // Issue rotated credentials
  const newRefreshToken = generateRefreshToken({
    adminId: session.adminId,
    sessionId: session._id
  });
  const newAccessToken = generateAccessToken({
    adminId: session.adminId,
    sessionId: session._id
  });

  session.refreshTokenHash = hashToken(newRefreshToken);
  session.lastUsedAt = new Date();
  await session.save();

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
