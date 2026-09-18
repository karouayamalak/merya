import mongoose from 'mongoose';
import { Admin } from '../models/Admin.js';
import { Session } from '../models/Session.js';
import { verifyAccessToken } from '../utils/tokenUtils.js';

export const authenticateAdmin = async (req, res, next) => {
  try {
    // Dual authentication: Check Authorization Bearer header first, then cookie as fallback.
    // This ensures reliable cross-site API access even when browsers restrict cross-domain cookies.
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const accessToken = bearerToken || req.cookies?.accessToken;

    if (!accessToken) {
      // Clear legacy token cookie if present to clean up obsolete browser credentials
      if (req.cookies?.token) {
        res.clearCookie('token');
      }
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    let decoded;
    try {
      decoded = verifyAccessToken(accessToken);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Access token expired',
          code: 'TOKEN_EXPIRED'
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid session token',
        code: 'TOKEN_INVALID'
      });
    }

    if (
      decoded.type !== 'access' ||
      !decoded.sid ||
      !decoded.sub ||
      !mongoose.Types.ObjectId.isValid(decoded.sid) ||
      !mongoose.Types.ObjectId.isValid(decoded.sub)
    ) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token claims',
        code: 'TOKEN_INVALID'
      });
    }

    // Single parallel query to avoid sequential N+1 database roundtrips
    const [session, admin] = await Promise.all([
      Session.findById(decoded.sid).lean(),
      Admin.findById(decoded.sub).select('-passwordHash')
    ]);

    if (!session || String(session.adminId) !== decoded.sub) {
      return res.status(401).json({
        success: false,
        message: 'Session not found',
        code: 'SESSION_NOT_FOUND'
      });
    }

    if (session.revokedAt || (session.expiresAt && session.expiresAt <= new Date())) {
      return res.status(401).json({
        success: false,
        message: 'Session revoked or expired. Please log in again.',
        code: 'SESSION_REVOKED'
      });
    }

    if (!admin || !admin.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account inactive or does not exist',
        code: 'ACCOUNT_INACTIVE'
      });
    }

    req.admin = admin;
    req.authSession = session;
    req.authSource = 'db';
    next();
} catch {
    return res.status(401).json({
      success: false,
      message: 'Authentication failure',
      code: 'AUTH_FAILED'
    });
  }
};

  /**
  * Lightweight authentication middleware - JWT verification only, no DB queries.
 * Use for read-only routes that only need identity from the verified JWT.
 * Attaches admin/session info from JWT payload:
 *   - req.admin = { _id: decoded.sub, sessionId: decoded.sid, email?: decoded.email, role?: decoded.role }
 *   - req.authSession = { _id: decoded.sid }
 * Does NOT verify: session revocation, admin active status, session existence in DB.
 * DO NOT use on mutation routes or routes requiring authoritative role checks.
 */
export const authenticateAdminJwtOnly = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const accessToken = bearerToken || req.cookies?.accessToken;

    if (!accessToken) {
      if (req.cookies?.token) {
        res.clearCookie('token');
      }
      return res.status(401).json({
        success: false,
        message: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }

    let decoded;
    try {
      decoded = verifyAccessToken(accessToken);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Access token expired',
          code: 'TOKEN_EXPIRED'
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Invalid session token',
        code: 'TOKEN_INVALID'
      });
    }

    if (
      decoded.type !== 'access' ||
      !decoded.sid ||
      !decoded.sub ||
      !mongoose.Types.ObjectId.isValid(decoded.sid) ||
      !mongoose.Types.ObjectId.isValid(decoded.sub)
    ) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token claims',
        code: 'TOKEN_INVALID'
      });
    }

    // Attach identity + cached context from verified JWT payload - NO database queries
    req.admin = {
      _id: decoded.sub,
      sessionId: decoded.sid,
      ...(decoded.email && { email: decoded.email }),
      ...(decoded.role && { role: decoded.role })
    };
    req.authSession = {
      _id: decoded.sid
    };
    req.authSource = 'jwt';

    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: 'Authentication failure',
      code: 'AUTH_FAILED'
    });
  }
};

export const requireRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (!allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
    }

    next();
  };
};

/**
 * Authoritative role verification middleware.
 * Guarantees that the role check is performed strictly against authoritative database state.
 * Explicitly rejects requests that bypassed database verification via authenticateAdminJwtOnly.
 */
export const requireAuthoritativeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    if (req.authSource !== 'db') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Authoritative database authentication required for role verification',
        code: 'AUTHORITATIVE_AUTH_REQUIRED'
      });
    }

    if (!allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden: Insufficient permissions' });
    }

    next();
  };
};
