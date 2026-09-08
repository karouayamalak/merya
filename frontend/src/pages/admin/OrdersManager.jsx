import React, { useState, useEffect } from 'react';
import {
  Search,
  Filter,
  Eye,
  CheckCircle,
  Truck,
  Building2,
  PackageCheck,
  XCircle,
  Clock,
  User,
  Phone,
  MapPin,
  Calendar,
  History,
  Edit2,
  X,
  Loader2
} from 'lucide-react';
import { adminGetOrders, adminGetOrderById, adminUpdateOrderStatus, adminUpdateCustomerDetails } from '../../services/api';

export default function OrdersManager() {
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);

  // Active modal order
  const [activeOrder, setActiveOrder] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [editCustomerOpen, setEditCustomerOpen] = useState(false);
  const [statusNote, setStatusNote] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState('');

  // Editable customer state
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');

  const loadOrders = async () => {
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
  };

  useEffect(() => {
    const timer = setTimeout(loadOrders, 250);
    return () => clearTimeout(timer);
  }, [search, statusFilter]);

  const openOrderDetails = async (orderId) => {
    setLoadingDetails(true);
    setFeedback('');
    try {
      const res = await adminGetOrderById(orderId);
      if (res.success) {
        setActiveOrder(res.order);
        setEditFullName(res.order.customer.fullName);
        setEditPhone(res.order.customer.phone);
        setEditAddress(res.order.customer.address || res.order.customer.agencyName || '');
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    if (!activeOrder) return;
    if (newStatus === 'Cancelled') {
      const ok = window.confirm('Are you sure you want to cancel this order? Reserved inventory stock will be restored automatically.');
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
        loadOrders();
      }
    } catch (err) {
      alert(err.message || 'Status transition failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveCustomer = async (e) => {
    e.preventDefault();
    if (!activeOrder) return;

    setActionLoading(true);
    try {
      const res = await adminUpdateCustomerDetails(activeOrder._id, {
        fullName: editFullName,
        phone: editPhone,
        address: activeOrder.customer.deliveryMethod === 'home' ? editAddress : undefined,
        agencyName: activeOrder.customer.deliveryMethod === 'agency' ? editAddress : undefined
      });

      if (res.success) {
        setActiveOrder(res.order);
        setEditCustomerOpen(false);
        setFeedback('Customer details updated and logged in audit history!');
        loadOrders();
      }
    } catch (err) {
      alert(err.message || 'Failed to update customer details');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 className="heading-display" style={{ fontSize: '1.8rem', color: 'var(--color-espresso)' }}>
            ORDERS MANAGEMENT
          </h1>
          <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.2rem' }}>
            Authoritative order processing, customer contact, and delivery lifecycle.
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
          <Search size={18} color="#888" style={{ marginRight: '0.5rem' }} />
          <input
            type="text"
            placeholder="Search by code (MD-...), customer, or phone..."
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
          <option value="">All Statuses</option>
          <option value="Pending">Pending (En attente)</option>
          <option value="Confirmed">Confirmed (Confirmée)</option>
          <option value="On the way">On the way (En livraison)</option>
          <option value="At agency">At agency (Au bureau)</option>
          <option value="Delivered">Delivered (Livrée)</option>
          <option value="Cancelled">Cancelled (Annulée)</option>
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
            <p>No orders matching your search filters.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--color-bg-card)', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>Order Code</th>
                <th style={{ padding: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>Customer</th>
                <th style={{ padding: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>Destination</th>
                <th style={{ padding: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>Total (COD)</th>
                <th style={{ padding: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>Status</th>
                <th style={{ padding: '1rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem' }}>Date</th>
                <th style={{ padding: '1rem', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o._id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '1rem', fontWeight: '800', fontFamily: 'monospace', color: 'var(--color-espresso)' }}>
                    {o.orderCode}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <div style={{ fontWeight: '700' }}>{o.customer.fullName}</div>
                    <div style={{ fontSize: '0.78rem', color: '#666' }}>{o.customer.phone}</div>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <div>Wilaya {o.customer.wilaya?.code} - {o.customer.wilaya?.name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#777', textTransform: 'uppercase' }}>
                      {o.customer.deliveryMethod === 'agency' ? 'Agency Pickup' : 'Home Delivery'}
                    </div>
                  </td>
                  <td style={{ padding: '1rem', fontWeight: '800' }}>
                    {o.totalPrice.toLocaleString()} DZD
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span className={`badge badge-${o.status.toLowerCase().replace(/\s+/g, '')}`}>
                      {o.status}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', color: '#666', fontSize: '0.8rem' }}>
                    {new Date(o.createdAt).toLocaleDateString()} {new Date(o.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right' }}>
                    <button
                      onClick={() => openOrderDetails(o._id)}
                      className="btn btn-secondary btn-sm"
                      style={{ padding: '0.4rem 0.8rem' }}
                    >
                      <Eye size={14} />
                      <span>Details</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Order Details & Transition Modal */}
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
            maxWidth: '750px',
            width: '100%',
            maxHeight: '90vh',
            overflowY: 'auto',
            padding: '2rem',
            boxShadow: 'var(--shadow-lg)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.5rem',
            position: 'relative'
          }}>
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--color-border)', paddingBottom: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: '800' }}>Order #{activeOrder.orderCode}</h2>
                  <span className={`badge badge-${activeOrder.status.toLowerCase().replace(/\s+/g, '')}`}>
                    {activeOrder.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.2rem' }}>
                  Placed on {new Date(activeOrder.createdAt).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => setActiveOrder(null)}
                style={{ padding: '0.4rem', color: '#666' }}
              >
                <X size={22} />
              </button>
            </div>

            {feedback && (
              <div style={{
                backgroundColor: '#E8F5E9',
                color: 'var(--color-success)',
                padding: '0.75rem 1rem',
                borderRadius: 'var(--radius-md)',
                fontSize: '0.85rem'
              }}>
                {feedback}
              </div>
            )}

            {/* Customer Details Box */}
            <div style={{
              backgroundColor: 'var(--color-bg-base)',
              padding: '1.25rem',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                <h4 style={{ fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Customer & Delivery Information
                </h4>
                <button
                  onClick={() => setEditCustomerOpen(!editCustomerOpen)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.78rem', color: 'var(--color-primary-dark)', fontWeight: '700' }}
                >
                  <Edit2 size={13} />
                  <span>{editCustomerOpen ? 'Cancel Edit' : 'Edit Customer'}</span>
                </button>
              </div>

              {editCustomerOpen ? (
                <form onSubmit={handleSaveCustomer} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <input
                    type="text"
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    placeholder="Full Name"
                    style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #CCC' }}
                  />
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="Phone"
                    style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #CCC' }}
                  />
                  <input
                    type="text"
                    value={editAddress}
                    onChange={(e) => setEditAddress(e.target.value)}
                    placeholder="Address / Agency Hub"
                    style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #CCC' }}
                  />
                  <button type="submit" disabled={actionLoading} className="btn btn-primary btn-sm">
                    Save Changes
                  </button>
                </form>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.85rem' }}>
                  <div><strong>Name:</strong> {activeOrder.customer.fullName}</div>
                  <div><strong>Phone:</strong> <a href={`tel:${activeOrder.customer.phone}`} style={{ textDecoration: 'underline' }}>{activeOrder.customer.phone}</a></div>
                  <div><strong>Method:</strong> {activeOrder.customer.deliveryMethod === 'agency' ? 'Agency Pickup' : 'Home Delivery'}</div>
                  <div><strong>Wilaya:</strong> {activeOrder.customer.wilaya?.name}</div>
                  <div style={{ gridColumn: 'span 2' }}>
                    <strong>Address / Bureau:</strong> {activeOrder.customer.address || activeOrder.customer.agencyName || 'Not specified'}
                  </div>
                  {activeOrder.customer.notes && (
                    <div style={{ gridColumn: 'span 2', color: '#666' }}>
                      <strong>Notes:</strong> {activeOrder.customer.notes}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Items Snapshot */}
            <div>
              <h4 style={{ fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem' }}>
                Order Items Snapshot
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {activeOrder.items.map((item, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', backgroundColor: 'var(--color-bg-base)', padding: '0.6rem 0.85rem', borderRadius: 'var(--radius-md)' }}>
                    <img src={item.image} alt="" style={{ width: '40px', height: '52px', objectFit: 'cover', borderRadius: '4px' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '700', fontSize: '0.88rem' }}>{item.productName}</div>
                      <div style={{ fontSize: '0.78rem', color: '#666' }}>Color: {item.colorName} • Size: {item.size} • Qty: {item.quantity}</div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '0.88rem' }}>
                      <div style={{ fontWeight: '700' }}>{(item.unitPrice * item.quantity).toLocaleString()} DZD</div>
                      <div style={{ fontSize: '0.72rem', color: '#888' }}>Cost: {(item.unitCost * item.quantity).toLocaleString()} DZD</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--color-border)', marginTop: '1rem', paddingTop: '0.75rem', fontWeight: '800' }}>
                <span>Total COD Amount:</span>
                <span>{activeOrder.totalPrice.toLocaleString()} DZD</span>
              </div>
            </div>

            {/* Order Status Action Buttons */}
            {activeOrder.status !== 'Delivered' && activeOrder.status !== 'Cancelled' && (
              <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '1.25rem' }}>
                <h4 style={{ fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.75rem' }}>
                  Update Order Pipeline Status
                </h4>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {activeOrder.status === 'Pending' && (
                    <button
                      onClick={() => handleStatusChange('Confirmed')}
                      disabled={actionLoading}
                      className="btn btn-primary btn-sm"
                    >
                      <CheckCircle size={14} />
                      <span>Confirm Order</span>
                    </button>
                  )}

                  {activeOrder.status === 'Confirmed' && (
                    <button
                      onClick={() => handleStatusChange('On the way')}
                      disabled={actionLoading}
                      className="btn btn-primary btn-sm"
                    >
                      <Truck size={14} />
                      <span>Mark On The Way</span>
                    </button>
                  )}

                  {activeOrder.status === 'On the way' && activeOrder.customer.deliveryMethod === 'agency' && (
                    <button
                      onClick={() => handleStatusChange('At agency')}
                      disabled={actionLoading}
                      className="btn btn-taupe btn-sm"
                    >
                      <Building2 size={14} />
                      <span>Arrived at Agency</span>
                    </button>
                  )}

                  {(activeOrder.status === 'On the way' || activeOrder.status === 'At agency') && (
                    <button
                      onClick={() => handleStatusChange('Delivered')}
                      disabled={actionLoading}
                      className="btn btn-primary btn-sm"
                      style={{ backgroundColor: 'var(--color-success)' }}
                    >
                      <PackageCheck size={14} />
                      <span>Mark Delivered (Realizes Profit)</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleStatusChange('Cancelled')}
                    disabled={actionLoading}
                    className="btn btn-secondary btn-sm"
                    style={{ borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}
                  >
                    <XCircle size={14} />
                    <span>Cancel Order (Restores Stock)</span>
                  </button>
                </div>
              </div>
            )}

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
