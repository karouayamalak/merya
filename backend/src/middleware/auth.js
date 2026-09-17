import mongoose from 'mongoose';
import { Admin } from '../models/Admin.js';
import { Session } from '../models/Session.js';
import { verifyAccessToken } from '../utils/tokenUtils.js';

export const authenticateAdmin = async (req, res, next) => {
  try {
    // COOKIE-ONLY authentication with accessToken.
    const accessToken = req.cookies?.accessToken;

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
    next();
  } catch (error) {
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
