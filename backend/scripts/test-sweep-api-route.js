#!/usr/bin/env node
'use strict';

/**
 * Static checks for Next.js USDT sweep route (Netts energy + TronWeb).
 * Run: node backend/scripts/test-sweep-api-route.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const routePath = path.join(__dirname, '../../app/api/sweep/route.ts');
const src = fs.readFileSync(routePath, 'utf8');

assert.ok(src.includes("from 'next/server'"), 'App Router NextRequest/NextResponse');
assert.ok(src.includes('rentEnergyFromNetts'), 'Netts energy rental helper');
assert.ok(/X-API-KEY/.test(src), 'Netts API key header');
assert.ok(/ENERGY_ORDER_AMOUNT\s*=\s*65_000/.test(src), '65000 energy order constant');
assert.ok(src.includes('energy: ENERGY_ORDER_AMOUNT'), 'Netts body uses 65k energy');
assert.ok(src.includes('DELEGATION_SETTLE_MS = 2_000'), '2s delegation settle delay');
assert.ok(src.includes('TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'), 'USDT TRC20 contract');
assert.ok(/feeLimit:\s*USDT_FEE_LIMIT_SUN|100_000_000/.test(src), 'fee limit 100M sun');
assert.ok(src.includes("'TRON_ENERGY_API_URL'"), 'reads TRON_ENERGY_API_URL from env');
assert.ok(src.includes("'TRON_ENERGY_API_KEY'"), 'reads TRON_ENERGY_API_KEY from env');
assert.ok(src.includes("'TRON_FULL_HOST'"), 'reads TRON_FULL_HOST from env');
assert.ok(src.includes("'CENTRAL_WALLET_ADDRESS'"), 'reads CENTRAL_WALLET_ADDRESS from env');
assert.ok(!src.includes('d6221bd0fbff276ff686807f321b9afa'), 'must not hardcode Netts API key');
assert.ok(src.includes('childPrivateKey does not match childAddress'), 'validates key/address pair');

console.log('Sweep API route static checks — ok');
