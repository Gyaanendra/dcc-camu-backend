import { db } from './index';
import { teams, users, sessions } from './schema';
import dotenv from 'dotenv';

dotenv.config();

async function seed() {
  console.log('🌱 Optional Manual Seeding Script for Club DCC Camu...');

  try {
    console.log('📦 Inserting Initial Wings...');
    const insertedTeams = await db.insert(teams).values([
      { name: 'Web Development Wing', code: 'WEB', description: 'Fullstack web development and Node.js APIs', color: '#3b82f6' },
      { name: 'AI & Machine Learning Wing', code: 'AIML', description: 'Deep learning, PyTorch, and computer vision projects', color: '#8b5cf6' },
      { name: 'Competitive Programming Wing', code: 'CP', description: 'Algorithms and competitive coding contests', color: '#10b981' },
      { name: 'UI/UX & Creative Design', code: 'DESIGN', description: 'User interface design and brand aesthetics', color: '#ec4899' },
      { name: 'Media & Event Operations', code: 'MEDIA', description: 'Event planning, publicity, and PR', color: '#f59e0b' },
    ]).returning();

    console.log('✨ Seed completed! Database ready for live user logins.');
  } catch (error) {
    console.error('❌ Seeding Error:', error);
  }
}

seed();
