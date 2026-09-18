import dns from 'node:dns';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  console.warn('Could not set custom DNS servers:', e.message);
}

function maskUri(uri) {
  return uri ? uri.replace(/:([^:@]+)@/, ':****@') : '';
}

const localUri = process.env.MONGODB_LOCAL_URI || 'mongodb://127.0.0.1:27018/merya_dz?replicaSet=rs0&directConnection=true';
const atlasUri = process.env.MONGODB_ATLAS_URI;

if (!atlasUri) {
  console.error('[Migration Error] FATAL: MONGODB_ATLAS_URI environment variable is required.');
  console.error('Please configure MONGODB_ATLAS_URI before running this migration script.');
  process.exit(1);
}

async function migrate() {
  console.log(`[Migration] Connecting to local DB: ${maskUri(localUri)}`);
  const localConn = await mongoose.createConnection(localUri).asPromise();
  console.log('[Migration] Connected to local DB.');

  console.log(`[Migration] Connecting to Atlas DB: ${maskUri(atlasUri)}`);
  const atlasConn = await mongoose.createConnection(atlasUri, {
    serverSelectionTimeoutMS: 10000
  }).asPromise();
  console.log('[Migration] Connected to Atlas DB.');

  const collectionsToMigrate = [
    'admins',
    'deliverysettings',
    'categories',
    'products',
    'inventoryadjustments',
    'banners'
  ];

  for (const colName of collectionsToMigrate) {
    try {
      const localCol = localConn.collection(colName);
      const docs = await localCol.find({}).toArray();
      console.log(`[Migration] ${colName}: found ${docs.length} in local DB.`);

      if (docs.length > 0) {
        const atlasCol = atlasConn.collection(colName);
        // Clean existing in atlas to avoid duplicates
        await atlasCol.deleteMany({});
        await atlasCol.insertMany(docs);
        console.log(`[Migration] ${colName}: copied ${docs.length} documents to Atlas.`);
      }
    } catch (err) {
      console.error(`[Migration Error] failed migrating ${colName}:`, err.message);
    }
  }

  // Also copy indexes
  for (const colName of ['categories', 'products', 'admins']) {
    try {
      const localCol = localConn.collection(colName);
      const atlasCol = atlasConn.collection(colName);
      const indexes = await localCol.indexes();
      for (const idx of indexes) {
        if (idx.name === '_id_') continue;
        const keys = idx.key;
        const options = { name: idx.name };
        if (idx.unique) options.unique = true;
        if (idx.sparse) options.sparse = true;
        try {
          await atlasCol.createIndex(keys, options);
        } catch {
          // ignore index creation if already exists
        }
      }
    } catch {
      // ignore
    }
  }

  console.log('\n--- VERIFICATION ON ATLAS ---');
  const atlasCollections = await atlasConn.db.listCollections().toArray();
  for (const c of atlasCollections) {
    const count = await atlasConn.collection(c.name).countDocuments();
    console.log(`Atlas collection: ${c.name} -> ${count} documents`);
  }

  await localConn.close();
  await atlasConn.close();
  console.log('\n[Migration] Migration completed successfully!');
}

migrate().catch(err => {
  console.error('[Migration Error]', err);
  process.exit(1);
});
