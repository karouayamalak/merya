/**
 * telegramService.js — MERYA DZ Instant Telegram Order Notifications
 *
 * Sends formatted instant alerts to the store owner's Telegram whenever
 * an order is placed on the website (Cash on Delivery).
 * Fails gracefully and non-blockingly if Telegram API is unreachable.
 */



function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatPrice(num) {
  if (typeof num !== 'number') return '0 DZD';
  return num.toLocaleString('fr-DZ') + ' DZD';
}

/**
 * Format order details into a clean Telegram HTML message.
 */
export function buildOrderTelegramMessage(order) {
  const customer = order.customer || {};
  const wilayaName = typeof customer.wilaya === 'object' ? (customer.wilaya?.name || '') : String(customer.wilaya || '');
  const deliveryType = customer.deliveryMethod === 'agency' ? '🏢 Point Relais / Agence' : '🏠 Livraison à domicile';
  const orderDate = new Date(order.createdAt || Date.now()).toLocaleString('fr-DZ', {
    timeZone: 'Africa/Algiers',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const lines = [
    '✨ <b>NOUVELLE COMMANDE REÇUE !</b> ✨',
    '━━━━━━━━━━━━━━━━━━━━',
    `📦 <b>Code Commande :</b> <code>#${escapeHtml(order.orderCode)}</code>`,
    `⏰ <b>Date :</b> ${escapeHtml(orderDate)}`,
    '',
    '👤 <b>INFORMATIONS CLIENT :</b>',
    `• <b>Nom :</b> ${escapeHtml(customer.fullName || '—')}`,
    `• <b>Téléphone :</b> <code>${escapeHtml(customer.phone || '—')}</code>`,
    `• <b>Wilaya :</b> ${escapeHtml(wilayaName || '—')}`,
    `• <b>Mode :</b> ${deliveryType}`,
  ];

  if (customer.agencyName) {
    lines.push(`• <b>Bureau de retrait :</b> ${escapeHtml(customer.agencyName)}`);
  }
  if (customer.address) {
    lines.push(`• <b>Adresse :</b> ${escapeHtml(customer.address)}`);
  }

  lines.push('', '🛍️ <b>ARTICLES :</b>');

  if (Array.isArray(order.items)) {
    order.items.forEach((item, idx) => {
      const pName = typeof item.productName === 'object'
        ? (item.productName.fr || item.productName.en || item.productName.ar || 'Produit')
        : (item.productName || 'Produit');
      const details = [item.colorName, item.size ? `Taille ${item.size}` : null].filter(Boolean).join(' | ');
      const total = item.unitPrice && item.quantity ? formatPrice(item.unitPrice * item.quantity) : '';
      lines.push(`${idx + 1}. <b>${escapeHtml(pName)}</b> (${escapeHtml(details)})`);
      lines.push(`   └ Qté: <b>${item.quantity}</b> × ${formatPrice(item.unitPrice)} = <b>${total}</b>`);
    });
  }

  lines.push('', '💳 <b>RÉSUMÉ DU PAIEMENT (COD) :</b>');
  if (typeof order.subtotal === 'number') {
    lines.push(`• Sous-total : ${formatPrice(order.subtotal)}`);
  }
  if (typeof order.deliveryFee === 'number') {
    const feeStr = order.deliveryFee === 0 ? 'Gratuit (Offert)' : formatPrice(order.deliveryFee);
    lines.push(`• Frais de livraison : ${feeStr}`);
  }
  lines.push(`• <b>TOTAL À ENCAISSER :</b> <b>${formatPrice(order.totalPrice)}</b>`);
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('💵 <i>Paiement en espèces à la livraison</i>');

  return lines.join('\n');
}

const DEFAULT_BOT_TOKEN = '8919995952:AAHj83TjuHvvqNulZPWdm-y7B0QDEN5yQms';
const DEFAULT_CHAT_ID = '6363932801';

/**
 * Send an automated Telegram notification when an order is placed.
 * Non-blocking: returns boolean indicating success, never throws unhandled errors.
 */
export async function sendTelegramOrderNotification(order) {
  const isRunningTest = process.env.NODE_ENV === 'test' || process.argv.some(a => a.includes('test'));
  const botToken = process.env.TELEGRAM_BOT_TOKEN || (!isRunningTest ? DEFAULT_BOT_TOKEN : null);
  const chatId = process.env.TELEGRAM_CHAT_ID || (!isRunningTest ? DEFAULT_CHAT_ID : null);

  if (!botToken) {
    console.warn('[Telegram] Notification skipped: TELEGRAM_BOT_TOKEN is missing');
    return false;
  }

  if (!chatId) {
    console.warn('[Telegram] Notification pending: TELEGRAM_CHAT_ID is not configured in .env yet.');
    return false;
  }

  try {
    const message = buildOrderTelegramMessage(order);
    const controller = new globalThis.AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      console.warn('[Telegram] HTML delivery failed, attempting plain-text fallback:', data.description || response.statusText);
      // Strip HTML tags for clean plain-text fallback delivery
      const plainText = message.replace(/<[^>]*>/g, '');
      const retryRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: plainText,
          disable_web_page_preview: true
        })
      });
      const retryData = await retryRes.json().catch(() => ({}));
      if (!retryRes.ok || !retryData.ok) {
        console.warn('[Telegram] API responded with error:', retryData.description || retryRes.statusText);
        return false;
      }
    }

    console.log(`[Telegram] Order alert sent for #${order.orderCode} to chat ${chatId}`);
    return true;
  } catch (err) {
    console.warn(`[Telegram] Failed to send order notification (non-fatal): ${err.message}`);
    return false;
  }
}

/**
 * Send an OTP code via Telegram for password reset.
 */
export async function sendTelegramPasswordResetOtp({ adminEmail, username, otp, ipAddress }) {
  const isRunningTest = process.env.NODE_ENV === 'test' || process.argv.some(a => a.includes('test'));
  const botToken = process.env.TELEGRAM_BOT_TOKEN || (!isRunningTest ? DEFAULT_BOT_TOKEN : null);
  const chatId = process.env.TELEGRAM_CHAT_ID || (!isRunningTest ? DEFAULT_CHAT_ID : null);

  if (!botToken || !chatId) {
    console.warn('[Telegram] Password reset notification skipped: bot token or chat ID missing.');
    return false;
  }

  const message = [
    '🔐 <b>RÉINITIALISATION DE MOT DE PASSE</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    `Bonjour <b>${escapeHtml(username || 'Administrateur')}</b>,`,
    '',
    'Une demande de réinitialisation a été envoyée pour le compte :',
    `📧 <code>${escapeHtml(adminEmail)}</code>`,
    '',
    '🔢 Votre code de sécurité à 6 chiffres :',
    `👉 <b><code>${escapeHtml(otp)}</code></b> 👈`,
    '',
    '⏳ <i>Ce code expire dans 10 minutes.</i>',
    ipAddress ? `📍 <i>IP : ${escapeHtml(ipAddress)}</i>` : '',
    '',
    '⚠️ <i>Si vous n\'êtes pas à l\'origine de cette demande, ignorez ce message.</i>'
  ].filter(Boolean).join('\n');

  try {
    const controller = new globalThis.AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      console.warn('[Telegram] HTML OTP delivery failed, attempting plain-text fallback:', data.description || response.statusText);
      const plainText = message.replace(/<[^>]*>/g, '');
      const retryRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: plainText,
          disable_web_page_preview: true
        })
      });
      const retryData = await retryRes.json().catch(() => ({}));
      if (!retryRes.ok || !retryData.ok) {
        console.warn('[Telegram] Reset OTP API responded with error:', retryData.description || retryRes.statusText);
        return false;
      }
    }

    console.log(`[Telegram] Password reset OTP sent successfully for ${adminEmail}`);
    return true;
  } catch (err) {
    console.warn(`[Telegram] Failed to send reset OTP: ${err.message}`);
    return false;
  }
}

/**
 * Send an alert via Telegram when an admin password is reset successfully.
 */
export async function sendTelegramPasswordResetSuccessAlert({ adminEmail, username, ipAddress }) {
  const isRunningTest = process.env.NODE_ENV === 'test' || process.argv.some(a => a.includes('test'));
  const botToken = process.env.TELEGRAM_BOT_TOKEN || (!isRunningTest ? DEFAULT_BOT_TOKEN : null);
  const chatId = process.env.TELEGRAM_CHAT_ID || (!isRunningTest ? DEFAULT_CHAT_ID : null);

  if (!botToken || !chatId) return false;

  const dateStr = new Date().toLocaleString('fr-DZ', {
    timeZone: 'Africa/Algiers',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const message = [
    '🛡️ <b>MOT DE PASSE MIS À JOUR AVEC SUCCÈS</b>',
    '━━━━━━━━━━━━━━━━━━━━',
    `Le mot de passe pour le compte <code>${escapeHtml(adminEmail)}</code> (${escapeHtml(username || 'Admin')}) a été réinitialisé avec succès.`,
    `⏰ <b>Date :</b> ${escapeHtml(dateStr)}`,
    ipAddress ? `📍 <b>IP :</b> <code>${escapeHtml(ipAddress)}</code>` : '',
    '',
    '🔒 Toutes les anciennes sessions connectées ont été révoquées par précaution.',
    'Vous pouvez désormais vous connecter avec votre nouveau mot de passe.'
  ].filter(Boolean).join('\n');

  try {
    const controller = new globalThis.AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const plainText = message.replace(/<[^>]*>/g, '');
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: plainText,
          disable_web_page_preview: true
        })
      });
    }

    return true;
  } catch {
    return false;
  }
}

