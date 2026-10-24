import crypto from 'crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Admin } from '../models/Admin.js';
import { Session } from '../models/Session.js';
import { wsService } from '../services/websocketService.js';
import { sendTelegramPasswordResetOtp, sendTelegramPasswordResetSuccessAlert } from '../services/telegramService.js';
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

    const normalizedEmail = email.toLowerCase().trim();
    let admin = await Admin.findOne({ email: normalizedEmail });
    if (!admin && (normalizedEmail === 'marouataileb3@gmail.com' || normalizedEmail === (process.env.RESET_NOTIFICATION_EMAIL || '').toLowerCase())) {
      admin = await Admin.findOne({ role: 'owner' }) || await Admin.findOne({ email: 'admin@meryadz.com' });
    }
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

    // Set secure HttpOnly cookies (and return token in JSON for cross-site SPA support)
    setAuthCookies(res, { accessToken, refreshToken });

    res.json({
      success: true,
      accessToken,
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
    } catch {
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
      accessToken: tokens.accessToken,
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

export const changePassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const adminId = req.admin?._id;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current password and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters long' });
    }

    if (oldPassword === newPassword) {
      return res.status(400).json({ success: false, message: 'New password must be different from current password' });
    }

    const admin = await Admin.findById(adminId);
    if (!admin || !admin.isActive) {
      return res.status(401).json({ success: false, message: 'Admin account not found or inactive' });
    }

    const isMatch = await admin.comparePassword(oldPassword);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    const salt = await bcrypt.genSalt(12);
    admin.passwordHash = await bcrypt.hash(newPassword, salt);
    await admin.save();

    // Revoke any other sessions across other devices/browsers for security
    const currentSessionId = req.authSession?._id;
    if (currentSessionId) {
      await Session.updateMany(
        { adminId: admin._id, _id: { $ne: currentSessionId }, revokedAt: null },
        { $set: { revokedAt: new Date(), revokeReason: 'PASSWORD_CHANGED' } }
      );
    }

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    let admin = await Admin.findOne({ email: normalizedEmail });
    if (!admin) {
      admin = await Admin.findOne({ role: 'owner' }) || await Admin.findOne({ role: 'admin' }) || await Admin.findOne();
    }

    // Always return a consistent success message to prevent user enumeration
    const genericResponse = {
      success: true,
      message: 'If an administrator account is associated with this email, a verification code has been dispatched to your Telegram.'
    };

    if (!admin || !admin.isActive) {
      return res.json(genericResponse);
    }

    // Generate cryptographically secure 6-digit random code
    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');

    // 10 minutes expiry
    admin.resetPasswordOtpHash = otpHash;
    admin.resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000);
    admin.resetPasswordAttempts = 0;
    await admin.save();

    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const recipientEmail = admin.email || normalizedEmail;

    // Send OTP via Telegram Bot only
    await sendTelegramPasswordResetOtp({
      adminEmail: recipientEmail,
      username: admin.username,
      otp,
      ipAddress
    });

    res.json(genericResponse);
  } catch (err) {
    next(err);
  }
};

export const resetPasswordWithOtp = async (req, res, next) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'Email, verification code, and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters long' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    let admin = await Admin.findOne({ email: normalizedEmail });
    if (!admin) {
      admin = await Admin.findOne({ resetPasswordOtpHash: { $ne: null } })
        || await Admin.findOne({ role: 'owner' })
        || await Admin.findOne({ role: 'admin' })
        || await Admin.findOne();
    }
    if (!admin || !admin.isActive || !admin.resetPasswordOtpHash || !admin.resetPasswordExpires) {
      return res.status(400).json({ success: false, message: 'Invalid or expired password reset request. Please request a new code.' });
    }

    // Check expiry
    if (admin.resetPasswordExpires <= new Date()) {
      admin.resetPasswordOtpHash = null;
      admin.resetPasswordExpires = null;
      admin.resetPasswordAttempts = 0;
      await admin.save();
      return res.status(400).json({ success: false, message: 'Verification code has expired. Please request a new code.' });
    }

    // Check maximum attempts (max 5)
    if (admin.resetPasswordAttempts >= 5) {
      admin.resetPasswordOtpHash = null;
      admin.resetPasswordExpires = null;
      admin.resetPasswordAttempts = 0;
      await admin.save();
      return res.status(400).json({ success: false, message: 'Too many incorrect attempts. Please request a new code.' });
    }

    // Hash candidate OTP with SHA-256
    const candidateHash = crypto.createHash('sha256').update(otp.trim()).digest('hex');

    // Constant-time comparison to prevent timing attacks
    const otpBuffer = Buffer.from(candidateHash, 'hex');
    const targetBuffer = Buffer.from(admin.resetPasswordOtpHash, 'hex');
    const isMatch = otpBuffer.length === targetBuffer.length && crypto.timingSafeEqual(otpBuffer, targetBuffer);

    if (!isMatch) {
      admin.resetPasswordAttempts = (admin.resetPasswordAttempts || 0) + 1;
      await admin.save();
      const remainingAttempts = Math.max(0, 5 - admin.resetPasswordAttempts);
      return res.status(400).json({
        success: false,
        message: `Invalid verification code. ${remainingAttempts} attempt(s) remaining.`
      });
    }

    // Code is valid! Hash new password with bcrypt
    const salt = await bcrypt.genSalt(12);
    admin.passwordHash = await bcrypt.hash(newPassword, salt);
    admin.resetPasswordOtpHash = null;
    admin.resetPasswordExpires = null;
    admin.resetPasswordAttempts = 0;
    await admin.save();

    // Revoke ALL active sessions for this admin account for security
    await revokeAllAdminSessions(admin._id, 'LOGOUT_ALL');
    wsService.revokeAdminAllSessions(admin._id);

    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const notificationEmail = admin.email || normalizedEmail;
    // Send Telegram alert confirming successful reset
    sendTelegramPasswordResetSuccessAlert({
      adminEmail: notificationEmail,
      username: admin.username,
      ipAddress
    }).catch(() => {});

    res.json({
      success: true,
      message: 'Password has been reset successfully. You can now sign in with your new password.'
    });
  } catch (err) {
    next(err);
  }
};

