import { env } from '../config/env.js';
import { User } from '../models/user.model.js';

/**
 * Seeds the admin user into DB if they don't already exist.
 * Uses ADMIN_EMAIL and ADMIN_PASSWORD from .env
 */
export const seedAdmin = async () => {
  try {
    const existing = await User.findOne({ email: env.ADMIN_EMAIL, role: 'ADMIN' });
    if (existing) {
      console.log(`✅ Admin user already exists: ${env.ADMIN_EMAIL}`);
      return;
    }

    await User.create({
      name: 'Shobhnam Admin',
      email: env.ADMIN_EMAIL,
      phone: '0000000000',
      password: env.ADMIN_PASSWORD,
      role: 'ADMIN',
    });

    console.log(`✅ Admin user seeded: ${env.ADMIN_EMAIL}`);
  } catch (error) {
    if (error.code === 11000) {
      console.log('ℹ️  Admin user already exists in DB');
      return;
    }
    console.error('⚠️  Admin seeding failed:', error.message);
  }
};

const DEMO_USERS = [
  { phone: '+918303438175', name: 'Demo User 1', city: 'New Delhi' },
  { phone: '+919369299589', name: 'Demo User 2', city: 'New Delhi' },
  { phone: '+919876543210', name: 'Demo User 3', city: 'New Delhi' },
];

export const seedDemoUsers = async () => {
  try {
    for (const demoUser of DEMO_USERS) {
      await User.updateOne(
        { phone: demoUser.phone },
        {
          $setOnInsert: {
            name: demoUser.name,
            phone: demoUser.phone,
            city: demoUser.city,
            role: 'USER',
          },
        },
        { upsert: true }
      );
    }
    console.log('✅ Demo users seed check completed');
  } catch (error) {
    console.error('⚠️  Demo users seeding failed:', error.message);
  }
};
