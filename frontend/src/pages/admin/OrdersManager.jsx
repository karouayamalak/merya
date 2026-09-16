import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Eye,
  History,
  Edit2,
  X,
  Loader2,
  ShoppingBag,
  Save,
  Check,
  Plus,
  Trash2
} from 'lucide-react';
import {
  adminGetOrders,
  adminGetOrderById,
  adminUpdateOrderStatus,
  adminUpdateCustomerDetails,
  adminUpdateOrderItems,
  adminGetProducts,
  fetchDeliverySettings
} from '../../services/api';
import { useLanguage } from '../../context/LanguageContext';

const ORDER_STATUSES = [
  'Pending',
  'Confirmed',
  'On the way',
  'At agency',
  'Delivered',
  'Returned',
  'Cancelled'
];

export default function OrdersManager() {
  const { t, isRtl, formatCurrency, localized } = useLanguage();
  const [orders, setOrders] = useState([]);

  const getStatusLabel = (status) => {
    const map = {
      'Pending': 'status.pending',
      'Confirmed': 'status.confirmed',
      'On the way': 'status.onTheWay',
      'At agency': 'status.atAgency',
      'Delivered': 'status.delivered',
      'Returned': 'status.returned',
      'Cancelled': 'status.cancelled'
    };
    const key = map[status];
    return key ? t(key) : status;
  };
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatingOrderId, setUpdatingOrderId] = useState(null);

  // Delivery settings & all 58 Wilayas for editing
  const [wilayasList, setWilayasList] = useState([]);

  // Active modal order
  const [activeOrder, setActiveOrder] = useState(null);
  const [editCustomerOpen, setEditCustomerOpen] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState('');

  // Editable customer & delivery state
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editWilayaCode, setEditWilayaCode] = useState(16);
  const [editDeliveryMethod, setEditDeliveryMethod] = useState('home'); // 'home' | 'agency'
  const [editAddress, setEditAddress] = useState('');
  const [editAgencyName, setEditAgencyName] = useState('');
  const [editDeliveryFee, setEditDeliveryFee] = useState(0);
  const [deliveryFeeError, setDeliveryFeeError] = useState(null);
  const [editNotes, setEditNotes] = useState('');

  // Line item editing state
  const [editItemsOpen, setEditItemsOpen] = useState(false);
  const [editItemsList, setEditItemsList] = useState([]);
  const [editItemsReason, setEditItemsReason] = useState('');
  const [availableProducts, setAvailableProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [itemsActionLoading, setItemsActionLoading] = useState(false);

  // Load orders
  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (search.trim()) params.search = search.trim();
      if (statusFilter) params.status = statusFilter;

      const res = await adminGetOrders(params);
      if (res.success) {
        setOrders(res.orders || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  // Load wilayas and delivery settings on mount
  useEffect(() => {
    async function loadWilayas() {
      try {
        const res = await fetchDeliverySettings();
        if (res.success) {
          setWilayasList(res.wilayas || []);
        }
      } catch (err) {
        console.error('Failed to load delivery settings:', err);
      }
    }
    loadWilayas();
  }, []);

  useEffect(() => {
    const timer = setTimeout(loadOrders, 250);
    return () => clearTimeout(timer);
  }, [loadOrders]);

  const populateEditForm = (order) => {
    const wCode = order.customer.wilaya?.code || 16;
    const method = String(order.customer.deliveryMethod || 'home').toLowerCase();

    setEditFullName(order.customer.fullName || '');
    setEditPhone(order.customer.phone || '');
    setEditWilayaCode(Number(wCode));
    setEditDeliveryMethod(method);
    setEditAddress(order.customer.address || '');
    setEditAgencyName(order.customer.agencyName || '');
    setEditDeliveryFee(order.deliveryFee !== undefined ? order.deliveryFee : 0);
    setEditNotes(order.customer.notes || '');
    setDeliveryFeeError(null);
  };

  const openOrderDetails = async (orderId) => {
    setFeedback('');
    setEditCustomerOpen(false);
    try {
      const res = await adminGetOrderById(orderId);
      if (res.success) {
        setActiveOrder(res.order);
        populateEditForm(res.order);
      }
    } catch (err) {
      alert(err.message);
    }
  };

  // Quick status change directly from table
  const handleQuickStatusChange = async (orderId, newStatus) => {
    if (newStatus === 'Cancelled') {
      const ok = window.confirm('Are you sure you want to cancel this order? Reserved stock will be restored automatically.');
      if (!ok) return;
    }

    setUpdatingOrderId(orderId);
    try {
      const res = await adminUpdateOrderStatus(orderId, newStatus, `Quick status update to ${newStatus}`);
      if (res.success) {
        setOrders(prev => prev.map(o => o._id === orderId ? { ...o, status: newStatus } : o));
        if (activeOrder && activeOrder._id === orderId) {
          setActiveOrder(res.order);
        }
      }
    } catch (err) {
      alert(err.message || 'Failed to update order status');
    } finally {
      setUpdatingOrderId(null);
    }
  };

  // Status change inside modal
  const handleModalStatusChange = async (newStatus) => {
    if (!activeOrder) return;
    if (newStatus === 'Cancelled') {
      const ok = window.confirm('Are you sure you want to cancel this order? Reserved stock will be restored automatically.');
      if (!ok) return;
    }

    setActionLoading(true);
    setFeedback('');
    try {
      const res = await adminUpdateOrderStatus(activeOrder._id, newStatus, statusNote);
      if (res.success) {
        setActiveOrder(res.order);
        setStatusNote('');
        setFeedback(`Order status updated to "${newStatus}"!`);
        setOrders(prev => prev.map(o => o._id === activeOrder._id ? { ...o, status: newStatus } : o));
      }
    } catch (err) {
      alert(err.message || 'Status transition failed');
    } finally {
      setActionLoading(false);
    }
  };

  // Recalculate delivery fee preview strictly from authoritative settings
  const handleWilayaOrMethodChange = (newWilayaCode, newMethod) => {
    const codeNum = Number(newWilayaCode);
    setEditWilayaCode(codeNum);
    setEditDeliveryMethod(newMethod);

    if (wilayasList && wilayasList.length > 0) {
      const wObj = wilayasList.find(w => (w.code === codeNum || w.wilayaCode === codeNum));
      if (wObj) {
        if (wObj.isAvailable === false) {
          setEditDeliveryFee(null);
          setDeliveryFeeError(`Wilaya ${codeNum} is currently marked unavailable for delivery.`);
          return;
        }
        const fee = newMethod === 'agency' ? wObj.agencyFee : wObj.homeFee;
        if (typeof fee !== 'number' || fee < 0) {
          setEditDeliveryFee(null);
          setDeliveryFeeError(`Authoritative fee is not configured for ${newMethod} delivery in Wilaya ${codeNum}.`);
          return;
        }
        setEditDeliveryFee(fee);
        setDeliveryFeeError(null);
      }
    }
  };

  // Save all edited order & customer details
  const handleSaveCustomer = async (e) => {
    e.preventDefault();
    if (!activeOrder) return;

    if (deliveryFeeError || editDeliveryFee === null) {
      alert(deliveryFeeError || 'Cannot update: delivery fee is not configured for this Wilaya and method.');
      return;
    }

    setActionLoading(true);
    setFeedback('');
    try {
      const selectedW = wilayasList.find(w => (w.code === Number(editWilayaCode) || w.wilayaCode === Number(editWilayaCode)));
      const wilayaPayload = selectedW ? { code: selectedW.code || selectedW.wilayaCode, name: selectedW.name || selectedW.wilayaName } : { code: editWilayaCode, name: `Wilaya ${editWilayaCode}` };

      // Client sends requested wilaya & method; backend authoritatively calculates fee from DeliverySetting
      const updateData = {
        fullName: editFullName.trim(),
        phone: editPhone.trim(),
        wilaya: wilayaPayload,
        deliveryMethod: editDeliveryMethod,
        address: editDeliveryMethod === 'home' ? editAddress.trim() : '',
        agencyName: editDeliveryMethod === 'agency' ? editAgencyName.trim() : '',
        notes: editNotes.trim(),
        expectedVersion: activeOrder.__v
      };

      const res = await adminUpdateCustomerDetails(activeOrder._id, updateData);

      if (res.success) {
        setActiveOrder(res.order);
        populateEditForm(res.order);
        setEditCustomerOpen(false);
        setFeedback('All order details and delivery info updated successfully!');
        loadOrders();
      }
    } catch (err) {
      alert(err.message || 'Failed to update order details');
    } finally {
      setActionLoading(false);
    }
  };

  // Line item editing handlers
  const handleOpenEditItems = async () => {
    if (!activeOrder) return;
    if (activeOrder.status === 'Delivered' || activeOrder.status === 'Cancelled') {
      alert('Items cannot be modified on Delivered or Cancelled orders.');
      return;
    }
    setEditItemsOpen(true);
    setEditItemsReason('');
    setEditItemsList(activeOrder.items.map(item => ({
      productId: item.productId?._id || item.productId,
      productName: item.productName,
      colorName: item.colorName,
      size: item.size,
      quantity: item.quantity,
      unitPrice: item.unitPrice
    })));

    if (availableProducts.length === 0) {
      setLoadingProducts(true);
      try {
        const res = await adminGetProducts();
        if (res.success) {
          setAvailableProducts(res.products || []);
        }
      } catch (err) {
        console.error('Failed to load products for editing:', err);
      } finally {
        setLoadingProducts(false);
      }
    }
  };

  const handleSaveItems = async (e) => {
    e.preventDefault();
    if (!activeOrder) return;
    if (editItemsList.length === 0) {
      alert('Order must contain at least one item.');
      return;
    }

    const ok = window.confirm('Are you sure you want to save these item changes? Inventory will be atomically adjusted in the database.');
    if (!ok) return;

    setItemsActionLoading(true);
    setFeedback('');
    try {
      const payload = {
        items: editItemsList.map(it => ({
          productId: it.productId,
          colorName: it.colorName,
          size: it.size,
          quantity: Number(it.quantity)
        })),
        expectedVersion: activeOrder.__v,
        reason: editItemsReason.trim() || 'Admin order item modification'
      };

      const res = await adminUpdateOrderItems(activeOrder._id, payload);
      if (res.success) {
        setActiveOrder(res.order);
        setEditItemsOpen(false);
        setFeedback('Order line items updated and inventory atomically adjusted!');
        loadOrders();
      }
    } catch (err) {
      if (err.code === 'CONCURRENT_CONFLICT' || err.message?.includes('CONCURRENT_CONFLICT')) {
        alert('CONCURRENT_CONFLICT: The order was updated concurrently. Refreshing details...');
        openOrderDetails(activeOrder._id);
      } else {
        alert(err.message || 'Failed to update order items');
      }
    } finally {
      setItemsActionLoading(false);
    }
  };

  const getStatusBadgeStyle = (status) => {
    switch (status) {
      case 'Pending':
        return { backgroundColor: '#FFF8E1', color: '#B78103', border: '1px solid #FFE082' };
      case 'Confirmed':
        return { backgroundColor: '#E3F2FD', color: '#1565C0', border: '1px solid #90CAF9' };
      case 'On the way':
        return { backgroundColor: '#EDE7F6', color: '#5E35B1', border: '1px solid #D1C4E9' };
      case 'At agency':
        return { backgroundColor: '#FBE9E7', color: '#D84315', border: '1px solid #FFCCBC' };
      case 'Delivered':
        return { backgroundColor: '#E8F5E9', color: '#2E7D32', border: '1px solid #A5D6A7' };
      case 'Returned':
        return { backgroundColor: '#FCE4EC', color: '#C2185B', border: '1px solid #F8BBD0' };
      case 'Cancelled':
        return { backgroundColor: '#FFEBEE', color: '#C62828', border: '1px solid #FFCDD2' };
      default:
        return { backgroundColor: '#F5F5F5', color: '#666', border: '1px solid #DDD' };
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 className="heading-display" style={{ fontSize: '1.8rem', color: 'var(--color-espresso)' }}>
            {t('admin.orders.title').toUpperCase()}
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
            {t('admin.dashboard.quickStats')}
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '1.5rem',
        flexWrap: 'wrap'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '0.5rem 0.85rem',
          flex: 1,
          maxWidth: '400px'
        }}>
          <Search size={18} color="#888" style={{ [isRtl ? 'marginLeft' : 'marginRight']: '0.5rem' }} />
          <input
            type="text"
            placeholder={t('admin.orders.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', border: 'none', background: 'transparent', outline: 'none' }}
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '0.5rem 1rem',
            outline: 'none',
            fontSize: '0.85rem'
          }}
        >
          <option value="">{t('admin.orders.allStatuses')}</option>
          {ORDER_STATUSES.map(st => (
            <option key={st} value={st}>{getStatusLabel(st)}</option>
          ))}
        </select>
      </div>

      {/* Orders Table */}
      <div style={{
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-xl)',
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-sm)'
      }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}>
            <Loader2 size={32} className="animate-spin" style={{ margin: '0 auto', color: 'var(--color-espresso)' }} />
          </div>
        ) : orders.length === 0 ? (
          <div style={{ padding: '4rem 1rem', textAlign: 'center', color: '#777' }}>
            <ShoppingBag size={40} strokeWidth={1.5} style={{ margin: '0 auto 1rem auto' }} />
            <p>{t('admin.orders.noOrders')}</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: isRtl ? 'right' : 'left', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-card)', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>{t('admin.orders.orderCode')}</th>
                <th style={{ padding: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>{t('admin.orders.customer')}</th>
                <th style={{ padding: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>{t('admin.orders.wilaya')}</th>
                <th style={{ padding: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>{t('admin.orders.total')}</th>
                <th style={{ padding: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>{t('admin.orders.changeStatus')}</th>
                <th style={{ padding: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>{t('admin.orders.date')}</th>
                <th style={{ padding: '1rem', textAlign: isRtl ? 'left' : 'right' }}>{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const isUpdating = updatingOrderId === o._id;
                const badgeStyle = getStatusBadgeStyle(o.status);

                return (
                  <tr key={o._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '1rem', fontWeight: '800', fontFamily: 'monospace', color: 'var(--color-espresso)' }}>
                      {o.orderCode}
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ fontWeight: '700' }}>{o.customer.fullName}</div>
                      <div style={{ fontSize: '0.78rem', color: '#666' }}>{o.customer.phone}</div>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <div>{t('confirmation.wilaya')} {o.customer.wilaya?.code} - {o.customer.wilaya?.name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#777', textTransform: 'uppercase' }}>
                        {String(o.customer.deliveryMethod).toLowerCase() === 'agency' ? t('checkout.agency') : t('checkout.home')}
                      </div>
                    </td>
                    <td style={{ padding: '1rem', fontWeight: '800' }}>
                      {formatCurrency(o.totalPrice)}
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                        <select
                          value={o.status}
                          onChange={(e) => handleQuickStatusChange(o._id, e.target.value)}
                          disabled={isUpdating}
                          style={{
                            padding: '0.35rem 0.7rem',
                            borderRadius: '6px',
                            fontWeight: '700',
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            outline: 'none',
                            ...badgeStyle
                          }}
                          title={t('admin.orders.changeStatus')}
                        >
                          {ORDER_STATUSES.map(st => (
                            <option key={st} value={st}>{getStatusLabel(st)}</option>
                          ))}
                        </select>
                        {isUpdating && <Loader2 size={13} className="animate-spin" color="var(--color-espresso)" />}
                      </div>
                    </td>
                    <td style={{ padding: '1rem', color: '#666', fontSize: '0.8rem' }}>
                      {new Date(o.createdAt).toLocaleDateString()} {new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: '1rem', textAlign: isRtl ? 'left' : 'right' }}>
                      <button
                        onClick={() => openOrderDetails(o._id)}
                        className="btn btn-secondary btn-sm"
                        style={{ padding: '0.4rem 0.8rem' }}
                      >
                        <Eye size={14} />
                        <span>{t('admin.orders.viewDetails')}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Order Details & Full Edit Modal */}
      {activeOrder && (
        <div style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem'
        }}>
          <div style={{
            backgroundColor: 'var(--color-surface)',
            borderRadius: 'var(--radius-xl)',
            maxWidth: '820px',
            width: '100%',
            maxHeight: '92vh',
            overflowY: 'auto',
            padding: '2rem',
            boxShadow: 'var(--shadow-lg)'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#777' }}>
                  Order Details & Edit
                </span>
                <h2 style={{ fontSize: '1.4rem', fontWeight: '800', fontFamily: 'monospace', color: 'var(--color-espresso)' }}>
                  #{activeOrder.orderCode}
                </h2>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <span style={{
                  padding: '0.35rem 0.75rem',
                  borderRadius: '6px',
                  fontWeight: '700',
                  fontSize: '0.82rem',
                  ...getStatusBadgeStyle(activeOrder.status)
                }}>
                  {activeOrder.status}
                </span>
                <button
                  onClick={() => setActiveOrder(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0.25rem' }}
                >
                  <X size={22} />
                </button>
              </div>
            </div>

            {feedback && (
              <div style={{
                backgroundColor: '#E8F5E9',
                color: 'var(--color-success)',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                marginBottom: '1.5rem',
                fontSize: '0.88rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <Check size={16} />
                <span>{feedback}</span>
              </div>
            )}

            {/* STATUS PIPELINE - Update to ANY status */}
            <div style={{
              backgroundColor: 'var(--color-bg-base)',
              padding: '1.25rem',
              borderRadius: 'var(--radius-lg)',
              marginBottom: '1.5rem',
              border: '1px solid var(--color-border)'
            }}>
              <h4 style={{ fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem', color: 'var(--color-espresso)' }}>
                Update Order Status
              </h4>

              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                {ORDER_STATUSES.map(st => {
                  const isActive = activeOrder.status === st;
                  const isDelivered = st === 'Delivered';
                  const isCancel = st === 'Cancelled';

                  return (
                    <button
                      key={st}
                      onClick={() => handleModalStatusChange(st)}
                      disabled={actionLoading}
                      className="btn btn-sm"
                      style={{
                        padding: '0.45rem 0.85rem',
                        fontWeight: isActive ? '800' : '600',
                        fontSize: '0.8rem',
                        backgroundColor: isActive
                          ? 'var(--color-espresso)'
                          : isDelivered
                            ? '#E8F5E9'
                            : isCancel
                              ? '#FFEBEE'
                              : 'var(--color-surface)',
                        color: isActive
                          ? '#FFF'
                          : isDelivered
                            ? '#2E7D32'
                            : isCancel
                              ? '#C62828'
                              : 'var(--color-text-main)',
                        border: isActive ? '1px solid var(--color-espresso)' : '1px solid var(--color-border)'
                      }}
                    >
                      {isActive && <Check size={13} style={{ marginRight: '0.25rem' }} />}
                      <span>{st}</span>
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="Add note for this status update (optional)..."
                  value={statusNote}
                  onChange={(e) => setStatusNote(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '0.45rem 0.75rem',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border)',
                    fontSize: '0.82rem',
                    backgroundColor: 'var(--color-surface)'
                  }}
                />
              </div>
            </div>

            {/* CUSTOMER & DELIVERY INFORMATION (EDITABLE) */}
            <div style={{
              backgroundColor: 'var(--color-bg-base)',
              padding: '1.25rem',
              borderRadius: 'var(--radius-lg)',
              marginBottom: '1.5rem',
              border: '1px solid var(--color-border)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h4 style={{ fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-espresso)' }}>
                  Customer & Delivery Details
                </h4>

                <button
                  onClick={() => setEditCustomerOpen(!editCustomerOpen)}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: '0.3rem 0.7rem', fontSize: '0.78rem' }}
                >
                  <Edit2 size={12} />
                  <span>{editCustomerOpen ? 'Cancel Edit' : 'Edit Order Details'}</span>
                </button>
              </div>

              {editCustomerOpen ? (
                <form onSubmit={handleSaveCustomer} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', marginBottom: '0.3rem' }}>Customer Full Name *</label>
                      <input
                        type="text"
                        required
                        value={editFullName}
                        onChange={(e) => setEditFullName(e.target.value)}
                        style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', marginBottom: '0.3rem' }}>Phone Number *</label>
                      <input
                        type="tel"
                        required
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', marginBottom: '0.3rem' }}>Wilaya (58 Wilayas) *</label>
                      <select
                        value={editWilayaCode}
                        onChange={(e) => handleWilayaOrMethodChange(e.target.value, editDeliveryMethod)}
                        style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: '#FFF' }}
                      >
                        {wilayasList.length > 0 ? (
                          wilayasList.map(w => (
                            <option key={w.code || w.wilayaCode} value={w.code || w.wilayaCode}>
                              {w.code || w.wilayaCode} - {w.name || w.wilayaName} ({w.nameAr || w.wilayaNameAr || ''})
                            </option>
                          ))
                        ) : (
                          <option value={activeOrder.customer.wilaya?.code || 16}>
                            {activeOrder.customer.wilaya?.code} - {activeOrder.customer.wilaya?.name}
                          </option>
                        )}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', marginBottom: '0.3rem' }}>Delivery Method *</label>
                      <select
                        value={editDeliveryMethod}
                        onChange={(e) => handleWilayaOrMethodChange(editWilayaCode, e.target.value)}
                        style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: '#FFF' }}
                      >
                        <option value="home">Home Delivery (À domicile)</option>
                        <option value="agency">Stop Desk / Agency Pickup (Au bureau)</option>
                      </select>
                    </div>
                  </div>

                  {editDeliveryMethod === 'home' ? (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', marginBottom: '0.3rem' }}>Home Delivery Address *</label>
                      <input
                        type="text"
                        required
                        value={editAddress}
                        onChange={(e) => setEditAddress(e.target.value)}
                        placeholder="Street, Building, Apartment, Commune..."
                        style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                      />
                    </div>
                  ) : (
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', marginBottom: '0.3rem' }}>Agency / Bureau Stop Desk Name *</label>
                      <input
                        type="text"
                        required
                        value={editAgencyName}
                        onChange={(e) => setEditAgencyName(e.target.value)}
                        placeholder="e.g. Yalidine Bureau Bab Ezzouar..."
                        style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                      />
                    </div>
                  )}

                  {deliveryFeeError && (
                    <div style={{ backgroundColor: '#FFEBEE', color: '#C62828', padding: '0.65rem', borderRadius: '6px', border: '1px solid #FFCDD2', fontSize: '0.8rem', fontWeight: '600' }}>
                      ⚠️ {deliveryFeeError}
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', marginBottom: '0.3rem' }}>
                        Authoritative Delivery Fee (DZD)
                      </label>
                      <div style={{
                        padding: '0.55rem',
                        backgroundColor: '#F8F9FA',
                        borderRadius: '6px',
                        border: '1px solid var(--color-border)',
                        fontWeight: '700',
                        color: editDeliveryFee !== null ? 'var(--color-espresso)' : '#D32F2F'
                      }}>
                        {editDeliveryFee !== null ? `${editDeliveryFee} DZD` : 'Not Configured'}
                      </div>
                      <span style={{ fontSize: '0.72rem', color: '#666' }}>
                        Determined authoritatively by server delivery configuration
                      </span>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', marginBottom: '0.3rem' }}>New Total Preview</label>
                      <div style={{ padding: '0.55rem', backgroundColor: '#FFF', borderRadius: '6px', border: '1px solid var(--color-border)', fontWeight: '800' }}>
                        {editDeliveryFee !== null ? `${(activeOrder.subtotal + Number(editDeliveryFee)).toLocaleString()} DZD` : 'N/A'}
                      </div>
                      <span style={{ fontSize: '0.72rem', color: '#666' }}>
                        Subtotal ({activeOrder.subtotal.toLocaleString()} DZD) + Delivery Fee
                      </span>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: '700', marginBottom: '0.3rem' }}>Customer Notes / Instructions</label>
                    <textarea
                      rows={2}
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Special delivery notes or client requests..."
                      style={{ width: '100%', padding: '0.55rem', borderRadius: '6px', border: '1px solid var(--color-border)' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => setEditCustomerOpen(false)}
                      className="btn btn-secondary btn-sm"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={actionLoading || !!deliveryFeeError || editDeliveryFee === null}
                      className="btn btn-primary btn-sm"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    >
                      {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      <span>Save Order Changes</span>
                    </button>
                  </div>
                </form>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.88rem' }}>
                  <div><strong>Full Name:</strong> {activeOrder.customer.fullName}</div>
                  <div><strong>Phone:</strong> <a href={`tel:${activeOrder.customer.phone}`} style={{ textDecoration: 'underline', color: 'var(--color-espresso)', fontWeight: '700' }}>{activeOrder.customer.phone}</a></div>
                  <div><strong>Delivery Mode:</strong> {String(activeOrder.customer.deliveryMethod).toLowerCase() === 'agency' ? 'Agency Stop Desk' : 'Home Delivery'}</div>
                  <div><strong>Wilaya:</strong> {activeOrder.customer.wilaya?.code} - {activeOrder.customer.wilaya?.name}</div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <strong>Destination Address:</strong> {activeOrder.customer.address || activeOrder.customer.agencyName || 'Not specified'}
                  </div>
                  {activeOrder.customer.notes && (
                    <div style={{ gridColumn: 'span 2', color: '#666', backgroundColor: '#FFF', padding: '0.5rem', borderRadius: '4px', border: '1px solid #EEE' }}>
                      <strong>Client Notes:</strong> {activeOrder.customer.notes}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Items Snapshot & Editor */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h4 style={{ fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', margin: 0, color: 'var(--color-espresso)' }}>
                  Order Items Snapshot
                </h4>
                {activeOrder.status !== 'Delivered' && activeOrder.status !== 'Cancelled' && (
                  <button
                    type="button"
                    onClick={() => editItemsOpen ? setEditItemsOpen(false) : handleOpenEditItems()}
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                  >
                    <Edit2 size={12} />
                    <span>{editItemsOpen ? 'Cancel Edit' : 'Edit Items'}</span>
                  </button>
                )}
              </div>

              {editItemsOpen ? (
                <form onSubmit={handleSaveItems} style={{ backgroundColor: '#FBF9F6', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', marginBottom: '1rem' }}>
                  {loadingProducts ? (
                    <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.85rem', color: '#666' }}>
                      <Loader2 size={18} className="animate-spin" style={{ display: 'inline', marginRight: '0.5rem' }} />
                      Loading product catalog...
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                      {editItemsList.map((item, idx) => {
                        const currentProd = availableProducts.find(p => p._id === item.productId) || availableProducts[0];
                        const availableColors = currentProd?.colors || [];
                        const currentColor = availableColors.find(c => c.colorName.toLowerCase() === item.colorName?.toLowerCase()) || availableColors[0];
                        const availableSizes = currentColor?.sizes || [];
                        const currentSizeObj = availableSizes.find(s => s.size === item.size);
                        const availableStock = currentSizeObj ? currentSizeObj.stock : 0;

                        return (
                          <div key={idx} style={{ backgroundColor: '#FFF', padding: '0.75rem', borderRadius: '6px', border: '1px solid #E0DCD6' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                              <span style={{ fontSize: '0.78rem', fontWeight: '700', color: 'var(--color-espresso)' }}>Line Item #{idx + 1}</span>
                              {editItemsList.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setEditItemsList(prev => prev.filter((_, i) => i !== idx))}
                                  style={{ color: '#D32F2F', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.72rem' }}
                                >
                                  <Trash2 size={12} />
                                  <span>Remove</span>
                                </button>
                              )}
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '0.5rem' }}>
                              {/* Product Select */}
                              <div>
                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', marginBottom: '0.2rem' }}>Product</label>
                                <select
                                  value={item.productId}
                                  onChange={(e) => {
                                    const newPId = e.target.value;
                                    const pObj = availableProducts.find(p => p._id === newPId);
                                    const firstColor = pObj?.colors?.[0];
                                    const firstSize = firstColor?.sizes?.[0];
                                    setEditItemsList(prev => prev.map((it, i) => i === idx ? {
                                      ...it,
                                      productId: newPId,
                                      productName: (typeof pObj?.name === 'object' ? (pObj?.name?.fr || pObj?.name?.en || pObj?.name?.ar || '') : (pObj?.name || '')),
                                      colorName: firstColor?.colorName || '',
                                      size: firstSize?.size || 'M',
                                      unitPrice: (pObj?.promotion?.active && pObj?.promotion?.promotionalPrice) ? pObj.promotion.promotionalPrice : (pObj?.sellingPrice || 0)
                                    } : it));
                                  }}
                                  style={{ width: '100%', padding: '0.45rem', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--color-border)' }}
                                >
                                  {availableProducts.filter(p => p.isActive && !p.isArchived).map(p => {
                                    const effPrice = (p.promotion?.active && p.promotion?.promotionalPrice) ? p.promotion.promotionalPrice : p.sellingPrice;
                                    const displayName = typeof p.name === 'object' ? (localized(p.name) || p.name?.fr || p.name?.en || '—') : (p.name || '—');
                                    return (
                                      <option key={p._id} value={p._id}>
                                        {displayName} ({effPrice.toLocaleString()} DZD{p.promotion?.active ? ' - PROMO' : ''})
                                      </option>
                                    );
                                  })}
                                </select>
                              </div>

                              {/* Color Select */}
                              <div>
                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', marginBottom: '0.2rem' }}>Color</label>
                                <select
                                  value={item.colorName}
                                  onChange={(e) => {
                                    const newCol = e.target.value;
                                    const cObj = availableColors.find(c => c.colorName === newCol);
                                    const firstSize = cObj?.sizes?.[0];
                                    setEditItemsList(prev => prev.map((it, i) => i === idx ? {
                                      ...it,
                                      colorName: newCol,
                                      size: firstSize?.size || it.size
                                    } : it));
                                  }}
                                  style={{ width: '100%', padding: '0.45rem', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--color-border)' }}
                                >
                                  {availableColors.map((c, cIdx) => (
                                    <option key={cIdx} value={c.colorName}>{c.colorName}</option>
                                  ))}
                                </select>
                              </div>

                              {/* Size Select */}
                              <div>
                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', marginBottom: '0.2rem' }}>
                                  Size <span style={{ color: availableStock > 0 ? '#2E7D32' : '#C62828', fontSize: '0.68rem' }}>({availableStock} in stock)</span>
                                </label>
                                <select
                                  value={item.size}
                                  onChange={(e) => {
                                    const newSz = e.target.value;
                                    setEditItemsList(prev => prev.map((it, i) => i === idx ? { ...it, size: newSz } : it));
                                  }}
                                  style={{ width: '100%', padding: '0.45rem', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--color-border)' }}
                                >
                                  {availableSizes.map((s, sIdx) => (
                                    <option key={sIdx} value={s.size}>{s.size} ({s.stock} avail)</option>
                                  ))}
                                </select>
                              </div>

                              {/* Quantity Input */}
                              <div>
                                <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: '600', marginBottom: '0.2rem' }}>Quantity</label>
                                <input
                                  type="number"
                                  min="1"
                                  step="1"
                                  required
                                  value={item.quantity}
                                  onChange={(e) => {
                                    const val = Math.max(1, parseInt(e.target.value) || 1);
                                    setEditItemsList(prev => prev.map((it, i) => i === idx ? { ...it, quantity: val } : it));
                                  }}
                                  style={{ width: '100%', padding: '0.45rem', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--color-border)' }}
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            if (availableProducts.length > 0) {
                              const p = availableProducts[0];
                              const c = p.colors?.[0];
                              const s = c?.sizes?.[0];
                              setEditItemsList(prev => [
                                ...prev,
                                {
                                  productId: p._id,
                                  productName: (typeof p.name === 'object' ? (p.name?.fr || p.name?.en || p.name?.ar || '') : (p.name || '')),
                                  colorName: c?.colorName || '',
                                  size: s?.size || 'M',
                                  quantity: 1,
                                  unitPrice: (p.promotion?.active && p.promotion?.promotionalPrice) ? p.promotion.promotionalPrice : (p.sellingPrice || 0)
                                }
                              ]);
                            }
                          }}
                          className="btn btn-secondary btn-sm"
                          style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem' }}
                        >
                          <Plus size={12} />
                          <span>Add Another Item</span>
                        </button>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: '700', marginBottom: '0.2rem' }}>Modification Reason</label>
                        <input
                          type="text"
                          value={editItemsReason}
                          onChange={(e) => setEditItemsReason(e.target.value)}
                          placeholder="e.g. Customer called to swap size from M to L..."
                          style={{ width: '100%', padding: '0.45rem', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--color-border)' }}
                        />
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={() => setEditItemsOpen(false)}
                          className="btn btn-secondary btn-sm"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={itemsActionLoading}
                          className="btn btn-primary btn-sm"
                          style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                        >
                          {itemsActionLoading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                          <span>Save Line Items</span>
                        </button>
                      </div>
                    </div>
                  )}
                </form>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {activeOrder.items.map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', backgroundColor: 'var(--color-bg-base)', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-md)' }}>
                      <img src={item.image} alt="" style={{ width: '40px', height: '52px', objectFit: 'cover', borderRadius: '4px' }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: '700', fontSize: '0.88rem' }}>
                          {typeof item.productName === 'object' ? (localized(item.productName) || item.productName?.fr || item.productName?.en || '—') : (item.productName || '—')}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#666' }}>Color: {item.colorName} • Size: {item.size} • Qty: {item.quantity}</div>
                      </div>
                      <div style={{ textAlign: 'right', fontSize: '0.88rem' }}>
                        <div style={{ fontWeight: '700' }}>{(item.unitPrice * item.quantity).toLocaleString()} DZD</div>
                        <div style={{ fontSize: '0.72rem', color: '#888' }}>Cost: {(item.unitCost * item.quantity).toLocaleString()} DZD</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.3rem',
                borderTop: '1px solid var(--color-border)',
                marginTop: '1rem',
                paddingTop: '0.75rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#666' }}>
                  <span>Items Subtotal:</span>
                  <span>{activeOrder.subtotal.toLocaleString()} DZD</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#666' }}>
                  <span>Delivery Fee:</span>
                  <span>{activeOrder.deliveryFee.toLocaleString()} DZD</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '800', fontSize: '1.1rem', color: 'var(--color-espresso)', borderTop: '1px dashed #CCC', paddingTop: '0.4rem', marginTop: '0.2rem' }}>
                  <span>Total Payable (COD):</span>
                  <span>{activeOrder.totalPrice.toLocaleString()} DZD</span>
                </div>
              </div>
            </div>

            {/* Audit History Timeline */}
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.75rem', fontSize: '0.85rem', fontWeight: '700' }}>
                <History size={16} />
                <span>Audit History & Lifecycle Trail</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '0.8rem', color: '#666' }}>
                {activeOrder.auditHistory?.map((entry, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #EEE', paddingBottom: '0.3rem' }}>
                    <div>
                      <strong style={{ color: 'var(--color-espresso)' }}>{entry.action}</strong>: {entry.note || 'No notes'}
                      <span style={{ fontSize: '0.72rem', color: '#999', marginLeft: '0.4rem' }}>({entry.performedBy})</span>
                    </div>
                    <div style={{ color: '#888' }}>
                      {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
