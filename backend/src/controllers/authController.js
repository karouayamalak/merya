import mongoose from 'mongoose';
import { Admin } from '../models/Admin.js';
import { Session } from '../models/Session.js';
import { wsService } from '../services/websocketService.js';
import {
  createSession,
  rotateSessionToken,
  revokeSession,
  revokeAllAdminSessions,
  getAdminSessions
} from '../services/sessionService.js';
import {
  verifyAccessToken,
  verifyRefreshToken
} from '../utils/tokenUtils.js';
import {
  setAuthCookies,
  clearAuthCookies
} from '../utils/cookieUtils.js';

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin || !admin.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid credentials or inactive account' });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Update lastLoginAt
    admin.lastLoginAt = new Date();
    await admin.save();

    const userAgent = req.headers['user-agent'] || null;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;

    // Create unique independent session for this device/browser
    const { accessToken, refreshToken } = await createSession({
      adminId: admin._id,
      email: admin.email,
      role: admin.role,
      userAgent,
      ipAddress
    });

    // Set secure HttpOnly cookies (never return raw tokens in JSON)
    setAuthCookies(res, { accessToken, refreshToken });

    res.json({
      success: true,
      admin: {
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: admin.role
      }
    });
  } catch (error) {
    next(error);
  }
};

export const refresh = async (req, res, next) => {
  try {
    const refreshToken = req.cookies?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ success: false, message: 'Authentication required: no refresh token' });
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch {
      clearAuthCookies(res);
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    if (!mongoose.Types.ObjectId.isValid(decoded.sid) || !mongoose.Types.ObjectId.isValid(decoded.sub)) {
      clearAuthCookies(res);
      return res.status(401).json({ success: false, message: 'Session not found' });
    }

    const session = await Session.findById(decoded.sid);
    if (!session || String(session.adminId) !== decoded.sub) {
      clearAuthCookies(res);
      return res.status(401).json({ success: false, message: 'Session not found' });
    }

    if (session.revokedAt || session.expiresAt <= new Date()) {
      clearAuthCookies(res);
      return res.status(401).json({ success: false, message: 'Session has been revoked or expired. Please log in again.' });
    }

    // Authoritative check on Admin state
    const admin = await Admin.findById(session.adminId);
    if (!admin || !admin.isActive) {
      await revokeSession(session._id, 'ADMIN_DEACTIVATED');
      clearAuthCookies(res);
      return res.status(401).json({ success: false, message: 'Account is inactive' });
    }

    // Rotate refresh token atomically
    let tokens;
    try {
      tokens = await rotateSessionToken({
        session,
        presentedRefreshToken: refreshToken,
        email: admin.email,
        role: admin.role
      });
    } catch (rotationErr) {
      clearAuthCookies(res);
      return res.status(401).json({
        success: false,
        message: 'Failed to refresh token'
      });
    }

    setAuthCookies(res, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken
    });

    res.json({
      success: true,
      message: 'Token refreshed successfully'
    });
  } catch (err) {
    next(err);
  }
};

export const logout = async (req, res, next) => {
  try {
    // Identify current session ID from authSession, accessToken, or refreshToken
    let sessionId = req.authSession?._id;

    if (!sessionId) {
      const accessToken = req.cookies?.accessToken;
      if (accessToken) {
        try {
          const decoded = verifyAccessToken(accessToken);
          sessionId = decoded.sid;
        } catch {
          // Access token might be expired; try refresh token
        }
      }
    }

    if (!sessionId) {
      const refreshToken = req.cookies?.refreshToken;
      if (refreshToken) {
        try {
          const decoded = verifyRefreshToken(refreshToken);
          sessionId = decoded.sid;
        } catch {
          // Token invalid or already expired
        }
      }
    }

    if (sessionId) {
      await revokeSession(sessionId, 'LOGOUT');
      // Revoke only WebSockets tied to this specific session
      wsService.revokeAdminSession(sessionId);
    }

    // Always clear all auth cookies
    clearAuthCookies(res);

    res.json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    next(err);
  }
};

export const logoutAll = async (req, res, next) => {
  try {
    const adminId = req.admin?._id;
    if (!adminId) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    await revokeAllAdminSessions(adminId, 'LOGOUT_ALL');
    wsService.revokeAdminAllSessions(adminId);

    clearAuthCookies(res);

    res.json({ success: true, message: 'All active sessions revoked successfully' });
  } catch (err) {
    next(err);
  }
};

export const getMe = (req, res) => {
  res.json({
    success: true,
    admin: {
      id: req.admin._id,
      username: req.admin.username,
      email: req.admin.email,
      role: req.admin.role
    }
  });
};

export const getSessions = async (req, res, next) => {
  try {
    const adminId = req.admin?._id;
    const currentSessionId = req.authSession?._id;

    const sessions = await getAdminSessions(adminId, currentSessionId);
    res.json({
      success: true,
      sessions
    });
  } catch (err) {
    next(err);
  }
};
