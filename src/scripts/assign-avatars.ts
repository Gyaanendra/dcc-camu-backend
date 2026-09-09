import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { generateNotionistAvatar } from '../utils/avatar';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  console.log('🚀 Starting Notionist avatar assignment for all members...');

  const allUsers = await db.select().from(users);
  console.log(`Found ${allUsers.length} total members in database.`);

  let updated = 0;
  for (const u of allUsers) {
    const isGyanendra = u.name.toLowerCase().includes('gyanendra') || u.rollNumber.toLowerCase().includes('s24cseu0771');
    const newAvatarUrl = generateNotionistAvatar(u.name || u.rollNumber);
    await db
      .update(users)
      .set({ avatarUrl: newAvatarUrl })
      .where(eq(users.id, u.id));
    updated++;
    const tag = isGyanendra ? '🔥 COOL TECH GUY' : newAvatarUrl.includes('beardProbability=0') ? '👧 FEMALE' : '👦 MALE';
    console.log(`[${updated}/${allUsers.length}] [${tag}] ${u.name} (${u.rollNumber})`);
  }

  console.log(`\n🎉 Done! Successfully assigned funky Notionist avatars to all ${updated} members.`);
  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Failed to assign avatars:', err);
  process.exit(1);
});
