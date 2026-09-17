import { Order } from '../../models/Order.js';
import { ORDER_STATUS, VALID_STATUS_TRANSITIONS } from '../../config/constants.js';
import { deductStockAtomic, restoreStockAtomic } from '../inventoryService.js';
import { wsService } from '../websocketService.js';
import { withTransactionRetry } from '../../utils/transactionRetry.js';

/**
 * Atomically transition order status using a MongoDB multi-document transaction.
 *
 * INVARIANTS:
 *   - Order state change AND all inventory operations are wrapped in a single
 *     MongoDB session/transaction. They either ALL commit or ALL abort.
 *   - No partial inventory state can survive a failure.
 *   - Exactly ONE stock restoration per order when entering Cancelled/Returned.
 *   - Exactly ONE stock deduction per order when leaving Cancelled/Returned.
 *   - Concurrent duplicate requests: exactly one CAS wins; others get CONCURRENT_CONFLICT.
 *   - Delivered orders are TERMINAL — no transition possible, even with override.
 *   - Override requires explicit override=true AND non-empty overrideReason.
 *   - Every override is recorded in auditHistory with the reason.
 */
export async function updateOrderStatus(
  orderId,
  newStatus,
  adminUsername = 'Admin',
  note = '',
  isOverride = false,
  overrideReason = ''
) {
  const validStatuses = Object.values(ORDER_STATUS);
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid order status "${newStatus}". Must be one of: ${validStatuses.join(', ')}`);
  }

  // Validate override parameters up-front
  if (isOverride) {
    if (!overrideReason || typeof overrideReason !== 'string' || overrideReason.trim().length === 0) {
      throw new Error('OVERRIDE_REQUIRES_REASON: A non-empty overrideReason is required for manual status overrides.');
    }
  }

  // ─── PRE-FLIGHT: Fast read outside session for early validation ───────────────
  const preflight = await Order.findById(orderId);
  if (!preflight) {
    throw new Error('Order not found');
  }

  const currentStatus = preflight.status;

  // HARD INVARIANT: Delivered is a terminal state — no override can change this
  if (currentStatus === ORDER_STATUS.DELIVERED) {
    throw new Error('Cannot transition order: Terminal state violation: Delivered orders cannot be transitioned.');
  }

  if (currentStatus === newStatus && !isOverride) {
    throw new Error(`Cannot transition order: Order is already in status "${newStatus}"`);
  }

  // Validate state machine unless admin override
  if (!isOverride) {
    const allowedTransitions = VALID_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowedTransitions.includes(newStatus)) {
      throw new Error(`Cannot transition order from status "${currentStatus}" to "${newStatus}"`);
    }
  }

  // ─── Determine inventory operation required (needed before choosing tx strategy) ─
  const isEnteringRestoredState = newStatus === ORDER_STATUS.CANCELLED || newStatus === ORDER_STATUS.RETURNED;
  const isLeavingRestoredState = (
    currentStatus === ORDER_STATUS.CANCELLED || currentStatus === ORDER_STATUS.RETURNED
  ) && !isEnteringRestoredState;

  // Use pre-flight values as early signal; definitive check is inside transaction
  const mayNeedRestore = isEnteringRestoredState && !preflight.stockRestored;
  const mayNeedDeduct  = isLeavingRestoredState  && preflight.stockRestored;
  const needsTransaction = mayNeedRestore || mayNeedDeduct;

  let updatedOrder = null;

  if (needsTransaction) {
    // ─── TRANSACTION PATH: inventory-touching transition (WITH BOUNDED RETRY) ───
    updatedOrder = await withTransactionRetry(async (session, attempt) => {
      const sessionOpt = session ? { session } : {};

      // Re-read inside transaction to establish a consistent read snapshot.
      const orderInTx = await Order.findById(orderId, null, sessionOpt);
      if (!orderInTx) {
        throw new Error('Order not found');
      }

      // Re-check terminal state inside transaction
      if (orderInTx.status === ORDER_STATUS.DELIVERED) {
        throw new Error('Cannot transition order: Terminal state violation: Delivered orders cannot be transitioned.');
      }

      // Re-check idempotency inside transaction
      if (orderInTx.status === newStatus && !isOverride) {
        throw new Error(`Cannot transition order: Order is already in status "${newStatus}"`);
      }

      // Re-validate state machine inside transaction
      if (!isOverride) {
        const allowedTx = VALID_STATUS_TRANSITIONS[orderInTx.status] || [];
        if (!allowedTx.includes(newStatus)) {
          throw new Error(`Cannot transition order from status "${orderInTx.status}" to "${newStatus}"`);
        }
      }

      const txCurrentStatus = orderInTx.status;

      // Definitively determine inventory op (inside tx, using authoritative data)
      const txIsEntering = newStatus === ORDER_STATUS.CANCELLED || newStatus === ORDER_STATUS.RETURNED;
      const txIsLeaving  = (txCurrentStatus === ORDER_STATUS.CANCELLED || txCurrentStatus === ORDER_STATUS.RETURNED) && !txIsEntering;
      const needsRestore = txIsEntering && !orderInTx.stockRestored;
      const needsDeduct  = txIsLeaving  && orderInTx.stockRestored;

      const auditEntry = {
        action: isOverride ? 'STATUS_OVERRIDE' : 'STATUS_CHANGED',
        timestamp: new Date(),
        performedBy: adminUsername,
        note: note || (isOverride
          ? `Owner/Admin manually overrode status from ${txCurrentStatus} to ${newStatus}. Reason: ${overrideReason.trim()}`
          : `Owner/Admin updated status from ${txCurrentStatus} to ${newStatus}`
        ),
        details: {
          previousStatus: txCurrentStatus,
          newStatus,
          ...(isOverride ? { isOverride: true, overrideReason: overrideReason.trim() } : {})
        }
      };

      const casQuery = {
        _id: orderInTx._id,
        __v: orderInTx.__v,
        status: txCurrentStatus
      };
      if (needsRestore) casQuery.stockRestored = false;
      else if (needsDeduct) casQuery.stockRestored = true;

      const casUpdate = {
        $set: {
          status: newStatus,
          ...(needsRestore ? { stockRestored: true }  : {}),
          ...(needsDeduct  ? { stockRestored: false } : {})
        },
        $inc: { __v: 1 },
        $push: { auditHistory: auditEntry }
      };

      const res = await Order.findOneAndUpdate(casQuery, casUpdate, {
        new: true,
        ...sessionOpt
      });

      if (!res) {
        throw new Error('CONCURRENT_CONFLICT: Order was modified concurrently. Please retry.');
      }

      // ─── INVENTORY OPERATIONS (inside the same transaction) ─────────────────
      if (needsRestore) {
        console.log(`[OrderService] [TX] Restoring stock for ${newStatus.toLowerCase()} order ${res.orderCode}`);
        await restoreStockAtomic(res.items, session);
      } else if (needsDeduct) {
        console.log(`[OrderService] [TX] Re-deducting stock for reactivated order ${res.orderCode}`);
        await deductStockAtomic(res.items, session);
      }

      console.log(`[OrderService] [TX] Committed on attempt ${attempt}: order ${res.orderCode} → ${newStatus}`);
      return res;
    });

  } else {
    // ─── NON-TRANSACTION PATH: pure status change (no inventory involved) ───────
    const casQuery = {
      _id: preflight._id,
      __v: preflight.__v,
      status: currentStatus
    };

    const auditEntry = {
      action: isOverride ? 'STATUS_OVERRIDE' : 'STATUS_CHANGED',
      timestamp: new Date(),
      performedBy: adminUsername,
      note: note || (isOverride
        ? `Owner/Admin manually overrode status from ${currentStatus} to ${newStatus}. Reason: ${overrideReason.trim()}`
        : `Owner/Admin updated status from ${currentStatus} to ${newStatus}`
      ),
      details: {
        previousStatus: currentStatus,
        newStatus,
        ...(isOverride ? { isOverride: true, overrideReason: overrideReason.trim() } : {})
      }
    };

    const casUpdate = {
      $set: { status: newStatus },
      $inc: { __v: 1 },
      $push: { auditHistory: auditEntry }
    };

    updatedOrder = await Order.findOneAndUpdate(casQuery, casUpdate, { new: true });

    if (!updatedOrder) {
      throw new Error('CONCURRENT_CONFLICT: Order was modified concurrently. Please retry.');
    }

    console.log(`[OrderService] [CAS] Updated: order ${updatedOrder.orderCode} → ${newStatus}`);
  }

  // ─── POST-COMMIT: WebSocket broadcast (non-fatal) ──────────────────────────
  try {
    wsService.broadcastOrderStatus(updatedOrder.orderCode, newStatus, {
      customerName: updatedOrder.customer.fullName,
      updatedAt: updatedOrder.updatedAt
    });
  } catch (wsErr) {
    console.warn(`[OrderService] WebSocket broadcast failed (non-fatal): ${wsErr.message}`);
  }

  return updatedOrder;
}
