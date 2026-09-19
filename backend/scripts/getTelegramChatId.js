import dotenv from 'dotenv';
dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN || '8744518070:AAG9iYQhsDBqmcAmz_9HFGUOvDmfzZPcT14';

async function checkChatId() {
  console.log(`Checking updates for bot: ${token.slice(0, 10)}...`);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`);
    const data = await res.json();
    if (!data.ok) {
      console.error('Error from Telegram API:', data.description);
      return;
    }

    if (!data.result || data.result.length === 0) {
      console.log('\n❌ No messages received yet!');
      console.log('👉 Please open Telegram, search for @Meryadz_bot (or visit https://t.me/Meryadz_bot) and click "START" or send any message.');
      console.log('Then re-run this script to get your Chat ID.');
      return;
    }

    console.log(`\nFound ${data.result.length} update(s):`);
    const chats = new Map();
    for (const u of data.result) {
      const msg = u.message || u.channel_post || u.my_chat_member;
      if (msg && msg.chat) {
        const chat = msg.chat;
        const key = chat.id;
        const sender = chat.username ? `@${chat.username}` : (chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' '));
        chats.set(key, { id: chat.id, type: chat.type, name: sender });
      }
    }

    console.log('\n✅ Available Chat IDs:');
    for (const [id, info] of chats) {
      console.log(`- Chat ID: ${id} (${info.name || 'Private'}, Type: ${info.type})`);
    }

    const latest = Array.from(chats.values())[chats.size - 1];
    console.log(`\n💡 To receive order alerts here, set in backend/.env:`);
    console.log(`TELEGRAM_CHAT_ID=${latest.id}`);
  } catch (err) {
    console.error('Failed to query Telegram API:', err.message);
  }
}

checkChatId();
