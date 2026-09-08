import jwt from 'jsonwebtoken';
import { Admin } from '../models/Admin.js';

export const authenticateAdmin = async (req, res, next) => {
  try {
    let token = req.cookies?.token;

    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'merya_dz_super_secure_jwt_secret_key_prod_2026_algeria_taupe');
    const admin = await Admin.findById(decoded.id).select('-passwordHash');

    if (!admin || !admin.isActive) {
      return res.status(401).json({ success: false, message: 'Invalid session or account inactive' });
    }

    req.admin = admin;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session token' });
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
