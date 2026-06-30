import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

// Ensure db disconnects when application shuts down
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});
