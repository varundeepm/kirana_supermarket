import { PrismaClient } from "@prisma/client";

// Single shared client so we get proper connection pooling and so that
// transactions (used for the oversell guard + atomic finalize) share one pool.
export const prisma = new PrismaClient();
