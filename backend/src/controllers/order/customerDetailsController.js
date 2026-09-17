import { Order } from '../../models/Order.js';
import { DeliverySetting } from '../../models/DeliverySetting.js';
import { ALGERIA_WILAYAS, DELIVERY_METHODS, ORDER_STATUS } from '../../config/constants.js';
import { normalizeAlgerianPhone } from '../../utils/phone.js';

// Admin: Edit customer details and delivery on order with strict validation & historical protection
export const updateOrderCustomerDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { fullName, phone, wilaya, address, agencyName, deliveryMethod, notes } = req.body;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Terminal order immutability
    const TERMINAL_STATES = [ORDER_STATUS.DELIVERED, ORDER_STATUS.RETURNED, ORDER_STATUS.CANCELLED];
    if (TERMINAL_STATES.includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: `Orders in ${order.status} state are fully locked. Historical financial values and customer details cannot be modified on ${order.status} orders.`
      });
    }

    const previousCustomer = { ...order.customer.toObject() };
    const previousDeliveryFee = order.deliveryFee;
    const previousTotalPrice = order.totalPrice;

    if (fullName) {
      if (typeof fullName !== 'string' || fullName.trim().length < 2) {
        return res.status(400).json({ success: false, message: 'Full name must be at least 2 characters.' });
      }
      order.customer.fullName = fullName.trim();
    }

    // Phone normalization and strict validation
    if (phone) {
      try {
        order.customer.phone = normalizeAlgerianPhone(phone);
      } catch (phoneErr) {
        return res.status(400).json({ success: false, message: phoneErr.message });
      }
    }

    if (notes !== undefined) {
      if (typeof notes === 'string' && notes.length > 500) {
        return res.status(400).json({ success: false, message: 'Notes cannot exceed 500 characters.' });
      }
      order.customer.notes = notes ? notes.trim() : '';
    }

    let wilayaOrMethodChanged = false;

    // Strict Wilaya validation
    if (wilaya) {
      const code = typeof wilaya === 'object' ? wilaya.code : wilaya;
      const name = typeof wilaya === 'object' ? (wilaya.name || '') : String(wilaya);
      const codeNum = Number(code);

      const canonicalWilaya = ALGERIA_WILAYAS.find(w => w.code === codeNum);
      if (!canonicalWilaya) {
        return res.status(400).json({
          success: false,
          message: `Invalid Wilaya code: ${code}. Must be a canonical Algerian Wilaya between 1 and 58.`
        });
      }

      if (name && typeof name === 'string' && name.trim()) {
        const normEn = (s) => s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const normAr = (s) => s.trim().replace(/[إأآا]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
        const normNameEn = normEn(name);
        const normCanonEn = normEn(canonicalWilaya.name);
        const matchesEn = normCanonEn === normNameEn || (codeNum === 16 && (normNameEn === 'alger' || normNameEn === 'algiers'));
        const matchesAr = canonicalWilaya.nameAr === name.trim() || normAr(canonicalWilaya.nameAr) === normAr(name);
        if (!matchesEn && !matchesAr) {
          return res.status(400).json({
            success: false,
            message: `Wilaya mismatch: code ${codeNum} is "${canonicalWilaya.name}", but received "${name}".`
          });
        }
      }

      if (order.customer.wilaya?.code !== canonicalWilaya.code) {
        order.customer.wilaya = { code: canonicalWilaya.code, name: canonicalWilaya.name };
        wilayaOrMethodChanged = true;
      }
    }

    // Strict Delivery Method validation
    if (deliveryMethod !== undefined) {
      const normMethod = String(deliveryMethod).toLowerCase().trim();
      if (normMethod !== DELIVERY_METHODS.AGENCY && normMethod !== DELIVERY_METHODS.HOME) {
        return res.status(400).json({
          success: false,
          message: 'Invalid delivery method. Must be "agency" or "home".'
        });
      }

      if (normMethod === DELIVERY_METHODS.HOME) {
        const currentAddress = address !== undefined ? address : order.customer.address;
        if (!currentAddress || typeof currentAddress !== 'string' || currentAddress.trim().length < 4) {
          return res.status(400).json({
            success: false,
            message: 'Detailed home address is required for home delivery (min 4 characters).'
          });
        }
      }

      if (order.customer.deliveryMethod !== normMethod) {
        order.customer.deliveryMethod = normMethod;
        wilayaOrMethodChanged = true;
      }
    }

    if (address !== undefined) order.customer.address = address ? address.trim() : '';
    if (agencyName !== undefined) order.customer.agencyName = agencyName ? agencyName.trim() : '';

    if (wilayaOrMethodChanged) {
      const deliverySetting = await DeliverySetting.getSingleton();
      if (!deliverySetting) {
        return res.status(400).json({
          success: false,
          message: 'Delivery configuration not initialized. Cannot calculate delivery fee.'
        });
      }

      const targetCode = Number(order.customer.wilaya?.code);
      const wilayaRate = deliverySetting.wilayaRates?.find(r => r.wilayaCode === targetCode);
      if (!wilayaRate) {
        return res.status(400).json({
          success: false,
          message: `Delivery configuration missing for Wilaya ${targetCode} (${order.customer.wilaya?.name}).`
        });
      }

      if (wilayaRate.isAvailable === false) {
        return res.status(400).json({
          success: false,
          message: `Selected Wilaya ${targetCode} is currently marked unavailable for delivery.`
        });
      }

      const isAgency = order.customer.deliveryMethod === DELIVERY_METHODS.AGENCY;
      const authoritativeFee = isAgency ? wilayaRate.agencyFee : wilayaRate.homeFee;

      if (typeof authoritativeFee !== 'number' || !Number.isInteger(authoritativeFee) || authoritativeFee < 0) {
        return res.status(400).json({
          success: false,
          message: `Authoritative delivery fee is not configured for Wilaya ${targetCode} with method "${order.customer.deliveryMethod}".`
        });
      }

      let newFee = authoritativeFee;
      if (deliverySetting.freeDeliveryThreshold && deliverySetting.freeDeliveryThreshold > 0 && order.subtotal >= deliverySetting.freeDeliveryThreshold) {
        newFee = 0;
      }

      order.deliveryFee = newFee;
      order.totalPrice = order.subtotal + newFee;
    }

    if (order.customer.deliveryMethod === DELIVERY_METHODS.AGENCY) {
      if (!order.customer.agencyName || typeof order.customer.agencyName !== 'string' || order.customer.agencyName.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Agency name is required for agency delivery (min 2 characters).'
        });
      }
    }

    const feeChanged = previousDeliveryFee !== order.deliveryFee;
    const auditEntry = {
      action: 'CUSTOMER_INFO_UPDATED',
      timestamp: new Date(),
      performedBy: req.admin?.username || 'Admin',
      note: feeChanged
        ? `Owner/Admin updated delivery destination/method. Authoritative fee updated from ${previousDeliveryFee} to ${order.deliveryFee} DZD (Delivery: ${order.customer.deliveryMethod}, Wilaya: ${order.customer.wilaya?.name}).`
        : `Owner/Admin updated order customer info (Delivery: ${order.customer.deliveryMethod}, Wilaya: ${order.customer.wilaya?.name}, Fee: ${order.deliveryFee} DZD).`,
      details: {
        previousCustomer,
        updatedCustomer: order.customer,
        previousDeliveryFee,
        updatedDeliveryFee: order.deliveryFee,
        feeChanged,
        previousTotalPrice,
        updatedTotalPrice: order.totalPrice
      }
    };

    let expectedVersion;
    if (req.body.expectedVersion !== undefined) {
      const rv = req.body.expectedVersion;
      if (
        typeof rv !== 'number' ||
        !Number.isFinite(rv) ||
        !Number.isInteger(rv) ||
        rv < 0
      ) {
        return res.status(400).json({
          success: false,
          message: 'expectedVersion must be a finite non-negative integer.'
        });
      }
      expectedVersion = rv;
    } else {
      expectedVersion = order.__v;
    }

    const casQuery = {
      _id: order._id,
      __v: expectedVersion
    };

    if (wilayaOrMethodChanged) {
      casQuery.status = { $nin: [ORDER_STATUS.DELIVERED, ORDER_STATUS.RETURNED, ORDER_STATUS.CANCELLED] };
    }

    const casUpdate = {
      $set: {
        customer: order.customer,
        deliveryFee: order.deliveryFee,
        totalPrice: order.totalPrice
      },
      $inc: { __v: 1 },
      $push: { auditHistory: auditEntry }
    };

    const updatedOrder = await Order.findOneAndUpdate(casQuery, casUpdate, { new: true });

    if (!updatedOrder) {
      const latestOrder = await Order.findById(id);
      if (latestOrder && latestOrder.status === ORDER_STATUS.DELIVERED && wilayaOrMethodChanged) {
        return res.status(400).json({
          success: false,
          message: 'Historical financial values (delivery fee, subtotal, total) cannot be modified on Delivered orders.'
        });
      }

      return res.status(409).json({
        success: false,
        code: 'CONCURRENT_CONFLICT',
        message: 'CONCURRENT_CONFLICT: Order was modified concurrently. Please refresh and retry.'
      });
    }

    res.json({ success: true, order: updatedOrder });
  } catch (error) {
    next(error);
  }
};
