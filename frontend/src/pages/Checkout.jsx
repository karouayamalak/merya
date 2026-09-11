import React, { useState, useEffect } from 'react';
import { ArrowLeft, ShieldCheck, Truck, Building2, Home as HomeIcon, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
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

  // Form state
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedWilayaCode, setSelectedWilayaCode] = useState(16); // Default 16 - Algiers
  const [deliveryMethod, setDeliveryMethod] = useState('agency'); // 'agency' | 'home'
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
    name: 'Algiers',
    wilayaName: 'Algiers',
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

    if (!fullName.trim()) {
      setErrorMessage('Please provide your full name');
      return;
    }
    if (!phone.trim() || phone.trim().length < 8) {
      setErrorMessage('Please provide a valid Algerian phone number (at least 8 digits)');
      return;
    }
    if (deliveryMethod === 'home' && (!address.trim() || address.trim().length < 4)) {
      setErrorMessage('Please provide a complete home delivery address (at least 4 characters)');
      return;
    }
    if (deliveryMethod === 'agency' && (!agencyName.trim() || agencyName.trim().length < 2)) {
      setErrorMessage('Please specify the agency/stopdesk name for pickup (e.g. Yalidine Kouba)');
      return;
    }

    setIsSubmitting(true);

    try {
      const orderPayload = {
        idempotencyKey,
        customer: {
          fullName: fullName.trim(),
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
        setErrorMessage(res.message || 'Failed to place order');
        setIsSubmitting(false);
      }
    } catch (err) {
      setErrorMessage(err.message || 'An error occurred while submitting your order');
      setIsSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="container" style={{ padding: '6rem 1rem', textAlign: 'center' }}>
        <h2 style={{ fontSize: '1.8rem', fontWeight: '700', marginBottom: '1rem' }}>Your shopping bag is empty</h2>
        <p style={{ color: '#666', marginBottom: '2rem' }}>Please select some items from our collection before checking out.</p>
        <button onClick={onBack} className="btn btn-primary">Return to Shop</button>
      </div>
    );
  }

  return (
    <div style={{ paddingTop: '2.5rem', paddingBottom: '6rem' }}>
      <div className="container">
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
            marginBottom: '2rem'
          }}
        >
          <ArrowLeft size={16} />
          Back to Bag
        </button>

        <h1 className="heading-display" style={{ fontSize: 'clamp(1.8rem, 3.5vw, 2.5rem)', color: 'var(--color-espresso)', marginBottom: '2.5rem' }}>
          CASH ON DELIVERY CHECKOUT
        </h1>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '3.5rem',
          alignItems: 'flex-start'
        }}>
          {/* Left Column: Checkout Form */}
          <form onSubmit={handleSubmitOrder} style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
            {errorMessage && (
              <div style={{
                backgroundColor: '#FFEBEE',
                border: '1px solid #FFCDD2',
                color: 'var(--color-danger)',
                padding: '1rem 1.25rem',
                borderRadius: 'var(--radius-md)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                fontSize: '0.88rem'
              }}>
                <AlertCircle size={18} flexShrink={0} />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* 1. Customer Information */}
            <div style={{
              backgroundColor: 'var(--color-surface)',
              borderRadius: 'var(--radius-lg)',
              padding: '1.75rem',
              border: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem'
            }}>
              <h3 style={{ fontSize: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                1. Customer Contact Details
              </h3>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', marginBottom: '0.4rem' }}>
                  Full Name (Nom & Prénom) *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Fatima Zahra Bouzid"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.8rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-bg-base)'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', marginBottom: '0.4rem' }}>
                  Phone Number (Numéro de téléphone) *
                </label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. 0550 12 34 56 or 0661..."
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.8rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-bg-base)'
                  }}
                />
                <span style={{ fontSize: '0.75rem', color: '#777', marginTop: '0.25rem', display: 'block' }}>
                  Our delivery courier will call you before delivery to confirm availability.
                </span>
              </div>
            </div>

            {/* 2. Destination Wilaya */}
            <div style={{
              backgroundColor: 'var(--color-surface)',
              borderRadius: 'var(--radius-lg)',
              padding: '1.75rem',
              border: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem'
            }}>
              <h3 style={{ fontSize: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                2. Select Your Wilaya
              </h3>

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', marginBottom: '0.4rem' }}>
                  Wilaya (Province) *
                </label>
                <select
                  value={selectedWilayaCode}
                  onChange={(e) => setSelectedWilayaCode(Number(e.target.value))}
                  style={{
                    width: '100%',
                    padding: '0.8rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-bg-base)',
                    fontWeight: '600'
                  }}
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

            {/* 3. Delivery Method Selection */}
            <div style={{
              backgroundColor: 'var(--color-surface)',
              borderRadius: 'var(--radius-lg)',
              padding: '1.75rem',
              border: '1px solid var(--color-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem'
            }}>
              <h3 style={{ fontSize: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                3. Choose Delivery Method
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                {/* Agency Pickup Option */}
                <button
                  type="button"
                  onClick={() => setDeliveryMethod('agency')}
                  style={{
                    padding: '1.25rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    border: deliveryMethod === 'agency' ? '2px solid var(--color-espresso)' : '1px solid var(--color-border)',
                    backgroundColor: deliveryMethod === 'agency' ? 'var(--color-bg-card)' : 'var(--color-bg-base)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.5rem',
                    textAlign: 'center',
                    cursor: 'pointer'
                  }}
                >
                  <Building2 size={24} color={deliveryMethod === 'agency' ? 'var(--color-espresso)' : '#777'} />
                  <div style={{ fontWeight: '700', fontSize: '0.88rem' }}>Agency Pickup</div>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>Stopdesk / Yalidine Hub</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: '800', color: 'var(--color-espresso)' }}>
                    +{(selectedWilayaObj.agencyFee !== undefined ? selectedWilayaObj.agencyFee : deliverySettings.agencyDeliveryFee)} DZD
                  </div>
                </button>

                {/* Home Delivery Option */}
                <button
                  type="button"
                  onClick={() => setDeliveryMethod('home')}
                  style={{
                    padding: '1.25rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    border: deliveryMethod === 'home' ? '2px solid var(--color-espresso)' : '1px solid var(--color-border)',
                    backgroundColor: deliveryMethod === 'home' ? 'var(--color-bg-card)' : 'var(--color-bg-base)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.5rem',
                    textAlign: 'center',
                    cursor: 'pointer'
                  }}
                >
                  <HomeIcon size={24} color={deliveryMethod === 'home' ? 'var(--color-espresso)' : '#777'} />
                  <div style={{ fontWeight: '700', fontSize: '0.88rem' }}>Home Delivery</div>
                  <div style={{ fontSize: '0.75rem', color: '#666' }}>Delivered to your door</div>
                  <div style={{ fontSize: '0.85rem', fontWeight: '800', color: 'var(--color-espresso)' }}>
                    +{(selectedWilayaObj.homeFee !== undefined ? selectedWilayaObj.homeFee : deliverySettings.homeDeliveryFee)} DZD
                  </div>
                </button>
              </div>

              {/* Dynamic Address Inputs based on selected method */}
              {deliveryMethod === 'home' ? (
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', marginBottom: '0.4rem' }}>
                    Full Delivery Address (Adresse complète de livraison) *
                  </label>
                  <textarea
                    required
                    rows={3}
                    placeholder="e.g. Cité 500 Logements, Bâtiment C, N° 12, Kouba"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.8rem 1rem',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-bg-base)'
                    }}
                  />
                </div>
              ) : (
                <div>
                  <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', marginBottom: '0.4rem' }}>
                    Preferred Pickup Agency / Bureau <span style={{ color: 'var(--color-danger)' }}>*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Yalidine Kouba, MBE Alger Centre, Guepex Oran..."
                    value={agencyName}
                    onChange={(e) => setAgencyName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.8rem 1rem',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border)',
                      backgroundColor: 'var(--color-bg-base)'
                    }}
                  />
                  <span style={{ fontSize: '0.75rem', color: '#777', marginTop: '0.25rem', display: 'block' }}>
                    Please enter the name of the pickup agency or stopdesk where you'll collect your order (min. 2 characters).
                  </span>
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: '600', marginBottom: '0.4rem' }}>
                  Special Delivery Instructions (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Call before 2 PM, leave with concierge, etc."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.8rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-bg-base)'
                  }}
                />
              </div>
            </div>

            {/* Submit Action */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary"
              style={{
                padding: '1.25rem',
                fontSize: '1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.75rem'
              }}
            >
              {isSubmitting ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  <span>Confirming Order & Reserving Stock...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 size={20} />
                  <span>Confirm Order (Pay {estimatedTotal.toLocaleString()} DZD upon receipt)</span>
                </>
              )}
            </button>
          </form>

          {/* Right Column: Order Summary Snapshot */}
          <div style={{
            backgroundColor: 'var(--color-bg-card)',
            borderRadius: 'var(--radius-xl)',
            padding: '2rem',
            border: '1px solid var(--color-border)',
            position: 'sticky',
            top: '90px'
          }}>
            <h3 style={{ fontSize: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '1.5rem' }}>
              Order Summary ({items.length} {items.length === 1 ? 'item' : 'items'})
            </h3>

            {/* Item list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
              {items.map((item) => (
                <div
                  key={`${item.productId}-${item.colorName}-${item.size}`}
                  style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}
                >
                  <img
                    src={item.image}
                    alt=""
                    style={{
                      width: '52px',
                      height: '68px',
                      borderRadius: 'var(--radius-sm)',
                      objectFit: 'cover'
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: '600' }}>{item.productName}</div>
                    <div style={{ fontSize: '0.78rem', color: '#666' }}>
                      {item.colorName} • Size {item.size} • Qty {item.quantity}
                    </div>
                  </div>
                  <div style={{ fontSize: '0.9rem', fontWeight: '700' }}>
                    {(item.unitPrice * item.quantity).toLocaleString()} DZD
                  </div>
                </div>
              ))}
            </div>

            {/* Financial breakdown */}
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#555' }}>
                <span>Subtotal</span>
                <span>{subtotal.toLocaleString()} DZD</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem', color: '#555' }}>
                <span>Delivery ({deliveryMethod === 'agency' ? 'Agency Pickup' : 'Home Delivery'})</span>
                <span>+{activeDeliveryFee.toLocaleString()} DZD</span>
              </div>

              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '1.25rem',
                fontWeight: '800',
                color: 'var(--color-espresso)',
                borderTop: '1px solid var(--color-border)',
                paddingTop: '0.75rem'
              }}>
                <span>Total Amount (COD)</span>
                <span>{estimatedTotal.toLocaleString()} DZD</span>
              </div>
            </div>

            {/* COD Trust Note */}
            <div style={{
              marginTop: '1.5rem',
              padding: '1rem',
              backgroundColor: 'var(--color-surface)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.78rem',
              color: '#666',
              lineHeight: 1.5,
              display: 'flex',
              gap: '0.6rem'
            }}>
              <ShieldCheck size={20} color="var(--color-primary-dark)" flexShrink={0} />
              <span>
                <strong>Cash on Delivery:</strong> No credit card or prepayment required. You only pay the courier when your package arrives at your doorstep or agency.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
