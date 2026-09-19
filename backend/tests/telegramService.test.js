import assert from 'assert';
import { buildOrderTelegramMessage, sendTelegramOrderNotification } from '../src/services/telegramService.js';

async function runTests() {
  console.log('🧪 Starting Telegram service unit tests...');

  // Test 1: buildOrderTelegramMessage formatting with full order data
  const mockOrder = {
    orderCode: 'MD-TEST1234',
    createdAt: new Date('2026-09-19T14:30:00.000Z'),
    customer: {
      fullName: 'Amina Benali',
      phone: '0555123456',
      wilaya: { code: 16, name: 'Alger' },
      deliveryMethod: 'home',
      address: '12 Rue Didouche Mourad'
    },
    items: [
      {
        productName: 'Robe Amina',
        colorName: 'Rose Poudré',
        size: 'M',
        quantity: 1,
        unitPrice: 8500
      },
      {
        productName: { fr: 'Ensemble Flora', ar: 'طقم فلورا', en: 'Flora Set' },
        colorName: 'Bleu',
        size: 'S',
        quantity: 2,
        unitPrice: 7000
      }
    ],
    subtotal: 22500,
    deliveryFee: 500,
    totalPrice: 23000
  };

  const message = buildOrderTelegramMessage(mockOrder);
  assert(message.includes('NOUVELLE COMMANDE REÇUE'), 'Message should contain header');
  assert(message.includes('#MD-TEST1234'), 'Message should contain order code');
  assert(message.includes('Amina Benali'), 'Message should contain customer name');
  assert(message.includes('0555123456'), 'Message should contain customer phone');
  assert(message.includes('Alger'), 'Message should contain Wilaya');
  assert(message.includes('Livraison à domicile'), 'Message should reflect home delivery');
  assert(message.includes('12 Rue Didouche Mourad'), 'Message should contain address');
  assert(message.includes('Robe Amina'), 'Message should contain item 1 name');
  assert(message.includes('Ensemble Flora'), 'Message should handle localized object product name');
  assert(message.includes('23\u202F000 DZD') || message.includes('23 000 DZD') || message.includes('23000 DZD'), 'Message should format total price');
  console.log('✅ Test 1 Passed: Order message builds and formats all fields cleanly');

  // Test 2: Agency delivery handling
  const agencyOrder = {
    orderCode: 'MD-AGENCY99',
    customer: {
      fullName: 'Karim Bouzid',
      phone: '0661998877',
      wilaya: 'Oran',
      deliveryMethod: 'agency',
      agencyName: 'Yalidine Bureau Es Senia'
    },
    items: [
      {
        productName: 'Caftan Royal',
        colorName: 'Doré',
        size: 'Standard',
        quantity: 1,
        unitPrice: 15000
      }
    ],
    subtotal: 15000,
    deliveryFee: 0,
    totalPrice: 15000
  };

  const agencyMsg = buildOrderTelegramMessage(agencyOrder);
  assert(agencyMsg.includes('Point Relais / Agence'), 'Should indicate agency pickup');
  assert(agencyMsg.includes('Yalidine Bureau Es Senia'), 'Should include agency name');
  assert(agencyMsg.includes('Gratuit (Offert)'), 'Should format 0 delivery fee as Free');
  console.log('✅ Test 2 Passed: Agency delivery and free shipping formatted properly');

  // Test 3: Graceful skip when TELEGRAM_CHAT_ID is missing
  const prevChatId = process.env.TELEGRAM_CHAT_ID;
  delete process.env.TELEGRAM_CHAT_ID;
  const skipped = await sendTelegramOrderNotification(mockOrder);
  assert.strictEqual(skipped, false, 'Should return false without throwing when chat ID is missing');
  if (prevChatId) process.env.TELEGRAM_CHAT_ID = prevChatId;
  console.log('✅ Test 3 Passed: Graceful skip when CHAT_ID is not configured');

  console.log('\n🎉 All Telegram tests passed successfully!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
