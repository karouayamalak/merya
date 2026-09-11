import { Product } from '../models/Product.js';
import { InventoryAdjustment } from '../models/InventoryAdjustment.js';
import { withTransactionRetry } from '../utils/transactionRetry.js';

export { InventoryAdjustment };

/**
 * Atomically deduct stock for multiple items.
 *
 * When `session` is provided every Product operation runs inside that session,
 * making it part of the caller's MongoDB transaction.  If any variant has
 * insufficient stock the function throws; the caller is responsible for
 * aborting the transaction (no manual compensating rollback is performed here
 * when a session is active, because `abortTransaction` undoes everything).
 *
 * When `session` is NOT provided (e.g. the legacy checkout path) the function
 * performs its own per-item compensating rollback for backward compatibility.
 *
 * @param {Array}           items   - Order items with { productId, colorName, size, quantity }
 * @param {ClientSession}  [session] - Optional Mongoose/MongoDB session
 * @returns {{ success: true, count: number }}
 * @throws  Error if any item has insufficient stock or variant is not found
 */
export async function deductStockAtomic(items, session = null) {
  // Track deductions only when running WITHOUT a session (compensating rollback path)
  const deductionsMade = [];

  for (const item of items) {
    const { productId, colorName, size, quantity } = item;

    // Atomic conditional update: only decrement if current stock >= quantity
    const queryOpts = session ? { session, new: true } : { new: true };

    const updated = await Product.findOneAndUpdate(
      {
        _id: productId,
        isActive: true,
        isArchived: false,
        colors: {
          $elemMatch: {
            colorName: colorName,
            sizes: {
              $elemMatch: {
                size: size,
                stock: { $gte: quantity }
              }
            }
          }
        }
      },
      {
        $inc: {
          'colors.$[c].sizes.$[s].stock': -quantity
        }
      },
      {
        ...queryOpts,
        arrayFilters: [
          { 'c.colorName': colorName },
          { 's.size': size }
        ]
      }
    );

    if (!updated) {
      if (session) {
        // Transaction caller will abortTransaction() — no manual rollback
        throw new Error(`Insufficient stock for item: ${colorName} - Size ${size}`);
      }

      // Non-session path: roll back previous deductions made in this batch
      console.warn(`[Inventory] Insufficient stock for ${productId} / ${colorName} / ${size}. Rolling back.`);
      for (const ded of deductionsMade) {
        await Product.updateOne(
          { _id: ded.productId },
          { $inc: { 'colors.$[c].sizes.$[s].stock': ded.quantity } },
          { arrayFilters: [{ 'c.colorName': ded.colorName }, { 's.size': ded.size }] }
        );
      }
      throw new Error(`Insufficient stock for item: ${colorName} - Size ${size}`);
    }

    deductionsMade.push({ productId, colorName, size, quantity });
  }

  return { success: true, count: deductionsMade.length };
}

/**
 * Restore (increment) stock for multiple items.
 *
 * When `session` is provided every Product operation runs inside that session.
 * If the product/variant is not found the function throws immediately so the
 * caller's transaction can abort cleanly — no partial state is left.
 *
 * @param {Array}           items   - Order items with { productId, colorName, size, quantity }
 * @param {ClientSession}  [session] - Optional Mongoose/MongoDB session
 * @returns {{ success: true }}
 * @throws  Error if a variant cannot be matched (matchedCount === 0)
 */
export async function restoreStockAtomic(items, session = null) {
  for (const item of items) {
    const { productId, colorName, size, quantity } = item;

    const updateOpts = session
      ? {
          arrayFilters: [{ 'c.colorName': colorName }, { 's.size': size }],
          session
        }
      : {
          arrayFilters: [{ 'c.colorName': colorName }, { 's.size': size }]
        };

    const result = await Product.updateOne(
      {
        _id: productId,
        'colors.colorName': colorName,
        'colors.sizes.size': size
      },
      {
        $inc: {
          'colors.$[c].sizes.$[s].stock': quantity
        }
      },
      updateOpts
    );

    // Guard: treat a zero-match as a hard error so callers cannot silently
    // restore stock into a non-existent variant.
    if (result.matchedCount === 0) {
      throw new Error(
        `[Inventory] restoreStockAtomic: product/variant not found — ` +
        `productId=${productId}, color=${colorName}, size=${size}`
      );
    }
  }

  return { success: true };
}

/**
 * Adjust stock to a specific number (Admin function, not part of order lifecycle).
 * Authoritative point for manual inventory adjustments.
 *
 * Uses optimistic concurrency control: reads the current product `__v` and
 * previousStock, then performs a conditional findOneAndUpdate that also
 * checks `__v` and increments it on success.  If another admin has written
 * concurrently the `__v` will have changed, the update will match no document,
 * and the function throws a CONCURRENT_CONFLICT error (the controller maps
 * this to HTTP 409).
 *
 * @param {string} productId
 * @param {string} colorName
 * @param {string} size
 * @param {number} newStock
 * @param {string} [admin='Admin']
 * @param {string} [reason='']
 * @returns {Promise<Product>} Updated product document with _adjustment metadata
 * @throws  Error('CONCURRENT_CONFLICT') if the product was modified concurrently
 */
export async function setStockAtomic(productId, colorName, size, newStock, admin = 'Admin', reason = '') {
  if (typeof newStock !== 'number' || !Number.isFinite(newStock) || newStock < 0) {
    throw new Error('Stock cannot be negative');
  }

  // ── Read phase (Optimistic Concurrency Baseline) ───────────────────────────
  // Capture the current __v and previousStock BEFORE entering transaction.
  // This ensures concurrent writes from different admins detect version drift (409)
  // instead of silently re-reading and overwriting newer changes on retry.
  const existingProduct = await Product.findById(productId);
  if (!existingProduct) {
    throw new Error('Product not found');
  }

  const colorObj = existingProduct.colors?.find(c => c.colorName === colorName);
  if (!colorObj) {
    throw new Error(`Color "${colorName}" not found on product`);
  }

  const sizeObj = colorObj.sizes?.find(s => s.size === size);
  if (!sizeObj) {
    throw new Error(`Size "${size}" not found in color "${colorName}"`);
  }

  const previousStock = sizeObj.stock;
  const expectedVersion = existingProduct.__v;

  return await withTransactionRetry(async (session) => {
    const sessionOpt = session ? { session } : {};

    // ── Write phase (CAS on __v) ─────────────────────────────────────────────────
    // The update only executes if __v still matches what we read.
    // $inc: { __v: 1 } ensures the next concurrent caller will see a different
    // version and must retry / receive a 409 instead of silently overwriting.
    const updated = await Product.findOneAndUpdate(
      {
        _id: productId,
        __v: expectedVersion,          // optimistic concurrency condition
        'colors.colorName': colorName,
        'colors.sizes.size': size
      },
      {
        $set: {
          'colors.$[c].sizes.$[s].stock': newStock
        },
        $inc: { __v: 1 }
      },
      {
        arrayFilters: [
          { 'c.colorName': colorName },
          { 's.size': size }
        ],
        new: true,
        ...sessionOpt
      }
    );

    if (!updated) {
      // __v mismatch — another admin modified this product concurrently.
      throw new Error(
        `CONCURRENT_CONFLICT: Product was modified concurrently. ` +
        `Please refresh and retry your inventory adjustment.`
      );
    }

    // ── Audit phase: Durably persist InventoryAdjustment document ────────────────
    const [auditRecord] = await InventoryAdjustment.create(
      [
        {
          productId: existingProduct._id,
          colorName,
          size,
          previousStock,
          newStock,
          admin,
          timestamp: new Date(),
          reason: reason || 'Manual adjustment'
        }
      ],
      sessionOpt
    );

    console.log(`[Inventory Adjustment] ${productId} (${colorName}/${size}): ${previousStock} → ${newStock} by ${admin} (Reason: ${reason || 'Manual adjustment'})`);

    updated._adjustment = auditRecord.toObject();
    return updated;
  });
}
