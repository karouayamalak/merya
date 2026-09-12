import jwt from 'jsonwebtoken';
import { Admin } from '../models/Admin.js';
import { wsService } from '../services/websocketService.js';

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin || !admin.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid credentials or inactive account' });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    admin.lastLoginAt = new Date();
    await admin.save();

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is missing on server');
    }

    const token = jwt.sign(
      {
        id: admin._id,
        role: admin.role,
        username: admin.username,
        sessionVersion: admin.sessionVersion !== undefined ? admin.sessionVersion : 1
      },
      secret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    const isProduction = process.env.NODE_ENV === 'production';
    // Cross-domain SPA (e.g. Vercel frontend + Render/Railway backend) requires sameSite: 'none' and secure: true.
    // If running on identical domain/subdomain, can be overridden with COOKIE_SAME_SITE=lax or strict.
    const sameSite = isProduction ? (process.env.COOKIE_SAME_SITE || 'none') : 'lax';

    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite,
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // NOTE: The JWT is intentionally NOT included in the response body.
    // It is set exclusively via an HttpOnly cookie above, preventing XSS token theft.
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

export const logout = async (req, res, next) => {
  try {
    // Increment admin sessionVersion in DB so any previously issued JWT is immediately revoked server-side
    const token = req.cookies?.token;
    if (token && process.env.JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded?.id) {
          await Admin.findByIdAndUpdate(decoded.id, { $inc: { sessionVersion: 1 } });
          wsService.revokeAdminSession(decoded.id);
        }
      } catch {
        // Token already invalid or expired; proceed with cookie clearing
      }
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const sameSite = isProduction ? (process.env.COOKIE_SAME_SITE || 'none') : 'lax';
    res.clearCookie('token', {
      httpOnly: true,
      secure: isProduction,
      sameSite
    });
    res.json({ success: true, message: 'Logged out successfully' });
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
