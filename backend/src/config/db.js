import mongoose from 'mongoose';

export const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/merya_dz';

  try {
    const conn = await mongoose.connect(uri, {
      autoIndex: true // Ensure indexes are created in development/setup
    });
    console.log(`[Database] MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error(`[Database Error] Connection failure: ${error.message}`);
    process.exit(1);
  }
};
