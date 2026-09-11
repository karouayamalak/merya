import mongoose from 'mongoose';

export const connectDB = async () => {
  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction && !process.env.MONGODB_URI) {
    console.error('[Database Error] FATAL: MONGODB_URI environment variable is required in production.');
    process.exit(1);
  }

  // Development-only fallback to local MongoDB instance
  const uri = process.env.MONGODB_URI || (!isProduction ? 'mongodb://127.0.0.1:27017/merya_dz' : null);

  if (!uri) {
    console.error('[Database Error] FATAL: No database connection URI configured.');
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(uri, {
      maxPoolSize: 50,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });
    console.log(`[Database] MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[Database Error] Connection failure: ${error.message}`);
    process.exit(1);
  }
};
