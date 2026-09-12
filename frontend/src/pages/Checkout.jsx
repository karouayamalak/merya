import React, { useState, useEffect } from 'react';
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

// Helper to strictly validate the server's 58-Wilaya delivery configuration
function validateDeliverySettingsResponse(data) {
  if (!data || !data.success) {
    return { valid: false, error: data?.message || 'Impossible de récupérer les paramètres de livraison du serveur.' };
  }

  const rawWilayas = data.wilayas || data.settings?.wilayaRates;
  if (!Array.isArray(rawWilayas)) {
    return { valid: false, error: 'Format de réponse invalide : liste des wilayas manquante.' };
  }

  if (rawWilayas.length !== 58) {
    return {
      valid: false,
      error: `Configuration des tarifs invalide : exactement 58 wilayas requises (${rawWilayas.length} reçues).`
    };
  }

  const seenCodes = new Set();
  const validatedWilayas = [];

  for (let i = 0; i < rawWilayas.length; i++) {
    const w = rawWilayas[i];
    if (!w || typeof w !== 'object') {
      return { valid: false, error: `Données de wilaya invalides à l'index ${i}.` };
    }

    const code = Number(w.wilayaCode !== undefined ? w.wilayaCode : w.code);
    if (!Number.isInteger(code) || code < 1 || code > 58) {
      return { valid: false, error: `Code de wilaya invalide : ${code} (attendu : entier entre 1 et 58).` };
    }

    if (seenCodes.has(code)) {
      return { valid: false, error: `Code de wilaya dupliqué : ${code}. Chaque wilaya doit être unique.` };
    }
    seenCodes.add(code);

    const name = String(w.wilayaName || w.name || '').trim();
    if (!name) {
      return { valid: false, error: `Nom canonique manquant pour la wilaya ${code}.` };
    }

    const homeFee = Number(w.homeFee);
    if (!Number.isFinite(homeFee) || !Number.isInteger(homeFee) || homeFee < 0) {
      return { valid: false, error: `Tarif de livraison à domicile invalide pour la wilaya ${code} (${name}).` };
    }

    const agencyFee = Number(w.agencyFee);
    if (!Number.isFinite(agencyFee) || !Number.isInteger(agencyFee) || agencyFee < 0) {
      return { valid: false, error: `Tarif de livraison en bureau / stopdesk invalide pour la wilaya ${code} (${name}).` };
    }

    validatedWilayas.push({
      code,
      wilayaCode: code,
      name,
      wilayaName: name,
      nameAr: String(w.wilayaNameAr || w.nameAr || '').trim(),
      wilayaNameAr: String(w.wilayaNameAr || w.nameAr || '').trim(),
      homeFee,
      agencyFee,
      isAvailable: w.isAvailable !== false
    });
  }

  // Ensure all codes 1–58 are present
  for (let c = 1; c <= 58; c++) {
    if (!seenCodes.has(c)) {
      return { valid: false, error: `Wilaya manquante : code ${c} absent de la configuration.` };
    }
  }

  validatedWilayas.sort((a, b) => a.code - b.code);

  return {
    valid: true,
    wilayas: validatedWilayas,
    settings: data.settings || {}
  };
}

export default function Checkout({ onBack, onOrderSuccess }) {
  const { items, subtotal, clearCart } = useCart();

  // Explicit delivery status: 'loading' | 'loaded' | 'failed'
  const [deliveryStatus, setDeliveryStatus] = useState('loading');
  const [deliveryErrorMessage, setDeliveryErrorMessage] = useState('');
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

  // Submitting & Double-click protection
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

  const loadSettings = async () => {
    setDeliveryStatus('loading');
    setDeliveryErrorMessage('');
    try {
      const res = await fetchDeliverySettings();
      const validation = validateDeliverySettingsResponse(res);
      if (!validation.valid) {
        setDeliveryStatus('failed');
        setDeliveryErrorMessage(validation.error || 'Impossible de charger les informations de livraison. Veuillez réessayer.');
        setWilayas([]);
        setDeliverySettings(null);
        setSelectedWilayaCode(null);
      } else {
        setWilayas(validation.wilayas);
        setDeliverySettings(validation.settings);
        setDeliveryStatus('loaded');

        // Select Wilaya 16 (Alger) if available, otherwise pick first available canonical Wilaya
        const wilaya16 = validation.wilayas.find(w => w.code === 16 && w.isAvailable);
        if (wilaya16) {
          setSelectedWilayaCode(16);
        } else {
          const firstAvailable = validation.wilayas.find(w => w.isAvailable);
          setSelectedWilayaCode(firstAvailable ? firstAvailable.code : validation.wilayas[0]?.code || null);
        }
      }
    } catch (err) {
      setDeliveryStatus('failed');
      setDeliveryErrorMessage('Impossible de charger les informations de livraison. Veuillez réessayer.');
      setWilayas([]);
      setDeliverySettings(null);
      setSelectedWilayaCode(null);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  // Look up selected Wilaya strictly from validated server data — NO hardcoded fallback values
  const selectedWilayaObj = (deliveryStatus === 'loaded' && selectedWilayaCode !== null && wilayas.length === 58)
    ? (wilayas.find(w => w.code === Number(selectedWilayaCode)) || null)
    : null;

  const isSettingsReady = deliveryStatus === 'loaded' && wilayas.length === 58 && selectedWilayaObj !== null;
  const isWilayaAvailable = selectedWilayaObj ? selectedWilayaObj.isAvailable : false;

  // Derive fee strictly from server configuration
  const activeDeliveryFee = (isSettingsReady && isWilayaAvailable)
    ? (deliveryMethod === 'agency' ? selectedWilayaObj.agencyFee : selectedWilayaObj.homeFee)
    : null;

  const estimatedTotal = activeDeliveryFee !== null ? subtotal + activeDeliveryFee : null;

  const isSubmitDisabled =
    isSubmitting ||
    deliveryStatus !== 'loaded' ||
    !isSettingsReady ||
    !isWilayaAvailable ||
    items.length === 0;

  const handleSubmitOrder = async (e) => {
    e.preventDefault();
    setErrorMessage('');

    if (deliveryStatus === 'loading') {
      setErrorMessage('Veuillez patienter pendant le chargement des tarifs de livraison.');
      return;
    }
    if (deliveryStatus === 'failed' || !isSettingsReady || !selectedWilayaObj) {
      setErrorMessage('Impossible de passer la commande : tarifs de livraison indisponibles. Veuillez réessayer.');
      return;
    }
    if (!selectedWilayaObj.isAvailable) {
      setErrorMessage(`La livraison n'est actuellement pas disponible pour la wilaya de ${selectedWilayaObj.name}.`);
      return;
    }

    const fullName = `${nom} ${prenom}`.trim();
    if (!fullName) {
      setErrorMessage('Veuillez renseigner votre nom et prénom.');
      return;
    }
    if (!phone.trim() || phone.trim().length < 8) {
      setErrorMessage('Veuillez renseigner un numéro de téléphone algérien valide (au moins 8 chiffres).');
      return;
    }
    if (deliveryMethod === 'home' && (!address.trim() || address.trim().length < 4)) {
      setErrorMessage('Veuillez indiquer une adresse complète pour la livraison à domicile.');
      return;
    }
    if (deliveryMethod === 'agency' && (!agencyName.trim() || agencyName.trim().length < 2)) {
      setErrorMessage('Veuillez préciser le nom du bureau / agence de retrait (ex: Yalidine Kouba).');
      return;
    }

    setIsSubmitting(true);

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
        clearCart();
        onOrderSuccess(res);
      } else {
        setErrorMessage(res.message || 'Impossible d\'enregistrer la commande.');
        setIsSubmitting(false);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Une erreur est survenue lors de l\'envoi de la commande.');
      setIsSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="container" style={{ padding: '6rem 1rem', textAlign: 'center' }}>
        <h2 style={{ fontSize: '1.8rem', fontWeight: '700', marginBottom: '1rem', fontFamily: 'var(--font-serif)' }}>
          Votre panier est vide
        </h2>
        <p style={{ color: '#666', marginBottom: '2rem' }}>
          Veuillez sélectionner des articles de notre collection avant de finaliser votre commande.
        </p>
        <button onClick={onBack} className="btn btn-primary">
          Retourner à la boutique
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
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
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
          grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
          gap: 1rem;
          width: 100%;
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
        @media (max-width: 768px) {
          .checkout-grid {
            grid-template-columns: 1fr !important;
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
          .checkout-names-row {
            grid-template-columns: 1fr !important;
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
          <ArrowLeft size={15} />
          Retour au panier
        </button>

        <div className="checkout-grid">
          {/* LEFT: THE LUXURY ORDER FORM CARD */}
          <div style={{ position: 'relative', width: '100%', maxWidth: '100%', boxSizing: 'border-box' }}>

            {/* BOW: sits physically ON TOP of the card's top-right corner */}
            <div className="checkout-bow-decor">
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
              {/* Top-left draped silk & natural flowers */}
              <div style={{
                position: 'absolute',
                top: '-15px',
                left: '-15px',
                width: '230px',
                height: '230px',
                pointerEvents: 'none',
                zIndex: 1,
                opacity: 0.88,
                mixBlendMode: 'multiply',
                WebkitMaskImage: 'radial-gradient(circle at 25% 25%, black 45%, transparent 80%)',
                maskImage: 'radial-gradient(circle at 25% 25%, black 45%, transparent 80%)'
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
                  <span>MODEST</span>
                  <span style={{ color: '#B89C82', fontSize: '0.55rem' }}>♥</span>
                  <span>ÉLÉGANT</span>
                  <span style={{ color: '#B89C82', fontSize: '0.55rem' }}>♥</span>
                  <span>TIMELESS</span>
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

                  <div style={{ textAlign: 'left' }}>
                    <span style={{
                      fontFamily: 'var(--font-sans, inherit)',
                      fontSize: '0.92rem',
                      fontWeight: '700',
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      color: '#2A241F',
                      display: 'inline-block',
                      marginRight: '0.45rem'
                    }}>
                      ENVOYER VOS
                    </span>
                    <span style={{
                      fontFamily: "'Alex Brush', cursive",
                      fontSize: '1.85rem',
                      color: '#9F8268',
                      fontWeight: '400',
                      lineHeight: 0.9,
                      verticalAlign: 'middle'
                    }}>
                      informations
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
                  POUR FINALISER VOTRE COMMANDE, MERCI DE BIEN VOULOIR RENSEIGNER LES INFORMATIONS SUIVANTES :
                </p>

                <div style={{ color: '#9F8268', fontSize: '0.7rem' }}>
                  ♥
                </div>
              </div>

              {/* Delivery Settings Error with Retry Button */}
              {deliveryStatus === 'failed' && (
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
                    <span>{deliveryErrorMessage || "Impossible de charger les informations de livraison. Veuillez réessayer."}</span>
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
                    Réessayer
                  </button>
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
                          Nom : <span style={{ color: '#A86450' }}>*</span>
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Nom de famille"
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
                          Prénom : <span style={{ color: '#A86450' }}>*</span>
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Prénom"
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
                        Wilaya (58 Wilayas) : <span style={{ color: '#A86450' }}>*</span>
                      </label>
                      {deliveryStatus === 'loading' ? (
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
                          <span>Chargement des 58 wilayas...</span>
                        </div>
                      ) : (
                        <select
                          value={selectedWilayaCode || ''}
                          disabled={deliveryStatus !== 'loaded' || wilayas.length === 0}
                          onChange={(e) => setSelectedWilayaCode(Number(e.target.value))}
                          className="checkout-input"
                          style={{ cursor: deliveryStatus === 'loaded' ? 'pointer' : 'not-allowed', fontWeight: '600' }}
                        >
                          {wilayas.length === 0 ? (
                            <option value="">Paramètres de livraison non disponibles</option>
                          ) : (
                            wilayas.map((w) => (
                              <option key={w.code} value={w.code} disabled={!w.isAvailable}>
                                {w.code} - {w.name} {w.nameAr ? `(${w.nameAr})` : ''} {!w.isAvailable ? '— [Non desservie]' : ''}
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
                          <span>La livraison est temporairement suspendue pour cette wilaya. Veuillez en sélectionner une autre.</span>
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
                        Numéro de téléphone : <span style={{ color: '#A86450' }}>*</span>
                      </label>
                      <input
                        type="tel"
                        required
                        placeholder="05 / 06 / 07 XX XX XX XX"
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
                        Mode de livraison :
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
                            À domicile {selectedWilayaObj ? `(+${selectedWilayaObj.homeFee.toLocaleString()} DA)` : (deliveryStatus === 'loading' ? '(Chargement...)' : '')}
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
                            Au bureau / Stopdesk {selectedWilayaObj ? `(+${selectedWilayaObj.agencyFee.toLocaleString()} DA)` : (deliveryStatus === 'loading' ? '(Chargement...)' : '')}
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
                          Adresse complète de livraison : <span style={{ color: '#A86450' }}>*</span>
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Cité, Bâtiment, Numéro de rue, Commune..."
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
                          Nom de l'agence ou bureau de retrait : <span style={{ color: '#A86450' }}>*</span>
                        </label>
                        <input
                          type="text"
                          required
                          placeholder="Ex: Bureau Yalidine Alger Centre, Stopdesk Bab Ezzouar..."
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
                        Autres informations (si besoin) :
                      </label>
                      <textarea
                        rows={2}
                        placeholder="Instructions pour le livreur, horaire préféré, remarque..."
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
                          <span>Confirmation de votre commande...</span>
                        </>
                      ) : deliveryStatus === 'loading' ? (
                        <>
                          <Loader2 size={19} className="animate-spin" />
                          <span>Chargement des tarifs de livraison...</span>
                        </>
                      ) : deliveryStatus === 'failed' ? (
                        <>
                          <AlertCircle size={19} />
                          <span>Tarifs indisponibles (Vérifier connexion)</span>
                        </>
                      ) : (selectedWilayaObj && !selectedWilayaObj.isAvailable) ? (
                        <>
                          <AlertCircle size={19} />
                          <span>Wilaya non desservie</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={19} />
                          <span>
                            Confirmer ma commande {estimatedTotal !== null ? `(${estimatedTotal.toLocaleString()} DZD)` : ''}
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
                  fontFamily: "'Alex Brush', cursive",
                  fontSize: '2.3rem',
                  color: '#9F8268',
                  lineHeight: 1,
                  marginBottom: '0.15rem'
                }}>
                  Merci ♥
                </div>

                <div style={{
                  fontFamily: 'var(--font-sans, inherit)',
                  fontSize: '0.7rem',
                  fontWeight: '700',
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: '#766657'
                }}>
                  POUR VOTRE CONFIANCE
                </div>

                {/* Bottom right sprig */}
                <div style={{
                  position: 'absolute',
                  bottom: '-12px',
                  right: '-10px',
                  width: '160px',
                  height: '160px',
                  pointerEvents: 'none',
                  zIndex: 1,
                  opacity: 0.75,
                  mixBlendMode: 'multiply',
                  WebkitMaskImage: 'radial-gradient(circle at 60% 60%, black 40%, transparent 80%)',
                  maskImage: 'radial-gradient(circle at 60% 60%, black 40%, transparent 80%)'
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
                  right: '8px',
                  textAlign: 'right',
                  pointerEvents: 'none',
                  zIndex: 2
                }} className="desktop-only">
                  <div style={{
                    fontFamily: "'Alex Brush', cursive",
                    fontSize: '1.45rem',
                    color: '#8A715C',
                    lineHeight: 1,
                    transform: 'rotate(-4deg)'
                  }}>
                    Toujours plus<br />près de vous
                  </div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
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
                Récapitulatif ({items.length} {items.length === 1 ? 'article' : 'articles'})
              </h3>
              <span style={{ fontSize: '0.78rem', color: '#9F8268', fontWeight: '600' }}>
                Paiement Cash à la livraison
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
                      {item.productName}
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
                      <span>• Taille {item.size}</span>
                      <span>• Qté {item.quantity}</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{
                      fontSize: '0.92rem',
                      fontWeight: '700',
                      color: (item.originalPrice && item.originalPrice > item.unitPrice) ? '#DC2626' : '#2A241F'
                    }}>
                      {(item.unitPrice * item.quantity).toLocaleString()} DA
                    </div>
                    {item.originalPrice && item.originalPrice > item.unitPrice && (
                      <div style={{ fontSize: '0.75rem', color: '#999', textDecoration: 'line-through' }}>
                        {(item.originalPrice * item.quantity).toLocaleString()} DA
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
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#666' }}>
                <span>Sous-total articles</span>
                <span style={{ fontWeight: '600', color: '#2A241F' }}>{subtotal.toLocaleString()} DZD</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem', color: '#666' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Truck size={15} color="#9F8268" />
                  Livraison ({deliveryMethod === 'agency' ? 'Stopdesk' : 'À domicile'} {selectedWilayaObj ? `- Wilaya ${selectedWilayaObj.code}` : ''})
                </span>
                <span style={{ fontWeight: '600', color: '#2A241F' }}>
                  {deliveryStatus === 'loading' ? (
                    <span style={{ fontSize: '0.8rem', color: '#9F8268' }}>Calcul en cours...</span>
                  ) : deliveryStatus === 'failed' ? (
                    <span style={{ fontSize: '0.8rem', color: '#DC2626' }}>Non disponible</span>
                  ) : activeDeliveryFee !== null ? (
                    `+${activeDeliveryFee.toLocaleString()} DZD`
                  ) : (
                    '—'
                  )}
                </span>
              </div>

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
                <span>Total à régler (COD)</span>
                <span style={{ color: '#9F8268', fontSize: '1.35rem' }}>
                  {estimatedTotal !== null ? (
                    `${estimatedTotal.toLocaleString()} DZD`
                  ) : deliveryStatus === 'loading' ? (
                    <span style={{ fontSize: '0.95rem', color: '#9F8268', fontWeight: '600' }}>Calcul en cours...</span>
                  ) : (
                    <span style={{ fontSize: '0.95rem', color: '#DC2626', fontWeight: '600' }}>En attente</span>
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
                <strong style={{ color: '#2A241F' }}>Paiement à la livraison garanti :</strong> Aucun paiement par carte n'est requis. Vous ne payez qu'après réception de votre colis auprès du livreur ou en agence.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
