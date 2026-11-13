#!/usr/bin/env node
/**
 * User-level card-issue cooldown, confirm challenge, and abuse auto-ban.
 * Run: node backend/scripts/test-card-issue-user-abuse.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.chdir(path.join(__dirname, '..'));

const dbPath = path.join(os.tmpdir(), `eisy-card-abuse-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath}`;
process.env.NODE_ENV = 'test';
process.env.AUTH_SECRET = 'test-card-abuse-secret-not-for-prod';
process.env.RATE_LIMIT_CARD_ISSUE_MAX = '1';
process.env.CARD_ISSUE_ABUSE_STRIKES = '3';
process.env.CARD_ISSUE_ABUSE_WINDOW_MS = String(24 * 60 * 60 * 1000);
process.env.RATE_LIMIT_CARD_ISSUE_WINDOW_MS = String(24 * 60 * 60 * 1000);
process.env.CARD_ISSUE_DAILY_WINDOW_MS = String(24 * 60 * 60 * 1000);
process.env.CARD_ISSUE_DAILY_MAX = '1';

const { initDb } = require('../src/db');

(async () => {
  await initDb();

  const User = require('../src/models/User');
  const Card = require('../src/models/Card');
  const {
    CONFIRM_ACK,
    DAILY_CARD_LIMIT_MESSAGE,
    createCardIssueConfirmToken,
    verifyCardIssueConfirmToken,
    assertCardIssueBotChallenge,
    assertCardIssueDailyLimit,
    assertCardIssueCooldown,
    countCardsIssuedInWindow,
    recordCardIssueAbuseStrike,
    countRecentAbuseStrikes,
  } = require('../src/services/cardIssueAbuseService');
  const { createCardIssueRateLimiter } = require('../src/middleware/security');
  const { isUserBlocked } = require('../src/lib/userAuthStatus');

  assert.strictEqual(CONFIRM_ACK, 'ISSUE_VIRTUAL_CARD');
  assert.strictEqual(
    DAILY_CARD_LIMIT_MESSAGE,
    'Daily card limit reached. You can only issue 1 card per day.'
  );
  assert.strictEqual(typeof createCardIssueRateLimiter(), 'function');

  const user = await User.create({
    email: 'abuse-test@gmail.com',
    name: 'Abuse Test',
    phone: `+959${String(Date.now()).slice(-8)}`,
  });
  const userId = user.id;

  // Confirm token round-trip
  const challenge = createCardIssueConfirmToken(userId);
  assert.ok(challenge.confirm_token);
  assert.strictEqual(challenge.confirm_ack, CONFIRM_ACK);
  assert.strictEqual(verifyCardIssueConfirmToken(challenge.confirm_token, userId), true);
  assert.strictEqual(verifyCardIssueConfirmToken(challenge.confirm_token, userId + 1), false);
  assert.strictEqual(verifyCardIssueConfirmToken('garbage', userId), false);

  assert.doesNotThrow(() => assertCardIssueBotChallenge({
    confirm_token: challenge.confirm_token,
    confirm_ack: CONFIRM_ACK,
    client_intent: 'issue_virtual_card',
    website: '',
  }, userId));

  assert.throws(
    () => assertCardIssueBotChallenge({ confirm_ack: CONFIRM_ACK }, userId),
    (err) => err.code === 'CARD_ISSUE_CONFIRM_INVALID'
  );
  assert.throws(
    () => assertCardIssueBotChallenge({
      confirm_token: challenge.confirm_token,
      confirm_ack: 'NOPE',
    }, userId),
    (err) => err.code === 'CARD_ISSUE_CONFIRM_REQUIRED'
  );
  assert.throws(
    () => assertCardIssueBotChallenge({
      confirm_token: challenge.confirm_token,
      confirm_ack: CONFIRM_ACK,
      website: 'http://bot.example',
    }, userId),
    (err) => err.code === 'BOT_CHALLENGE_FAILED'
  );

  // Daily limit: no cards yet → ok
  await assertCardIssueDailyLimit(userId);
  assert.strictEqual((await countCardsIssuedInWindow(userId)).count, 0);

  // Insert a recent card → second issue within 24h must trip daily limit
  await Card.issue({
    userId,
    cardNumber: '4111111111111111',
    expDate: '12/30',
    cvv: '123',
    cardHolderName: 'Abuse Test',
    status: 'active',
  });
  assert.strictEqual((await countCardsIssuedInWindow(userId)).count, 1);
  await assert.rejects(
    () => assertCardIssueDailyLimit(userId),
    (err) => (
      err.code === 'CARD_ISSUE_DAILY_LIMIT'
      && err.message === DAILY_CARD_LIMIT_MESSAGE
    )
  );
  // Deprecated alias still enforces the same daily gate
  await assert.rejects(
    () => assertCardIssueCooldown(userId),
    (err) => err.code === 'CARD_ISSUE_DAILY_LIMIT'
  );

  // Abuse strikes → auto block on 3rd
  process.env.CARD_ISSUE_ABUSE_STRIKES = '3';
  const s1 = await recordCardIssueAbuseStrike(userId, { reason: 'test_1', ip: '192.204.1.1' });
  assert.strictEqual(s1.blocked, false);
  assert.ok(s1.strikes >= 1);
  const s2 = await recordCardIssueAbuseStrike(userId, { reason: 'test_2', ip: '192.204.1.2' });
  assert.strictEqual(s2.blocked, false);
  const s3 = await recordCardIssueAbuseStrike(userId, { reason: 'test_3', ip: '192.204.1.3' });
  assert.strictEqual(s3.blocked, true);
  assert.ok(await countRecentAbuseStrikes(userId) >= 3);

  const blockedUser = await User.findById(userId);
  assert.ok(isUserBlocked(blockedUser.auth_status));

  // Static wiring checks
  const userSrc = fs.readFileSync(path.join(__dirname, '../src/routes/user.js'), 'utf8');
  assert.ok(userSrc.includes('/cards/request/challenge'));
  assert.ok(userSrc.includes('assertCardIssueBotChallenge'));
  assert.ok(userSrc.includes('assertCardIssueDailyLimit'));
  assert.ok(userSrc.includes('recordCardIssueAbuseStrike'));

  const dashSrc = fs.readFileSync(path.join(__dirname, '../public/dashboard.js'), 'utf8');
  assert.ok(dashSrc.includes('/api/user/cards/request/challenge'));
  assert.ok(dashSrc.includes('confirm_token'));
  assert.ok(dashSrc.includes('pago_request_confirm'));
  assert.ok(dashSrc.includes('CARD_ISSUE_DAILY_LIMIT'));

  const abuseSrc = fs.readFileSync(path.join(__dirname, '../src/services/cardIssueAbuseService.js'), 'utf8');
  assert.ok(abuseSrc.includes('assertCardIssueDailyLimit'));
  assert.ok(abuseSrc.includes('countCardsIssuedInWindow'));
  assert.ok(abuseSrc.includes(DAILY_CARD_LIMIT_MESSAGE));

  const secSrc = fs.readFileSync(path.join(__dirname, '../src/middleware/security.js'), 'utf8');
  assert.ok(secSrc.includes("envInt('RATE_LIMIT_CARD_ISSUE_MAX', 1)"));
  assert.ok(secSrc.includes('recordCardIssueAbuseStrike'));

  console.log('test-card-issue-user-abuse: OK');
  process.exit(0);
})().catch((err) => {
  console.error('test-card-issue-user-abuse: FAIL', err);
  process.exit(1);
});
