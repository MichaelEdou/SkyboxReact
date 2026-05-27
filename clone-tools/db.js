const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({ log: ['error', 'warn'] });
const SESSION_TTL_MS = 20 * 60 * 1000;
const LOGIN_TTL_MS = 15 * 60 * 1000;
const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const newExpiry = (ms) => new Date(Date.now() + ms);
module.exports = { prisma, SESSION_TTL_MS, LOGIN_TTL_MS, COOKIE_TTL_MS, newExpiry };
