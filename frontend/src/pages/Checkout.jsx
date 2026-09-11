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

export default function Checkout({ onBack, onOrderSuccess }) {
  const { items, subtotal, clearCart } = useCart();

  const [deliverySettings, setDeliverySettings] = useState({
    agencyDeliveryFee: 500,
    homeDeliveryFee: 800
  });
  const [wilayas, setWilayas] = useState([]);
  const [loadingSettings, setLoadingSettings] = useState(true);

  // Form state (Nom, Prénom, Téléphone, Wilaya, Mode d'envoi, Adresse/Agence, Notes)
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedWilayaCode, setSelectedWilayaCode] = useState(16); // Default 16 - Algiers
  const [deliveryMethod, setDeliveryMethod] = useState('home'); // Default 'home' or 'agency'
  const [agencyName, setAgencyName] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  // Submitting & Double-click protection
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(() => `idemp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetchDeliverySettings();
        if (res.success) {
          setDeliverySettings(res.settings);
          setWilayas(res.wilayas || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingSettings(false);
      }
    }
    loadSettings();
  }, []);

  const selectedWilayaObj = wilayas.find(w => (
    (w.code && w.code === parseInt(selectedWilayaCode, 10)) ||
    (w.wilayaCode && w.wilayaCode === parseInt(selectedWilayaCode, 10))
  )) || {
    code: selectedWilayaCode,
    wilayaCode: selectedWilayaCode,
    name: 'Alger',
    wilayaName: 'Alger',
    homeFee: deliverySettings.homeDeliveryFee || 800,
    agencyFee: deliverySettings.agencyDeliveryFee || 500
  };

  const activeDeliveryFee = deliveryMethod === 'agency'
    ? (selectedWilayaObj.agencyFee !== undefined ? selectedWilayaObj.agencyFee : (deliverySettings.agencyDeliveryFee || 500))
    : (selectedWilayaObj.homeFee !== undefined ? selectedWilayaObj.homeFee : (deliverySettings.homeDeliveryFee || 800));

  const estimatedTotal = subtotal + activeDeliveryFee;

  const handleSubmitOrder = async (e) => {
    e.preventDefault();
    setErrorMessage('');

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
            code: selectedWilayaObj.code || selectedWilayaObj.wilayaCode,
            name: selectedWilayaObj.name || selectedWilayaObj.wilayaName
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
      minHeight: '100vh'
    }}>
      <style>{`
        .checkout-input {
          width: 100%;
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
      `}</style>

      <div className="container" style={{ maxWidth: '1180px' }}>
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

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '2.5rem',
          alignItems: 'flex-start'
        }}>
          {/* LEFT: THE LUXURY ORDER FORM CARD (Inspired by the client reference) */}
          {/* Wrapper allows the bow to overflow the card */}
          <div style={{ position: 'relative' }}>

            {/* BOW: sits physically ON TOP of the card's top-right corner */}
            <div style={{
              position: 'absolute',
              top: '-31px',
              right: '-30px',
              width: '180px',
              height: '180px',
              pointerEvents: 'none',
              zIndex: 10
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

          <div style={{
            backgroundColor: '#FAF7F2',
            backgroundImage: 'radial-gradient(circle at 50% 0%, #FFFFFF 0%, #FAF7F2 80%)',
            borderRadius: '24px',
            border: '1.5px solid #E8E0D5',
            boxShadow: '0 16px 40px rgba(42, 36, 31, 0.07), 0 3px 10px rgba(184, 156, 130, 0.05)',
            padding: '2.25rem 2rem 2.5rem 2rem',
            position: 'relative',
            overflow: 'hidden'
          }}>
            {/* CLEAN NATURAL DECORATION: Top-left draped silk & natural baby's breath flowers */}
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

            {/* Error banner if any */}
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                  {/* Nom */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    <div className="checkout-icon-badge">
                      <User size={16} />
                    </div>
                    <div style={{ flex: 1 }}>
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
                    <div style={{ flex: 1 }}>
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

                {/* Row 3: Wilaya (All 69 Wilayas) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                  <div className="checkout-icon-badge">
                    <MapPin size={16} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#2A241F', marginBottom: '0.25rem' }}>
                      Wilaya (69 Wilayas) : <span style={{ color: '#A86450' }}>*</span>
                    </label>
                    <select
                      value={selectedWilayaCode}
                      onChange={(e) => setSelectedWilayaCode(Number(e.target.value))}
                      className="checkout-input"
                      style={{ cursor: 'pointer', fontWeight: '600' }}
                    >
                      {wilayas.map((w) => {
                        const c = w.code || w.wilayaCode;
                        const n = w.name || w.wilayaName;
                        const ar = w.nameAr || w.wilayaNameAr || '';
                        return (
                          <option key={c} value={c}>
                            {c} - {n} {ar ? `(${ar})` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                </div>

                {/* Row 4: Numéro de téléphone */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                  <div className="checkout-icon-badge">
                    <Phone size={16} />
                  </div>
                  <div style={{ flex: 1 }}>
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
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '700', color: '#2A241F', marginBottom: '0.35rem' }}>
                      Envoi à domicile ou au bureau :
                    </label>
                    <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                      <button
                        type="button"
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
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.4rem',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <span>À domicile (+{(selectedWilayaObj.homeFee !== undefined ? selectedWilayaObj.homeFee : deliverySettings.homeDeliveryFee)} DA)</span>
                      </button>

                      <button
                        type="button"
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
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.4rem',
                          transition: 'all 0.2s ease'
                        }}
                      >
                        <span>Au bureau / Stopdesk (+{(selectedWilayaObj.agencyFee !== undefined ? selectedWilayaObj.agencyFee : deliverySettings.agencyDeliveryFee)} DA)</span>
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
                    <div style={{ flex: 1 }}>
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

                {/* Row 6: Autres informations (si besoin) */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.85rem' }}>
                  <div className="checkout-icon-badge" style={{ marginTop: '0.2rem' }}>
                    <FileText size={16} />
                  </div>
                  <div style={{ flex: 1 }}>
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
                    disabled={isSubmitting}
                    style={{
                      width: '100%',
                      padding: '1rem 1.5rem',
                      borderRadius: '9999px',
                      background: 'linear-gradient(135deg, #A88D74 0%, #9F8268 100%)',
                      color: '#FFFFFF',
                      border: 'none',
                      fontSize: '0.98rem',
                      fontWeight: '700',
                      letterSpacing: '0.04em',
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.65rem',
                      boxShadow: '0 6px 18px rgba(159, 130, 104, 0.35)',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={19} className="animate-spin" />
                        <span>Confirmation de votre commande...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={19} />
                        <span>Confirmer ma commande ({estimatedTotal.toLocaleString()} DZD)</span>
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

              {/* Bottom right subtle handwritten script & soft floral sprig */}
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
          </div>{/* end wrapper for bow overflow */}

          {/* RIGHT: ORDER SUMMARY (Luxury matching style) */}
          <div style={{
            backgroundColor: '#FAF7F2',
            borderRadius: '24px',
            border: '1.5px solid #E8E0D5',
            boxShadow: '0 12px 32px rgba(42, 36, 31, 0.05)',
            padding: '2rem',
            position: 'sticky',
            top: '90px'
          }}>
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
                    src={item.image}
                    alt=""
                    style={{
                      width: '54px',
                      height: '68px',
                      borderRadius: '8px',
                      objectFit: 'cover'
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: '700', color: '#2A241F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {item.productName}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#777', display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
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
                  <div style={{ textAlign: 'right' }}>
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
                  Livraison ({deliveryMethod === 'agency' ? 'Stopdesk' : 'À domicile'} - Wilaya {selectedWilayaObj.code || selectedWilayaObj.wilayaCode})
                </span>
                <span style={{ fontWeight: '600', color: '#2A241F' }}>+{activeDeliveryFee.toLocaleString()} DZD</span>
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
                <span style={{ color: '#9F8268', fontSize: '1.35rem' }}>{estimatedTotal.toLocaleString()} DZD</span>
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
