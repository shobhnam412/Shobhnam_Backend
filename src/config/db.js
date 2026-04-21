import mongoose from 'mongoose';
import dns from 'node:dns';
import { env } from './env.js';

export const connectDB = async () => {
  try {
    // Some Windows/network setups refuse SRV DNS lookups from Node's default resolver.
    // For Atlas `mongodb+srv` URIs, force public resolvers before connecting.
    if (env.MONGODB_URI.startsWith('mongodb+srv://')) {
      dns.setServers(['8.8.8.8', '1.1.1.1']);
    }
    const connectionInstance = await mongoose.connect(env.MONGODB_URI);
    console.log(`\nMongoDB connected !! DB HOST: ${connectionInstance.connection.host}`);
  } catch (error) {
    console.error('MONGODB connection FAILED ', error);
    process.exit(1);
  }
};
