import { z } from 'zod';

// Admin login schema
export const adminLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters')
});

// Admin change password schema
export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters')
});

// Admin forgot password request schema
export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address')
});

// Admin reset password with OTP schema
export const resetPasswordWithOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().regex(/^\d{6}$/, 'Verification code must be exactly 6 digits'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters')
});

