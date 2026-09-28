import React, { useState } from 'react';
import { Lock, KeyRound, Eye, EyeOff, ShieldCheck, AlertCircle, CheckCircle2, X, Loader2 } from 'lucide-react';
import { adminChangePassword } from '../services/api';
import { useLanguage } from '../context/LanguageContext';

export default function ChangePasswordModal({ isOpen, onClose }) {
  const { isRtl } = useLanguage();

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showOld, setShowOld] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(false);

    if (!oldPassword) {
      setError(isRtl ? 'يرجى كتابة كلمة المرور الحالية.' : 'Veuillez saisir votre mot de passe actuel.');
      return;
    }

    if (!newPassword || newPassword.length < 8) {
      setError(isRtl ? 'يجب أن تتكون كلمة المرور الجديدة من 8 أحرف على الأقل.' : 'Le nouveau mot de passe doit comporter au moins 8 caractères.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(isRtl ? 'كلمتا المرور غير متطابقتين.' : 'Les deux nouveaux mots de passe ne correspondent pas.');
      return;
    }

    if (oldPassword === newPassword) {
      setError(isRtl ? 'يجب أن تكون كلمة المرور الجديدة مختلفة عن الحالية.' : 'Le nouveau mot de passe doit être différent de l\'actuel.');
      return;
    }

    setLoading(true);

    try {
      const res = await adminChangePassword(oldPassword, newPassword);
      if (res.success) {
        setSuccess(true);
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => {
          setSuccess(false);
          onClose();
        }, 2200);
      } else {
        setError(res.message || (isRtl ? 'فشل تحديث كلمة المرور.' : 'Échec de la mise à jour du mot de passe.'));
      }
    } catch (err) {
      setError(err.message || (isRtl ? 'خطأ في الاتصال بالخادم.' : 'Erreur lors du changement de mot de passe.'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setError('');
      setSuccess(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onClose();
    }
  };

  const inputContainer = {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    marginBottom: '1rem'
  };

  const inputStyle = {
    width: '100%',
    padding: '0.75rem 2.75rem 0.75rem 1rem',
    border: '1.5px solid #e0d9d0',
    borderRadius: '10px',
    fontSize: '0.9rem',
    color: '#2A241F',
    backgroundColor: '#FAF8F5',
    outline: 'none',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease'
  };

  const eyeBtnStyle = {
    position: 'absolute',
    [isRtl ? 'left' : 'right']: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    color: '#888',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  };

  const labelStyle = {
    display: 'block',
    fontSize: '0.8rem',
    fontWeight: '700',
    color: '#4A3E36',
    marginBottom: '0.4rem',
    textTransform: isRtl ? 'none' : 'uppercase',
    letterSpacing: isRtl ? '0' : '0.04em'
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(20, 16, 14, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '1rem'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        dir={isRtl ? 'rtl' : 'ltr'}
        style={{
          backgroundColor: '#FFFFFF',
          borderRadius: '18px',
          width: '100%',
          maxWidth: '460px',
          padding: '2rem 2.25rem',
          boxShadow: '0 25px 60px rgba(0,0,0,0.22)',
          border: '1px solid #e8e3dd',
          position: 'relative'
        }}
      >
        {/* Close Button */}
        <button
          onClick={handleClose}
          disabled={loading}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: '1.25rem',
            [isRtl ? 'left' : 'right']: '1.25rem',
            background: '#F5F2ED',
            border: 'none',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: '#666'
          }}
        >
          <X size={16} />
        </button>

        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
          <div style={{
            width: '40px',
            height: '40px',
            borderRadius: '10px',
            backgroundColor: '#2A241F',
            color: '#FFF',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <KeyRound size={20} />
          </div>
          <div>
            <h3 style={{
              margin: 0,
              fontSize: '1.2rem',
              fontWeight: '700',
              color: '#2A241F',
              fontFamily: "'Cormorant Garamond', Georgia, serif"
            }}>
              {isRtl ? 'تغيير كلمة المرور' : 'Changer mon mot de passe'}
            </h3>
            <p style={{ margin: 0, fontSize: '0.78rem', color: '#777' }}>
              {isRtl ? 'تأمين حساب المالك والمدير' : 'Sécurité renforcée du compte Propriétaire'}
            </p>
          </div>
        </div>

        <p style={{ fontSize: '0.82rem', color: '#666', lineHeight: 1.5, margin: '1rem 0 1.5rem 0' }}>
          {isRtl
            ? 'لأسباب أمنية، يرجى كتابة كلمة المرور الحالية أولاً ثم إدخال كلمة المرور الجديدة.'
            : 'Pour modifier votre mot de passe en toute sécurité, renseignez votre mot de passe actuel puis choisissez votre nouveau mot de passe.'}
        </p>

        {/* Success Alert */}
        {success && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            backgroundColor: '#eaf5eb',
            border: '1px solid #c3e6cb',
            color: '#1e4620',
            padding: '0.85rem 1rem',
            borderRadius: '10px',
            marginBottom: '1.25rem',
            fontSize: '0.85rem',
            fontWeight: '600'
          }}>
            <CheckCircle2 size={18} color="#2e7d32" />
            <span>
              {isRtl ? 'تم تغيير كلمة المرور بنجاح!' : 'Mot de passe modifié avec succès !'}
            </span>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            backgroundColor: '#fde8e8',
            border: '1px solid #f8b4b4',
            color: '#9b1c1c',
            padding: '0.85rem 1rem',
            borderRadius: '10px',
            marginBottom: '1.25rem',
            fontSize: '0.85rem'
          }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Current Password */}
          <div>
            <label style={labelStyle}>
              {isRtl ? 'كلمة المرور الحالية' : 'Mot de passe actuel'}
            </label>
            <div style={inputContainer}>
              <input
                type={showOld ? 'text' : 'password'}
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder={isRtl ? '••••••••' : 'Entrez votre mot de passe actuel'}
                autoComplete="current-password"
                required
                style={inputStyle}
                onFocus={(e) => { e.target.style.borderColor = '#2A241F'; }}
                onBlur={(e) => { e.target.style.borderColor = '#e0d9d0'; }}
              />
              <button
                type="button"
                style={eyeBtnStyle}
                onClick={() => setShowOld(!showOld)}
                tabIndex={-1}
              >
                {showOld ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div>
            <label style={labelStyle}>
              {isRtl ? 'كلمة المرور الجديدة' : 'Nouveau mot de passe'}
            </label>
            <div style={inputContainer}>
              <input
                type={showNew ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={isRtl ? '8 أحرف على الأقل' : 'Minimum 8 caractères'}
                autoComplete="new-password"
                required
                minLength={8}
                style={inputStyle}
                onFocus={(e) => { e.target.style.borderColor = '#2A241F'; }}
                onBlur={(e) => { e.target.style.borderColor = '#e0d9d0'; }}
              />
              <button
                type="button"
                style={eyeBtnStyle}
                onClick={() => setShowNew(!showNew)}
                tabIndex={-1}
              >
                {showNew ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Confirm New Password */}
          <div>
            <label style={labelStyle}>
              {isRtl ? 'تأكيد كلمة المرور الجديدة' : 'Confirmer le nouveau mot de passe'}
            </label>
            <div style={inputContainer}>
              <input
                type={showConfirm ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={isRtl ? 'أعد كتابة كلمة المرور' : 'Retapez le nouveau mot de passe'}
                autoComplete="new-password"
                required
                minLength={8}
                style={inputStyle}
                onFocus={(e) => { e.target.style.borderColor = '#2A241F'; }}
                onBlur={(e) => { e.target.style.borderColor = '#e0d9d0'; }}
              />
              <button
                type="button"
                style={eyeBtnStyle}
                onClick={() => setShowConfirm(!showConfirm)}
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Security Reassurance */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.45rem',
            fontSize: '0.74rem',
            color: '#666',
            marginBottom: '1.5rem',
            backgroundColor: '#FAF8F5',
            padding: '0.6rem 0.8rem',
            borderRadius: '8px',
            border: '1px solid #ECE7E1'
          }}>
            <ShieldCheck size={15} color="#2A241F" style={{ flexShrink: 0 }} />
            <span>
              {isRtl
                ? 'تشفير آمن بنظام bcrypt لحماية كاملة للحساب.'
                : 'Chiffrement sécurisé bcrypt & révocation des anciennes sessions.'}
            </span>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleClose}
              disabled={loading}
              style={{
                padding: '0.75rem 1.4rem',
                borderRadius: '10px',
                border: '1.5px solid #dcd7ce',
                backgroundColor: '#FFF',
                color: '#555',
                fontSize: '0.85rem',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              {isRtl ? 'إلغاء' : 'Annuler'}
            </button>

            <button
              type="submit"
              disabled={loading}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1.8rem',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: '#2A241F',
                color: '#FFF',
                fontSize: '0.88rem',
                fontWeight: '700',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.75 : 1,
                boxShadow: '0 4px 12px rgba(42,36,31,0.2)'
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>{isRtl ? 'جارٍ التحديث...' : 'Modification...'}</span>
                </>
              ) : (
                <>
                  <Lock size={15} />
                  <span>{isRtl ? 'تحديث كلمة المرور' : 'Enregistrer'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
