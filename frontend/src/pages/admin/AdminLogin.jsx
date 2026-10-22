import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Lock,
  Mail,
  AlertCircle,
  Loader2,
  KeyRound,
  CheckCircle2,
  ArrowLeft,
  RefreshCw,
  Eye,
  EyeOff
} from 'lucide-react';
import { useAdminAuth } from '../../context/AdminAuthContext';
import { useLanguage } from '../../context/LanguageContext';
import LanguageSwitcher from '../../components/LanguageSwitcher';
import { adminForgotPassword, adminResetPasswordWithOtp } from '../../services/api';

export default function AdminLogin({ onLoginSuccess, onBackToStore }) {
  const { login } = useAdminAuth();
  const { t, isRtl } = useLanguage();

  // Mode: 'LOGIN' | 'FORGOT_EMAIL' | 'VERIFY_RESET' | 'RESET_SUCCESS'
  const [mode, setMode] = useState('LOGIN');

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // UI states
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Resend cooldown timer
  useEffect(() => {
    let timer;
    if (resendCooldown > 0) {
      timer = setTimeout(() => setResendCooldown((prev) => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');
    setLoading(true);

    try {
      await login(email, password);
      onLoginSuccess();
    } catch (err) {
      setError(err.message || t('admin.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  const handleRequestOtp = async (e) => {
    if (e) e.preventDefault();
    if (!email) {
      setError(t('admin.emailRequired') || 'Veuillez saisir votre adresse email.');
      return;
    }

    setError('');
    setInfoMessage('');
    setLoading(true);

    try {
      await adminForgotPassword(email);
      setMode('VERIFY_RESET');
      setResendCooldown(60);
      setInfoMessage(`${t('admin.codeSentNotice')} ${email}`);
    } catch (err) {
      setError(err.message || 'Impossible d\'envoyer le code de réinitialisation.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError(t('admin.confirmPasswordMismatch'));
      return;
    }

    if (newPassword.length < 8) {
      setError('Le nouveau mot de passe doit comporter au moins 8 caractères.');
      return;
    }

    setLoading(true);

    try {
      await adminResetPasswordWithOtp(email, otp.trim(), newPassword);
      setMode('RESET_SUCCESS');
      setPassword('');
      setOtp('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message || 'Code invalide ou expiré.');
    } finally {
      setLoading(false);
    }
  };

  const resetToLogin = () => {
    setMode('LOGIN');
    setError('');
    setInfoMessage('');
    setPassword('');
    setOtp('');
    setNewPassword('');
    setConfirmPassword('');
  };

  return (
    <div
      style={{
        minHeight: '88vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2.5rem 1rem'
      }}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '430px',
          backgroundColor: 'var(--color-surface, #ffffff)',
          borderRadius: 'var(--radius-xl, 16px)',
          padding: '2.5rem',
          boxShadow: 'var(--shadow-lg, 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.04))',
          border: '1px solid var(--color-border, #eaeaea)',
          position: 'relative'
        }}
      >
        {/* Language Switcher Top Corner */}
        <div style={{ display: 'flex', justifyContent: isRtl ? 'flex-start' : 'flex-end', marginBottom: '1rem' }}>
          <LanguageSwitcher />
        </div>

        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <img
            src="/logo.png"
            alt="MERYA DZ"
            style={{ height: '52px', width: 'auto', margin: '0 auto 1.25rem auto' }}
          />

          {mode === 'LOGIN' && (
            <>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t('admin.portalTitle')}
              </h2>
              <p style={{ fontSize: '0.82rem', color: '#666', marginTop: '0.25rem' }}>
                {t('admin.loginSubtitle')}
              </p>
            </>
          )}

          {(mode === 'FORGOT_EMAIL' || mode === 'VERIFY_RESET') && (
            <>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '44px',
                  height: '44px',
                  borderRadius: '50%',
                  backgroundColor: '#f5efe9',
                  color: 'var(--color-primary, #b5835a)',
                  marginBottom: '0.75rem'
                }}
              >
                <KeyRound size={22} />
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '800', letterSpacing: '0.02em' }}>
                {t('admin.resetTitle')}
              </h2>
              <p style={{ fontSize: '0.82rem', color: '#666', marginTop: '0.25rem', lineHeight: '1.4' }}>
                {t('admin.resetSubtitle')}
              </p>
            </>
          )}

          {mode === 'RESET_SUCCESS' && (
            <>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '48px',
                  height: '48px',
                  borderRadius: '50%',
                  backgroundColor: '#E8F5E9',
                  color: '#2E7D32',
                  marginBottom: '0.75rem'
                }}
              >
                <CheckCircle2 size={26} />
              </div>
              <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: '#1B5E20' }}>
                {t('admin.resetSuccessTitle')}
              </h2>
            </>
          )}
        </div>

        {/* Error Alert */}
        {error && (
          <div
            style={{
              backgroundColor: '#FFEBEE',
              border: '1px solid #FFCDD2',
              color: 'var(--color-danger, #d32f2f)',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md, 8px)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.85rem',
              marginBottom: '1.5rem',
              lineHeight: '1.4'
            }}
          >
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Info Notice */}
        {infoMessage && (
          <div
            style={{
              backgroundColor: '#E8F4FD',
              border: '1px solid #BBDEFB',
              color: '#0D47A1',
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md, 8px)',
              fontSize: '0.82rem',
              marginBottom: '1.5rem',
              lineHeight: '1.4'
            }}
          >
            {infoMessage}
          </div>
        )}

        {/* ─── 1. LOGIN FORM ────────────────────────────────────────────── */}
        {mode === 'LOGIN' && (
          <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.82rem',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: '0.4rem'
                }}
              >
                {t('admin.email')}
              </label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: 'var(--color-bg-base, #f9f9f9)',
                  border: '1px solid var(--color-border, #eaeaea)',
                  borderRadius: 'var(--radius-md, 8px)',
                  padding: '0.65rem 0.85rem'
                }}
              >
                <Mail size={16} color="#888" style={{ [isRtl ? 'marginLeft' : 'marginRight']: '0.5rem' }} />
                <input
                  type="email"
                  required
                  value={email}
                  placeholder="admin@meryadz.com"
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: '0.9rem' }}
                />
              </div>
            </div>

            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <label
                  style={{
                    fontSize: '0.82rem',
                    fontWeight: '700',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em'
                  }}
                >
                  {t('admin.password')}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setInfoMessage('');
                    setMode('FORGOT_EMAIL');
                  }}
                  style={{
                    fontSize: '0.78rem',
                    color: 'var(--color-primary, #b5835a)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: '600',
                    padding: 0
                  }}
                >
                  {t('admin.forgotPassword')}
                </button>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: 'var(--color-bg-base, #f9f9f9)',
                  border: '1px solid var(--color-border, #eaeaea)',
                  borderRadius: 'var(--radius-md, 8px)',
                  padding: '0.65rem 0.85rem'
                }}
              >
                <Lock size={16} color="#888" style={{ [isRtl ? 'marginLeft' : 'marginRight']: '0.5rem' }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: '0.9rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0.25rem', color: '#888' }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.85rem', marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
              <span>{t('admin.signIn')}</span>
            </button>

            <button
              type="button"
              onClick={onBackToStore}
              style={{
                fontSize: '0.82rem',
                color: '#777',
                textAlign: 'center',
                marginTop: '0.5rem',
                background: 'none',
                border: 'none',
                cursor: 'pointer'
              }}
            >
              {isRtl ? `${t('admin.backToStore')} →` : `← ${t('admin.backToStore')}`}
            </button>
          </form>
        )}

        {/* ─── 2. FORGOT PASSWORD (REQUEST OTP) ─────────────────────────── */}
        {mode === 'FORGOT_EMAIL' && (
          <form onSubmit={handleRequestOtp} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.82rem',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: '0.4rem'
                }}
              >
                {t('admin.email')}
              </label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: 'var(--color-bg-base, #f9f9f9)',
                  border: '1px solid var(--color-border, #eaeaea)',
                  borderRadius: 'var(--radius-md, 8px)',
                  padding: '0.65rem 0.85rem'
                }}
              >
                <Mail size={16} color="#888" style={{ [isRtl ? 'marginLeft' : 'marginRight']: '0.5rem' }} />
                <input
                  type="email"
                  required
                  placeholder="marouataileb3@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: '0.9rem' }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.85rem', marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={18} />}
              <span>{t('admin.sendResetCode')}</span>
            </button>

            <button
              type="button"
              onClick={resetToLogin}
              style={{
                fontSize: '0.82rem',
                color: '#666',
                textAlign: 'center',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.35rem'
              }}
            >
              <ArrowLeft size={14} style={{ transform: isRtl ? 'scaleX(-1)' : 'none' }} />
              <span>{t('admin.backToLogin')}</span>
            </button>
          </form>
        )}

        {/* ─── 3. VERIFY OTP & ENTER NEW PASSWORD ───────────────────────── */}
        {mode === 'VERIFY_RESET' && (
          <form onSubmit={handleResetSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.82rem',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: '0.4rem'
                }}
              >
                {t('admin.otpCode')}
              </label>
              <input
                type="text"
                required
                maxLength={6}
                value={otp}
                placeholder="123456"
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  textAlign: 'center',
                  fontSize: '1.4rem',
                  fontWeight: '700',
                  letterSpacing: '0.4em',
                  fontFamily: 'monospace',
                  backgroundColor: 'var(--color-bg-base, #f9f9f9)',
                  border: '2px solid var(--color-primary, #b5835a)',
                  borderRadius: 'var(--radius-md, 8px)',
                  outline: 'none'
                }}
              />
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.82rem',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: '0.4rem'
                }}
              >
                {t('admin.newPassword')}
              </label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: 'var(--color-bg-base, #f9f9f9)',
                  border: '1px solid var(--color-border, #eaeaea)',
                  borderRadius: 'var(--radius-md, 8px)',
                  padding: '0.65rem 0.85rem'
                }}
              >
                <Lock size={16} color="#888" style={{ [isRtl ? 'marginLeft' : 'marginRight']: '0.5rem' }} />
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: '0.9rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0.25rem', color: '#888' }}
                >
                  {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <div>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.82rem',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  marginBottom: '0.4rem'
                }}
              >
                {t('admin.confirmNewPassword')}
              </label>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: 'var(--color-bg-base, #f9f9f9)',
                  border: '1px solid var(--color-border, #eaeaea)',
                  borderRadius: 'var(--radius-md, 8px)',
                  padding: '0.65rem 0.85rem'
                }}
              >
                <Lock size={16} color="#888" style={{ [isRtl ? 'marginLeft' : 'marginRight']: '0.5rem' }} />
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none', fontSize: '0.9rem' }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.85rem', marginTop: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              {loading ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
              <span>{t('admin.resetTitle')}</span>
            </button>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={resetToLogin}
                style={{
                  fontSize: '0.8rem',
                  color: '#666',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}
              >
                <ArrowLeft size={14} style={{ transform: isRtl ? 'scaleX(-1)' : 'none' }} />
                <span>{t('admin.backToLogin')}</span>
              </button>

              <button
                type="button"
                disabled={resendCooldown > 0 || loading}
                onClick={() => handleRequestOtp()}
                style={{
                  fontSize: '0.8rem',
                  color: resendCooldown > 0 ? '#aaa' : 'var(--color-primary, #b5835a)',
                  background: 'none',
                  border: 'none',
                  cursor: resendCooldown > 0 ? 'not-allowed' : 'pointer',
                  fontWeight: '600',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem'
                }}
              >
                <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                <span>
                  {resendCooldown > 0 ? `${t('admin.resendCode')} (${resendCooldown}s)` : t('admin.resendCode')}
                </span>
              </button>
            </div>
          </form>
        )}

        {/* ─── 4. RESET SUCCESS CONFIRMATION ────────────────────────────── */}
        {mode === 'RESET_SUCCESS' && (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <p style={{ fontSize: '0.88rem', color: '#555', lineHeight: '1.6' }}>
              {t('admin.resetSuccessMessage')}
            </p>

            <button
              type="button"
              onClick={resetToLogin}
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.85rem' }}
            >
              {t('admin.signIn')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
