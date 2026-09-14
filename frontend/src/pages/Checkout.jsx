import React, { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  ShieldCheck,
  Building2,
  Home as HomeIcon,
  CheckCircle2,
  AlertCircle,
  Loader2,
  User,
  MapPin,
  Phone,
  ClipboardList,
  FileText,
  Truck
} from 'lucide-react';
import { useCart } from '../context/CartContext';
import { fetchDeliverySettings, submitCheckout } from '../services/api';
import {
  validateDeliverySettingsResponse,
  calculateDeliveryFee,
  revalidateCartWithServer
} from '../services/checkoutValidation';
import { useLanguage } from '../context/LanguageContext';

export default function Checkout({ onBack, onOrderSuccess }) {
  const { items, subtotal, clearCart, updateCartItems } = useCart();
  const { t, formatCurrency, isRtl, getWilayaDisplayName, localized } = useLanguage();

  // Explicit delivery settings state
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [settingsError, setSettingsError] = useState(null);
  const [deliverySettings, setDeliverySettings] = useState(null);
  const [wilayas, setWilayas] = useState([]);

  // Form state (Nom, Prénom, Téléphone, Wilaya, Mode d'envoi, Adresse/Agence, Notes)
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedWilayaCode, setSelectedWilayaCode] = useState(null); // Selected strictly after load
  const [deliveryMethod, setDeliveryMethod] = useState('home'); // 'home' or 'agency'
  const [agencyName, setAgencyName] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  // Submitting, Double-click protection & Cart notices
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cartNotice, setCartNotice] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [idempotencyKey] = useState(() => {
    try {
      const stored = sessionStorage.getItem('merya_checkout_idempotency_key');
      if (stored && /^[a-zA-Z0-9_-]{8,128}$/.test(stored)) {
        return stored;
      }
      const newKey = `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      sessionStorage.setItem('merya_checkout_idempotency_key', newKey);
      return newKey;
    } catch {
      return `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }
  });

  useEffect(() => {
    if (items.length === 0) {
      try {
        sessionStorage.removeItem('merya_checkout_idempotency_key');
      } catch {}
    }
  }, [items.length]);

  // Server live-quote state — authoritative display values once a quote is obtained
  // null = no quote yet / loading; populated once server responds
  const [liveQuote, setLiveQuote] = useState(null);
  const [liveQuoteLoading, setLiveQuoteLoading] = useState(false);
  const [liveQuoteError, setLiveQuoteError] = useState('');
  const liveQuoteDebounceRef = useRef(null);

  const loadSettings = async () => {
    setLoadingSettings(true);
    setSettingsError(null);
    try {
      const res = await fetchDeliverySettings();
      const validation = validateDeliverySettingsResponse(res);
      if (!validation.valid) {
        setLoadingSettings(false);
        setSettingsError(validation.error || t('checkout.deliverySettingsError'));
        setWilayas([]);
        setDeliverySettings(null);
        setSelectedWilayaCode(null);
      } else {
        setWilayas(validation.wilayas);
        setDeliverySettings(validation.settings);
        setLoadingSettings(false);

        // Select Wilaya 16 (Alger) if available, otherwise pick first available canonical Wilaya
        const wilaya16 = validation.wilayas.find(w => w.code === 16 && w.isAvailable);
        if (wilaya16) {
          setSelectedWilayaCode(16);
        } else {
          const firstAvailable = validation.wilayas.find(w => w.isAvailable);
          setSelectedWilayaCode(firstAvailable ? firstAvailable.code : (validation.wilayas[0]?.code || null));
        }
      }
    } catch {
      setLoadingSettings(false);
      setSettingsError(t('checkout.deliverySettingsError'));
      setWilayas([]);
      setDeliverySettings(null);
      setSelectedWilayaCode(null);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  /**
   * Reactive live-quote effect.
   */
  useEffect(() => {
    if (loadingSettings || settingsError || !selectedWilayaCode || wilayas.length !== 58) return;
    if (!items || items.length === 0) {
      setLiveQuote(null);
      setLiveQuoteError('');
      return;
    }

    let isMounted = true;

    if (liveQuoteDebounceRef.current) clearTimeout(liveQuoteDebounceRef.current);

    liveQuoteDebounceRef.current = setTimeout(async () => {
      setLiveQuoteLoading(true);
      setLiveQuoteError('');
      try {
        const res = await revalidateCartWithServer(items, {
          wilayaCode: selectedWilayaCode,
          deliveryMethod
        });

        if (!isMounted) return;
        setLiveQuoteLoading(false);

        if (res.pricesChanged && res.updatedItems.length > 0) {
          updateCartItems(res.updatedItems);
          setCartNotice(t('checkout.cartUpdatedNotice'));
        }

        if (res.success && res.isValid) {
          setLiveQuote(res);
          setLiveQuoteError('');
        } else {
          setLiveQuote(null);
          const errMsg = res.issues && res.issues.length > 0
            ? res.issues.join(' • ')
            : t('checkout.quoteVerifyError');
          setLiveQuoteError(errMsg);
          setErrorMessage(errMsg);
        }
      } catch {
        if (!isMounted) return;
        setLiveQuoteLoading(false);
        setLiveQuote(null);
        setLiveQuoteError(t('checkout.quoteVerifyError'));
      }
    }, 300);

    return () => {
      isMounted = false;
      if (liveQuoteDebounceRef.current) clearTimeout(liveQuoteDebounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWilayaCode, deliveryMethod, items, loadingSettings, settingsError]);

  // Look up selected Wilaya strictly from validated server data — NO hardcoded fallback values
  const selectedWilayaObj = (!loadingSettings && !settingsError && selectedWilayaCode !== null && wilayas.length === 58)
    ? (wilayas.find(w => w.code === selectedWilayaCode) || null)
    : null;

  const isSettingsReady = !loadingSettings && !settingsError && wilayas.length === 58 && selectedWilayaObj !== null;
  const isWilayaAvailable = selectedWilayaObj ? selectedWilayaObj.isAvailable : false;

  const freeDeliveryThreshold = (deliverySettings && typeof deliverySettings.freeDeliveryThreshold === 'number')
    ? deliverySettings.freeDeliveryThreshold
    : 0;

  // Raw fee from server configuration
  const rawDeliveryFee = (isSettingsReady && isWilayaAvailable)
    ? (deliveryMethod === 'agency' ? selectedWilayaObj.agencyFee : selectedWilayaObj.homeFee)
    : null;

  // Authoritative delivery fee calculation applying freeDeliveryThreshold
  const activeDeliveryFee = calculateDeliveryFee({
    subtotal,
    rawDeliveryFee,
    freeDeliveryThreshold
  });

  const isFreeDelivery = (
    rawDeliveryFee !== null &&
    activeDeliveryFee === 0 &&
    freeDeliveryThreshold > 0 &&
    subtotal >= freeDeliveryThreshold
  );

  const hasValidLiveQuote = Boolean(
    liveQuote &&
    liveQuote.success &&
    liveQuote.isValid &&
    typeof liveQuote.subtotal === 'number' &&
    typeof liveQuote.totalPrice === 'number'
  );

  const displaySubtotal = hasValidLiveQuote ? liveQuote.subtotal : null;
  const displayDeliveryFee = hasValidLiveQuote && typeof liveQuote.deliveryFee === 'number'
    ? liveQuote.deliveryFee
    : null;
  const displayIsFreeDelivery = hasValidLiveQuote
    ? Boolean(liveQuote.isFreeDelivery)
    : false;
  const displayFreeThreshold = hasValidLiveQuote && typeof liveQuote.freeDeliveryThreshold === 'number'
    ? liveQuote.freeDeliveryThreshold
    : freeDeliveryThreshold;
  const displayTotal = hasValidLiveQuote ? liveQuote.totalPrice : null;
  const displayRawFee = hasValidLiveQuote && displayIsFreeDelivery
    ? (rawDeliveryFee !== null ? rawDeliveryFee : (displayDeliveryFee === 0 ? null : displayDeliveryFee))
    : rawDeliveryFee;

  const isSubmitDisabled =
    loadingSettings === true ||
    Boolean(settingsError) ||
    !deliverySettings ||
    wilayas.length !== 58 ||
    !selectedWilayaObj ||
    !isWilayaAvailable ||
    items.length === 0 ||
    isSubmitting === true ||
    isValidatingCart === true ||
    liveQuoteLoading === true ||
    !hasValidLiveQuote;

  const handleSubmitOrder = async (e) => {
    e.preventDefault();
    setErrorMessage('');
    setCartNotice('');

    if (loadingSettings) {
      setErrorMessage(t('checkout.waitLoadingRatesError'));
      return;
    }
    if (settingsError || !isSettingsReady || !selectedWilayaObj) {
      setErrorMessage(t('checkout.deliveryRatesUnavailableError'));
      return;
    }
    if (!selectedWilayaObj.isAvailable) {
      setErrorMessage(t('checkout.wilayaNotAvailableError'));
      return;
    }

    const fullName = `${nom} ${prenom}`.trim();
    if (!fullName) {
      setErrorMessage(t('checkout.fillNameError'));
      return;
    }
    if (!phone.trim() || phone.trim().length < 8) {
      setErrorMessage(t('checkout.invalidPhoneError'));
      return;
    }
    if (deliveryMethod === 'home' && (!address.trim() || address.trim().length < 4)) {
      setErrorMessage(t('checkout.fillAddressError'));
      return;
    }
    if (deliveryMethod === 'agency' && (!agencyName.trim() || agencyName.trim().length < 2)) {
      setErrorMessage(t('checkout.fillAgencyError'));
      return;
    }

    setIsSubmitting(true);

    const reval = await revalidateCartWithServer(items, {
      wilayaCode: selectedWilayaObj?.code,
      deliveryMethod
    });

    if (!reval.success) {
      setErrorMessage(reval.issues.join(' • '));
      setIsSubmitting(false);
      return;
    }

    if (reval.pricesChanged) {
      updateCartItems(reval.updatedItems);
      setCartNotice(t('checkout.cartPriceChangedReview'));
      setIsSubmitting(false);
      return;
    }

    try {
      const orderPayload = {
        idempotencyKey,
        customer: {
          fullName,
          phone: phone.trim(),
          wilaya: {
            code: selectedWilayaObj.code,
            name: selectedWilayaObj.name
          },
          deliveryMethod,
          agencyName: deliveryMethod === 'agency' ? agencyName.trim() : undefined,
          address: deliveryMethod === 'home' ? address.trim() : undefined,
          notes: notes.trim() || undefined
        },
        items: items.map(item => ({
          productId: item.productId,
          colorName: item.colorName,
          size: item.size,
          quantity: item.quantity
        }))
      };

      const res = await submitCheckout(orderPayload);
      if (res.success) {
        try {
          sessionStorage.removeItem('merya_checkout_idempotency_key');
        } catch {}
        clearCart();
        onOrderSuccess(res);
      } else {
        setErrorMessage(res.message || t('checkout.failedToSaveOrder'));
        setIsSubmitting(false);
      }
    } catch (err) {
      setErrorMessage(err.message || t('checkout.checkoutGenericError'));
      setIsSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="container" style={{ padding: '6rem 1rem', textAlign: 'center' }}>
        <h2 style={{ fontSize: '1.8rem', fontWeight: '700', marginBottom: '1rem', fontFamily: 'var(--font-serif)' }}>
          {t('checkout.emptyCartTitle')}
        </h2>
        <p style={{ color: '#666', marginBottom: '2rem' }}>
          {t('checkout.emptyCartDesc')}
        </p>
        <button onClick={onBack} className="btn btn-primary">
          {t('checkout.returnToShop')}
        </button>
      </div>
    );
  }

  return (
    <div style={{
      paddingTop: '2rem',
      paddingBottom: '6rem',
      backgroundColor: '#FAF8F5',
      minHeight: '100vh',
      overflowX: 'hidden',
      width: '100%',
      boxSizing: 'border-box'
    }}>
      <style>{`
        .checkout-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
          gap: 2.5rem;
          align-items: flex-start;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        }
        .checkout-form-card {
          background-color: #FAF7F2;
          background-image: radial-gradient(circle at 50% 0%, #FFFFFF 0%, #FAF7F2 80%);
          border-radius: 24px;
          border: 1.5px solid #E8E0D5;
          box-shadow: 0 16px 40px rgba(42, 36, 31, 0.07), 0 3px 10px rgba(184, 156, 130, 0.05);
          padding: 2.25rem 2rem 2.5rem 2rem;
          position: relative;
          overflow: hidden;
          box-sizing: border-box;
          max-width: 100%;
        }
        .checkout-summary-card {
          background-color: #FAF7F2;
          border-radius: 24px;
          border: 1.5px solid #E8E0D5;
          box-shadow: 0 12px 32px rgba(42, 36, 31, 0.05);
          padding: 2rem;
          position: sticky;
          top: 90px;
          box-sizing: border-box;
          max-width: 100%;
        }
        .checkout-bow-decor {
          position: absolute;
          top: -31px;
          right: -30px;
          width: 180px;
          height: 180px;
          pointer-events: none;
          z-index: 10;
        }
        .checkout-names-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 1rem;
          width: 100%;
          box-sizing: border-box;
        }
        .checkout-input {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          background: #FFFFFF;
          border: 1.5px solid #E8E2D8;
          border-radius: 9999px;
          padding: 0.72rem 1.25rem;
          font-family: var(--font-sans, inherit);
          font-size: 0.92rem;
          color: #2A241F;
          outline: none;
          transition: all 0.2s ease;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.02);
        }
        .checkout-input:focus {
          border-color: #B89C82;
          background: #FFFFFF;
          box-shadow: 0 0 0 3px rgba(184, 156, 130, 0.15);
        }
        .checkout-textarea {
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
          background: #FFFFFF;
          border: 1.5px solid #E8E2D8;
          border-radius: 18px;
          padding: 0.75rem 1.25rem;
          font-family: var(--font-sans, inherit);
          font-size: 0.92rem;
          color: #2A241F;
          outline: none;
          resize: none;
          transition: all 0.2s ease;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.02);
        }
        .checkout-textarea:focus {
          border-color: #B89C82;
          background: #FFFFFF;
          box-shadow: 0 0 0 3px rgba(184, 156, 130, 0.15);
        }
        .checkout-icon-badge {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: linear-gradient(135deg, #A88D74 0%, #9F8268 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #FFFFFF;
          flex-shrink: 0;
          box-shadow: 0 2px 6px rgba(159, 130, 104, 0.25);
          border: 1.5px solid #F5EFEB;
        }
        @media (max-width: 860px) {
          .checkout-grid {
            grid-template-columns: minmax(0, 1fr) !important;
            gap: 1.5rem !important;
          }
          .checkout-form-card {
            padding: 1.5rem 1rem 2rem 1rem !important;
            border-radius: 18px !important;
          }
          .checkout-summary-card {
            padding: 1.5rem 1rem !important;
            border-radius: 18px !important;
            position: static !important;
            top: auto !important;
          }
          .checkout-bow-decor {
            width: 130px !important;
            height: 130px !important;
            top: -22px !important;
            right: -15px !important;
          }
        }
        @media (max-width: 520px) {
          .checkout-names-row {
            grid-template-columns: minmax(0, 1fr) !important;
          }
        }
      `}</style>

      <div className="container" style={{ maxWidth: '1180px', padding: '0 1rem', boxSizing: 'border-box' }}>
        {/* Back navigation */}
        <button
          onClick={onBack}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.85rem',
            fontWeight: '600',
            color: 'var(--color-espresso)',
            marginBottom: '1.5rem',
            padding: '0.45rem 0.9rem',
            borderRadius: '9999px',
            backgroundColor: '#FFFFFF',
            border: '1px solid #E8E2D8',
            cursor: 'pointer'
          }}
        >
          <ArrowLeft size={15} className="rtl-flip" />
          {t('checkout.backToCart')}
        </button>

        <div className="checkout-grid">
          {/* LEFT: THE LUXURY ORDER FORM CARD */}
          <div style={{ position: 'relative', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>

            {/* BOW: sits physically ON TOP of the card's top corner */}
            <div className="checkout-bow-decor" style={{
              [isRtl ? 'left' : 'right']: isRtl ? '-30px' : '-30px',
              transform: isRtl ? 'scaleX(-1)' : 'none'
            }}>
              <img
                src="/decor_corner_bow.png"
                alt=""
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  objectPosition: 'center',
                  filter: 'drop-shadow(0 4px 12px rgba(42, 36, 31, 0.18))'
                }}
              />
            </div>

            <div className="checkout-form-card">
              {/* Top draped silk & natural flowers */}
              <div style={{
                position: 'absolute',
                top: '-15px',
                [isRtl ? 'right' : 'left']: '-15px',
                width: '230px',
                height: '230px',
                pointerEvents: 'none',
                zIndex: 1,
                opacity: 0.88,
                mixBlendMode: 'multiply',
                WebkitMaskImage: `radial-gradient(circle at ${isRtl ? '75% 25%' : '25% 25%'}, black 45%, transparent 80%)`,
                maskImage: `radial-gradient(circle at ${isRtl ? '75% 25%' : '25% 25%'}, black 45%, transparent 80%)`,
                transform: isRtl ? 'scaleX(-1)' : 'none'
              }}>
                <img
                  src="/decor_silk_flowers.jpg"
                  alt=""
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    transform: 'rotate(-5deg)'
                  }}
                />
              </div>

              {/* BRANDING HEADER */}
              <div style={{
                textAlign: 'center',
                position: 'relative',
                zIndex: 2,
                marginBottom: '1.4rem',
                paddingTop: '0.5rem'
              }}>
                <div style={{ display: 'inline-block', marginBottom: '0.2rem' }}>
                  <img
                    src="/logo.png?v=2"
                    alt="MERYA DZ"
                    style={{
                      height: '52px',
                      width: 'auto',
                      objectFit: 'contain',
                      filter: 'drop-shadow(0 2px 4px rgba(184, 156, 130, 0.2))'
                    }}
                  />
                </div>

                <h2 style={{
                  fontFamily: "var(--font-serif, 'Cormorant Garamond', Georgia, serif)",
                  fontSize: '1.65rem',
                  fontWeight: '600',
                  letterSpacing: '0.22em',
                  textTransform: 'uppercase',
                  color: '#2A241F',
                  margin: '0 0 0.2rem 0'
                }}>
                  MERYA DZ
                </h2>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.6rem',
                  fontSize: '0.66rem',
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color: '#9F8268',
                  fontWeight: '600'
                }}>
                  <span>{t('checkout.modest')}</span>
                  <span style={{ color: '#B89C82', fontSize: '0.55rem' }}>♥</span>
                  <span>{t('checkout.elegant')}</span>
                  <span style={{ color: '#B89C82', fontSize: '0.55rem' }}>♥</span>
                  <span>{t('checkout.timeless')}</span>
                </div>
              </div>

              {/* ENVOYER VOS INFORMATIONS BANNER */}
              <div style={{
                position: 'relative',
                zIndex: 2,
                background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(246, 240, 235, 0.9) 100%)',
                border: '1.5px solid #DFD5C6',
                borderRadius: '18px',
                padding: '1.1rem 1.4rem',
                textAlign: 'center',
                boxShadow: '0 4px 16px rgba(184, 156, 130, 0.1)',
                marginBottom: '1.75rem'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '1rem',
                  marginBottom: '0.5rem'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: '#FAF8F5',
                    border: '1.5px solid #DFD5C6',
                    color: '#9F8268'
                  }}>
                    <ClipboardList size={20} />
                  </div>

                  <div style={{ height: '28px', width: '1.5px', backgroundColor: '#DFD5C6' }}></div>

                  <div style={{ textAlign: isRtl ? 'right' : 'left' }}>
                    <span style={{
                      fontFamily: 'var(--font-sans, inherit)',
                      fontSize: '0.92rem',
                      fontWeight: '700',
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      color: '#2A241F',
                      display: 'inline-block',
                      marginInlineEnd: '0.45rem'
                    }}>
                      {t('checkout.sendInfoBanner')}
                    </span>
                    <span style={{
                      fontFamily: isRtl ? 'inherit' : "'Alex Brush', cursive",
                      fontSize: isRtl ? '1.1rem' : '1.85rem',
                      color: '#9F8268',
                      fontWeight: isRtl ? '700' : '400',
                      lineHeight: 0.9,
                      verticalAlign: 'middle'
                    }}>
                      {t('checkout.sendInfoCursive')}
                    </span>
                  </div>
                </div>

                <p style={{
                  fontFamily: 'var(--font-sans, inherit)',
                  fontSize: '0.68rem',
                  fontWeight: '600',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: '#766657',
                  lineHeight: 1.4,
                  margin: '0 auto 0.35rem auto'
                }}>
                  {t('checkout.fillInfoSubtitle')}
                </p>

                <div style={{ color: '#9F8268', fontSize: '0.7rem' }}>
                  ♥
                </div>
              </div>

              {/* Delivery Settings Error with Retry Button */}
              {Boolean(settingsError) && (
                <div style={{
                  backgroundColor: '#FEF2F2',
                  border: '1.5px solid #FCA5A5',
                  color: '#991B1B',
                  padding: '0.9rem 1.1rem',
                  borderRadius: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  marginBottom: '1.25rem',
                  position: 'relative',
                  zIndex: 2
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.84rem' }}>
                    <AlertCircle size={18} flexShrink={0} />
                    <span>{settingsError || t('checkout.deliverySettingsError')}</span>
                  </div>
                  <button
                    type="button"
                    onClick={loadSettings}
                    style={{
                      padding: '0.4rem 0.85rem',
                      borderRadius: '9999px',
                      border: '1.5px solid #991B1B',
                      backgroundColor: '#FFFFFF',
                      color: '#991B1B',
                      fontSize: '0.78rem',
                      fontWeight: '700',
                      cursor: 'pointer',
                      flexShrink: 0
                    }}
                  >
                    {t('checkout.retry')}
                  </button>
                </div>
              )}

              {/* Price update notice banner */}
              {cartNotice && (
                <div style={{
                  backgroundColor: '#FEF3C7',
                  border: '1.5px solid #F59E0B',
                  color: '#92400E',
                  padding: '0.9rem 1.1rem',
                  borderRadius: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginBottom: '1.25rem',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  lineHeight: 1.4,
                  position: 'relative',
                  zIndex: 2
                }}>
                  <AlertCircle size={20} flexShrink={0} color="#D97706" />
                  <div style={{ flex: 1 }}>{cartNotice}</div>
                </div>
              )}

              {/* Error banner if any form error */}
              {errorMessage && (
                <div style={{
                  backgroundColor: '#FFEBEE',
                  border: '1px solid #FFCDD2',
                  color: 'var(--color-danger)',
                  padding: '0.85rem 1rem',
                  borderRadius: '14px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.65rem',
                  fontSize: '0.84rem',
                  marginBottom: '1.25rem',
                  position: 'relative',
                  zIndex: 2
                }}>
                  <AlertCircle size={17} flexShrink={0} />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* FORM FIELDS */}
              <form onSubmit={handleSubmitOrder} style={{ position: 'relative', zIndex: 2 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}>
                  {/* Row 1 & 2: Nom & Prénom */}
                  <div className="checkout-names-row">
                    {/* Nom */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                      <div className="checkout-icon-badge">
                        <User size={16} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#2A241F', marginBottom: '0.25rem' }}>
                          {t('checkout.lastName')} : <span style={{ color: '#A86450' }}>*</span>
                        </label>
                        <input
                          type="text"
                          required
                          placeholder={t('checkout.lastNamePlaceholder')}
                          value={nom}
                          onChange={(e) => setNom(e.target.value)}
                          className="checkout-input"
                        />
                      </div>
                    </div>

                    {/* Prénom */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                      <div className="checkout-icon-badge">
                        <User size={16} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#2A241F', marginBottom: '0.25rem' }}>
                          {t('checkout.firstName')} : <span style={{ color: '#A86450' }}>*</span>
                        </label>
                        <input
                          type="text"
                          required
                          placeholder={t('checkout.firstNamePlaceholder')}
                          value={prenom}
                          onChange={(e) => setPrenom(e.target.value)}
                          className="checkout-input"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Row 3: Wilaya (Canonical 58 Wilayas strictly loaded from server) */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    <div className="checkout-icon-badge">
                      <MapPin size={16} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#2A241F', marginBottom: '0.25rem' }}>
                        {t('checkout.wilayaLabel')} : <span style={{ color: '#A86450' }}>*</span>
                      </label>
                      {loadingSettings ? (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.72rem 1.25rem',
                          borderRadius: '9999px',
                          border: '1.5px solid #E8E2D8',
                          backgroundColor: '#F5EFEB',
                          color: '#766657',
                          fontSize: '0.88rem'
                        }}>
                          <Loader2 size={16} className="animate-spin" />
                          <span>{t('checkout.loadingWilayas')}</span>
                        </div>
                      ) : (
                        <select
                          value={selectedWilayaCode || ''}
                          disabled={loadingSettings || Boolean(settingsError) || wilayas.length === 0}
                          onChange={(e) => setSelectedWilayaCode(Number(e.target.value))}
                          className="checkout-input"
                          style={{ cursor: isSettingsReady ? 'pointer' : 'not-allowed', fontWeight: '600' }}
                        >
                          {wilayas.length === 0 ? (
                            <option value="">{t('checkout.wilayasUnavailable')}</option>
                          ) : (
                            wilayas.map((w) => (
                              <option key={w.code} value={w.code} disabled={!w.isAvailable}>
                                {getWilayaDisplayName(w)} {!w.isAvailable ? `— [${t('checkout.wilayaNotServed')}]` : ''}
                              </option>
                            ))
                          )}
                        </select>
                      )}

                      {/* Warning if selected Wilaya is disabled / unavailable */}
                      {selectedWilayaObj && !selectedWilayaObj.isAvailable && (
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          marginTop: '0.4rem',
                          fontSize: '0.8rem',
                          color: '#B91C1C'
                        }}>
                          <AlertCircle size={14} flexShrink={0} />
                          <span>{t('checkout.wilayaSuspended')}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Row 4: Numéro de téléphone */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    <div className="checkout-icon-badge">
                      <Phone size={16} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#2A241F', marginBottom: '0.25rem' }}>
                        {t('checkout.phoneLabel')} : <span style={{ color: '#A86450' }}>*</span>
                      </label>
                      <input
                        type="tel"
                        required
                        placeholder={t('checkout.phonePlaceholder')}
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="checkout-input"
                      />
                    </div>
                  </div>

                  {/* Row 5: Envoi à domicile ou au bureau */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
                    <div className="checkout-icon-badge" style={{ marginTop: '0.2rem' }}>
                      <HomeIcon size={16} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#2A241F', marginBottom: '0.35rem' }}>
                        {t('checkout.deliveryMethodLabel')}
                      </label>
                      <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          disabled={!isSettingsReady}
                          onClick={() => setDeliveryMethod('home')}
                          style={{
                            flex: '1 1 150px',
                            padding: '0.65rem 1rem',
                            borderRadius: '9999px',
                            border: deliveryMethod === 'home' ? '2px solid #9F8268' : '1.5px solid #E8E2D8',
                            backgroundColor: deliveryMethod === 'home' ? '#F5EFEB' : '#FFFFFF',
                            color: deliveryMethod === 'home' ? '#2A241F' : '#666',
                            fontWeight: deliveryMethod === 'home' ? '700' : '500',
                            fontSize: '0.84rem',
                            cursor: isSettingsReady ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.4rem',
                            transition: 'all 0.2s ease',
                            opacity: isSettingsReady ? 1 : 0.6
                          }}
                        >
                          <span>
                            {t('checkout.homeDelivery')} {selectedWilayaObj ? (isFreeDelivery ? `(${t('checkout.freeDeliveryBadge')})` : `(+${formatCurrency(selectedWilayaObj.homeFee)})`) : (loadingSettings ? `(${t('checkout.calculating')})` : '')}
                          </span>
                        </button>

                        <button
                          type="button"
                          disabled={!isSettingsReady}
                          onClick={() => setDeliveryMethod('agency')}
                          style={{
                            flex: '1 1 150px',
                            padding: '0.65rem 1rem',
                            borderRadius: '9999px',
                            border: deliveryMethod === 'agency' ? '2px solid #9F8268' : '1.5px solid #E8E2D8',
                            backgroundColor: deliveryMethod === 'agency' ? '#F5EFEB' : '#FFFFFF',
                            color: deliveryMethod === 'agency' ? '#2A241F' : '#666',
                            fontWeight: deliveryMethod === 'agency' ? '700' : '500',
                            fontSize: '0.84rem',
                            cursor: isSettingsReady ? 'pointer' : 'not-allowed',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '0.4rem',
                            transition: 'all 0.2s ease',
                            opacity: isSettingsReady ? 1 : 0.6
                          }}
                        >
                          <span>
                            {t('checkout.agencyDelivery')} {selectedWilayaObj ? (isFreeDelivery ? `(${t('checkout.freeDeliveryBadge')})` : `(+${formatCurrency(selectedWilayaObj.agencyFee)})`) : (loadingSettings ? `(${t('checkout.calculating')})` : '')}
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Address input — only shown for home delivery */}
                  {deliveryMethod === 'home' && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
                      <div className="checkout-icon-badge" style={{ marginTop: '0.2rem' }}>
                        <MapPin size={16} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#2A241F', marginBottom: '0.25rem' }}>
                          {t('checkout.homeAddressLabel')} : <span style={{ color: '#A86450' }}>*</span>
                        </label>
                        <input
                          type="text"
                          required
                          placeholder={t('checkout.homeAddressPlaceholder')}
                          value={address}
                          onChange={(e) => setAddress(e.target.value)}
                          className="checkout-input"
                        />
                      </div>
                    </div>
                  )}

                  {/* Agency / Bureau name input — only shown for agency delivery */}
                  {deliveryMethod === 'agency' && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
                      <div className="checkout-icon-badge" style={{ marginTop: '0.2rem' }}>
                        <Building2 size={16} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#2A241F', marginBottom: '0.25rem' }}>
                          {t('checkout.agencyNameLabel')} : <span style={{ color: '#A86450' }}>*</span>
                        </label>
                        <input
                          type="text"
                          required
                          placeholder={t('checkout.agencyNamePlaceholder')}
                          value={agencyName}
                          onChange={(e) => setAgencyName(e.target.value)}
                          className="checkout-input"
                        />
                      </div>
                    </div>
                  )}

                  {/* Row 6: Autres informations (si besoin) */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
                    <div className="checkout-icon-badge" style={{ marginTop: '0.2rem' }}>
                      <FileText size={16} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#2A241F', marginBottom: '0.25rem' }}>
                        {t('checkout.notesLabel')} :
                      </label>
                      <textarea
                        rows={2}
                        placeholder={t('checkout.notesPlaceholder')}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="checkout-textarea"
                      />
                    </div>
                  </div>

                  {/* Confirm Order Button */}
                  <div style={{ marginTop: '0.75rem' }}>
                    <button
                      type="submit"
                      disabled={isSubmitDisabled}
                      style={{
                        width: '100%',
                        padding: '1rem 1.5rem',
                        borderRadius: '9999px',
                        background: isSubmitDisabled
                          ? '#C9BEB2'
                          : 'linear-gradient(135deg, #A88D74 0%, #9F8268 100%)',
                        color: '#FFFFFF',
                        border: 'none',
                        fontSize: '0.98rem',
                        fontWeight: '700',
                        letterSpacing: '0.04em',
                        cursor: isSubmitDisabled ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.65rem',
                        boxShadow: isSubmitDisabled ? 'none' : '0 6px 18px rgba(159, 130, 104, 0.35)',
                        transition: 'all 0.2s ease',
                        opacity: isSubmitDisabled && !isSubmitting ? 0.75 : 1
                      }}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 size={19} className="animate-spin" />
                          <span>{t('checkout.confirmingOrder')}</span>
                        </>
                      ) : loadingSettings ? (
                        <>
                          <Loader2 size={19} className="animate-spin" />
                          <span>{t('checkout.loadingRates')}</span>
                        </>
                      ) : Boolean(settingsError) ? (
                        <>
                          <AlertCircle size={19} />
                          <span>{t('checkout.ratesUnavailable')}</span>
                        </>
                      ) : (selectedWilayaObj && !selectedWilayaObj.isAvailable) ? (
                        <>
                          <AlertCircle size={19} />
                          <span>{t('checkout.wilayaNotServed')}</span>
                        </>
                      ) : liveQuoteLoading ? (
                        <>
                          <Loader2 size={19} className="animate-spin" />
                          <span>{t('checkout.calculatingQuote')}</span>
                        </>
                      ) : !hasValidLiveQuote ? (
                        <>
                          <AlertCircle size={19} />
                          <span>{t('checkout.verificationRequired')}</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={19} />
                          <span>
                            {t('checkout.confirmOrder')} {displayTotal !== null ? `(${formatCurrency(displayTotal)})` : ''}
                          </span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </form>

              {/* CARD FOOTER FLOURISH */}
              <div style={{
                marginTop: '2.25rem',
                position: 'relative',
                zIndex: 2,
                textAlign: 'center'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.85rem',
                  margin: '0 auto 0.75rem auto',
                  maxWidth: '300px'
                }}>
                  <div style={{ flex: 1, height: '1px', backgroundColor: '#DFD5C6' }}></div>
                  <span style={{ color: '#9F8268', fontSize: '0.85rem' }}>♥</span>
                  <div style={{ flex: 1, height: '1px', backgroundColor: '#DFD5C6' }}></div>
                </div>

                <div style={{
                  fontFamily: isRtl ? 'inherit' : "'Alex Brush', cursive",
                  fontSize: isRtl ? '1.8rem' : '2.3rem',
                  fontWeight: isRtl ? '700' : '400',
                  color: '#9F8268',
                  lineHeight: 1,
                  marginBottom: '0.15rem'
                }}>
                  {t('checkout.thankYou')} ♥
                </div>

                <div style={{
                  fontFamily: 'var(--font-sans, inherit)',
                  fontSize: '0.7rem',
                  fontWeight: '700',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: '#766657'
                }}>
                  {t('checkout.forYourTrust')}
                </div>

                {/* Bottom sprig */}
                <div style={{
                  position: 'absolute',
                  bottom: '-12px',
                  [isRtl ? 'left' : 'right']: '-10px',
                  width: '160px',
                  height: '160px',
                  pointerEvents: 'none',
                  zIndex: 1,
                  opacity: 0.75,
                  mixBlendMode: 'multiply',
                  WebkitMaskImage: `radial-gradient(circle at ${isRtl ? '40% 60%' : '60% 60%'}, black 40%, transparent 80%)`,
                  maskImage: `radial-gradient(circle at ${isRtl ? '40% 60%' : '60% 60%'}, black 40%, transparent 80%)`,
                  transform: isRtl ? 'scaleX(-1)' : 'none'
                }}>
                  <img
                    src="/decor_flowers_bottom.jpg"
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      transform: 'rotate(10deg)'
                    }}
                  />
                </div>

                <div style={{
                  position: 'absolute',
                  bottom: '-6px',
                  [isRtl ? 'left' : 'right']: '8px',
                  textAlign: isRtl ? 'left' : 'right',
                  pointerEvents: 'none',
                  zIndex: 2
                }} className="desktop-only">
                  <div style={{
                    fontFamily: isRtl ? 'inherit' : "'Alex Brush', cursive",
                    fontSize: isRtl ? '1.1rem' : '1.45rem',
                    fontWeight: isRtl ? '700' : '400',
                    color: '#8A715C',
                    lineHeight: 1,
                    transform: isRtl ? 'none' : 'rotate(-4deg)'
                  }}>
                    {t('checkout.alwaysCloser')}
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: isRtl ? 'flex-start' : 'flex-end',
                    gap: '3px',
                    marginTop: '1px',
                    color: '#B89C82'
                  }}>
                    <span style={{ height: '1px', width: '22px', backgroundColor: '#DFD5C6' }}></span>
                    <span style={{ fontSize: '0.75rem' }}>♡</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: ORDER SUMMARY (Luxury matching style) */}
          <div className="checkout-summary-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid #E8E0D5', paddingBottom: '0.85rem' }}>
              <h3 style={{
                fontSize: '0.92rem',
                fontWeight: '700',
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                color: '#2A241F'
              }}>
                {t('checkout.summaryTitle')} ({items.length} {items.length === 1 ? t('checkout.articleSingular') : t('checkout.articlePlural')})
              </h3>
              <span style={{ fontSize: '0.78rem', color: '#9F8268', fontWeight: '600' }}>
                {t('checkout.codBadge')}
              </span>
            </div>

            {/* Item list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', marginBottom: '1.5rem', maxHeight: '340px', overflowY: 'auto', paddingRight: '0.25rem' }}>
              {items.map((item) => (
                <div
                  key={`${item.productId}-${item.colorName}-${item.size}`}
                  style={{
                    display: 'flex',
                    gap: '0.85rem',
                    alignItems: 'center',
                    padding: '0.65rem',
                    backgroundColor: '#FFFFFF',
                    borderRadius: '14px',
                    border: '1px solid #EDE7DF'
                  }}
                >
                  <img
                    src={item.image || '/logo.png'}
                    alt={item.productName || 'Article'}
                    onError={(e) => {
                      e.currentTarget.onerror = null;
                      e.currentTarget.src = '/logo.png';
                      e.currentTarget.style.objectFit = 'contain';
                      e.currentTarget.style.padding = '6px';
                    }}
                    style={{
                      width: '54px',
                      height: '68px',
                      borderRadius: '8px',
                      objectFit: 'cover',
                      backgroundColor: '#F5EFEB',
                      flexShrink: 0
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: '700', color: '#2A241F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {localized(item.productName)}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#777', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem', flexWrap: 'wrap' }}>
                      <span style={{
                        display: 'inline-block',
                        padding: '0.15rem 0.5rem',
                        backgroundColor: '#F5EFEB',
                        borderRadius: '9999px',
                        color: '#9F8268',
                        fontWeight: '600'
                      }}>
                        {item.colorName}
                      </span>
                      <span>• {t('checkout.sizeLabel')} {item.size}</span>
                      <span>• {t('checkout.qtyLabel')} {item.quantity}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: isRtl ? 'left' : 'right', flexShrink: 0 }}>
                    <div style={{
                      fontSize: '0.92rem',
                      fontWeight: '700',
                      color: (item.originalPrice && item.originalPrice > item.unitPrice) ? '#DC2626' : '#2A241F'
                    }}>
                      {formatCurrency(item.unitPrice * item.quantity)}
                    </div>
                    {item.originalPrice && item.originalPrice > item.unitPrice && (
                      <div style={{ fontSize: '0.75rem', color: '#999', textDecoration: 'line-through' }}>
                        {formatCurrency(item.originalPrice * item.quantity)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Financial breakdown */}
            <div style={{
              borderTop: '1px solid #E8E0D5',
              paddingTop: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            }}>
              {liveQuoteError && !liveQuoteLoading && (
                <div style={{
                  fontSize: '0.78rem',
                  color: '#DC2626',
                  backgroundColor: '#FEF2F2',
                  border: '1px solid #FECACA',
                  borderRadius: '10px',
                  padding: '0.55rem 0.75rem',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.45rem',
                  lineHeight: '1.4'
                }}>
                  <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                  <span>{liveQuoteError}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#666' }}>
                <span>{t('checkout.articlesSubtotal')}</span>
                <span style={{ fontWeight: '600', color: '#2A241F' }}>
                  {liveQuoteLoading ? (
                    <span style={{ fontSize: '0.8rem', color: '#9F8268' }}>{t('checkout.calculating')}</span>
                  ) : displaySubtotal !== null ? (
                    formatCurrency(displaySubtotal)
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: '#DC2626' }}>{t('checkout.unavailable')}</span>
                  )}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#666' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Truck size={15} color="#9F8268" />
                  {t('checkout.deliveryLabel')} ({deliveryMethod === 'agency' ? t('checkout.agency') : t('checkout.home')} {selectedWilayaObj ? `- ${selectedWilayaObj.code}` : ''})
                </span>
                <span style={{ fontWeight: '600', color: displayIsFreeDelivery ? '#16A34A' : '#2A241F' }}>
                  {loadingSettings || liveQuoteLoading ? (
                    <span style={{ fontSize: '0.8rem', color: '#9F8268' }}>{t('checkout.calculating')}</span>
                  ) : settingsError ? (
                    <span style={{ fontSize: '0.8rem', color: '#DC2626' }}>{t('checkout.unavailable')}</span>
                  ) : displayDeliveryFee !== null ? (
                    displayIsFreeDelivery ? (
                      <span style={{ color: '#16A34A', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                        <span>{t('checkout.freeDeliveryBadge')}</span>
                        {displayRawFee !== null && (
                          <span style={{ fontSize: '0.75rem', textDecoration: 'line-through', color: '#999', fontWeight: '400' }}>
                            +{formatCurrency(displayRawFee)}
                          </span>
                        )}
                      </span>
                    ) : (
                      `+${formatCurrency(displayDeliveryFee)}`
                    )
                  ) : (
                    <span style={{ fontSize: '0.8rem', color: '#DC2626' }}>{t('checkout.unavailable')}</span>
                  )}
                </span>
              </div>

              {/* Free delivery badge or threshold hint */}
              {displayIsFreeDelivery && (
                <div style={{
                  fontSize: '0.78rem',
                  color: '#16A34A',
                  backgroundColor: '#F0FDF4',
                  border: '1px solid #BBF7D0',
                  borderRadius: '10px',
                  padding: '0.45rem 0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontWeight: '600'
                }}>
                  <span>🎁</span>
                  <span>{t('checkout.freeDeliveryApplied', { threshold: formatCurrency(displayFreeThreshold) })}</span>
                </div>
              )}

              {!displayIsFreeDelivery && displayFreeThreshold > 0 && displaySubtotal !== null && displaySubtotal < displayFreeThreshold && isSettingsReady && (
                <div style={{
                  fontSize: '0.76rem',
                  color: '#9F8268',
                  backgroundColor: '#FAF5EE',
                  border: '1px solid #EFE4D6',
                  borderRadius: '10px',
                  padding: '0.45rem 0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}>
                  <span>💡</span>
                  <span>
                    {t('checkout.moreForFreeDelivery', { amount: formatCurrency(displayFreeThreshold - displaySubtotal) })}
                  </span>
                </div>
              )}

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                fontSize: '1.25rem',
                fontWeight: '800',
                color: '#2A241F',
                borderTop: '1.5px dashed #DFD5C6',
                paddingTop: '0.85rem',
                marginTop: '0.25rem'
              }}>
                <span>{t('checkout.totalToPayCod')}</span>
                <span style={{ color: '#9F8268', fontSize: '1.35rem' }}>
                  {liveQuoteLoading ? (
                    <span style={{ fontSize: '0.95rem', color: '#9F8268', fontWeight: '600' }}>{t('checkout.calculating')}</span>
                  ) : displayTotal !== null ? (
                    formatCurrency(displayTotal)
                  ) : (
                    <span style={{ fontSize: '0.95rem', color: '#DC2626', fontWeight: '600' }}>{t('checkout.unavailable')}</span>
                  )}
                </span>
              </div>
            </div>

            {/* COD Trust Note */}
            <div style={{
              marginTop: '1.5rem',
              padding: '0.9rem 1rem',
              backgroundColor: '#FFFFFF',
              borderRadius: '14px',
              border: '1px solid #EDE7DF',
              fontSize: '0.78rem',
              color: '#666',
              lineHeight: 1.5,
              display: 'flex',
              gap: '0.65rem',
              alignItems: 'flex-start'
            }}>
              <ShieldCheck size={20} color="#9F8268" flexShrink={0} style={{ marginTop: '2px' }} />
              <div>
                <strong style={{ color: '#2A241F' }}>{t('checkout.codGuaranteeTitle')}</strong> {t('checkout.codGuaranteeDesc')}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
