const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const dbUrl = process.env.DATABASE_URL || '';

if (!dbUrl) {
  console.warn("⚠️ DATABASE_URL is not set in environment.");
  process.exit(0);
}

const isSqlite = dbUrl.startsWith('file:') || dbUrl.includes('.db');
const targetProvider = isSqlite ? 'sqlite' : 'postgresql';

try {
  let schemaContent = fs.readFileSync(schemaPath, 'utf8');
  
  // Find current provider
  const providerMatch = schemaContent.match(/provider\s*=\s*"([^"]+)"/);
  if (providerMatch) {
    const currentProvider = providerMatch[1];
    if (currentProvider !== targetProvider) {
      console.log(`[DB Setup] Switching database provider from '${currentProvider}' to '${targetProvider}'...`);
      const updatedSchema = schemaContent.replace(/provider\s*=\s*"[^"]+"/, `provider = "${targetProvider}"`);
      fs.writeFileSync(schemaPath, updatedSchema, 'utf8');
      
      console.log("[DB Setup] Regenerating Prisma client...");
      execSync('npx prisma generate', { stdio: 'inherit' });
    } else {
      console.log(`[DB Setup] Database provider is already set to '${targetProvider}'.`);
    }
  }
} catch (err) {
  console.error("[DB Setup] Failed to configure database provider:", err.message);
}
