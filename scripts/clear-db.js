const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const dbUrl = process.env.DATABASE_URL || '';

console.log("=========================================");
console.log("♻️  Stellapp Database Clear / Reset Tool  ♻️");
console.log("=========================================");
console.log(`Current DATABASE_URL: ${dbUrl}`);

if (!dbUrl) {
  console.error("❌ Error: DATABASE_URL is not set in .env");
  process.exit(1);
}

const isSqlite = dbUrl.startsWith('file:') || dbUrl.includes('.db');

if (isSqlite) {
  console.log("Detected Local SQLite Database Setup.");
  let originalSchemaContent = '';
  try {
    // 1. Read schema.prisma
    originalSchemaContent = fs.readFileSync(schemaPath, 'utf8');
    
    // 2. Temporarily switch provider to sqlite
    console.log("🔄 Temporarily switching Prisma provider to 'sqlite'...");
    const updatedSchema = originalSchemaContent.replace(/provider\s*=\s*"postgresql"/, 'provider = "sqlite"');
    fs.writeFileSync(schemaPath, updatedSchema, 'utf8');
    
    // 3. Delete existing sqlite db file if it exists
    const relativeDbPath = dbUrl.replace('file:', '');
    const dbPath = path.resolve(path.join(__dirname, '..', 'prisma', relativeDbPath));
    if (fs.existsSync(dbPath)) {
      console.log(`🗑️  Deleting existing local database file: ${dbPath}`);
      fs.unlinkSync(dbPath);
    }
    
    // 4. Run prisma db push --force-reset
    console.log("⚡ Recreating local database schema...");
    execSync('npx prisma db push --force-reset --accept-data-loss', { stdio: 'inherit' });
    
    // 5. Restore schema.prisma
    console.log("🔄 Reverting Prisma provider back to 'postgresql'...");
    fs.writeFileSync(schemaPath, originalSchemaContent, 'utf8');
    
    // 6. Generate client
    console.log("🛠️  Regenerating Prisma client...");
    execSync('npx prisma generate', { stdio: 'inherit' });
    
    console.log("\n✅ Local SQLite Database successfully reset!");
  } catch (error) {
    console.error("❌ Failed to reset local database:", error);
    // Ensure we revert schema.prisma even if it fails
    try {
      if (originalSchemaContent) {
        console.log("🔄 Reverting Prisma provider back to 'postgresql' after error...");
        fs.writeFileSync(schemaPath, originalSchemaContent, 'utf8');
      }
    } catch (_) {}
    process.exit(1);
  }
} else {
  console.log("Detected PostgreSQL Database Setup.");
  try {
    console.log("⚡ Resetting PostgreSQL database...");
    execSync('npx prisma db push --force-reset --accept-data-loss', { stdio: 'inherit' });
    console.log("\n✅ PostgreSQL Database successfully reset!");
  } catch (error) {
    console.error("❌ Failed to reset PostgreSQL database:", error);
    process.exit(1);
  }
}
