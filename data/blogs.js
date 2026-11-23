/**
 * File-based blog / guides content for eisymyanmar.com.
 * Consumed by backend/scripts/build-blog-pages.js (SSG equivalent of
 * generateStaticParams + generateMetadata — this repo is an Express SPA,
 * not Next.js App Router).
 *
 * Visa only — never mention Mastercard.
 */

'use strict';

const SITE_ORIGIN = 'https://eisymyanmar.com';

/** @typedef {{ type: 'p'|'ul'|'ol'|'note', text?: string, items?: string[] }} BlogBlock */
/** @typedef {{ heading: string, blocks: BlogBlock[] }} BlogSection */
/** @typedef {{
 *   slug: string,
 *   title: string,
 *   description: string,
 *   keywords: string[],
 *   locale: string,
 *   lang: string,
 *   publishedAt: string,
 *   updatedAt: string,
 *   readingMinutes: number,
 *   heroLabel: string,
 *   sections: BlogSection[],
 * }} BlogPost */

/** @type {BlogPost[]} */
const posts = [
  {
    slug: 'how-to-get-no-kyc-virtual-visa-card-with-usdt-2026',
    title: 'How to Get a No KYC Virtual Visa Card with USDT in 2026',
    description:
      'Step-by-step guide to buy a No KYC virtual Visa card with USDT in 2026. Fund Facebook Ads, ChatGPT Plus, and online payments without ID verification via Eisy Myanmar.',
    keywords: [
      'No KYC virtual Visa card',
      'buy virtual Visa with USDT',
      'USDT virtual Visa card',
      'No KYC virtual card 2026',
      'Eisy Myanmar',
    ],
    locale: 'en_US',
    lang: 'en',
    publishedAt: '2026-11-23',
    updatedAt: '2026-11-23',
    readingMinutes: 9,
    heroLabel: 'Guide · English',
    sections: [
      {
        heading: 'Why No KYC virtual Visa cards matter in 2026',
        blocks: [
          {
            type: 'p',
            text:
              'A No KYC virtual Visa card lets you pay online without uploading a passport or national ID for card issuing. That is especially useful if you live in Myanmar or work across borders and need a fast way to spend USDT on global services.',
          },
          {
            type: 'p',
            text:
              'Eisy Myanmar issues virtual Visa cards only. You top up with USDT (TRC20) or MMK flows in-wallet, then reload the Visa card for Facebook Ads, ChatGPT Plus, SaaS tools, and other online checkouts.',
          },
        ],
      },
      {
        heading: 'What you need before you start',
        blocks: [
          {
            type: 'ul',
            items: [
              'A Gmail address to register on eisymyanmar.com',
              'USDT on the TRON (TRC20) network, or MMK payment options available in the app',
              'A few minutes to create your account, fund the wallet, and request a Visa card',
            ],
          },
          {
            type: 'note',
            text:
              'Tip: Always double-check the deposit network is TRC20 before sending USDT. Sending on the wrong chain can result in lost funds.',
          },
        ],
      },
      {
        heading: 'Step 1 — Create your Eisy Myanmar account',
        blocks: [
          {
            type: 'ol',
            items: [
              'Open https://eisymyanmar.com and choose Register (or Continue with Google).',
              'Verify your Gmail with the one-time code if prompted.',
              'Set a 6-digit security PIN so you can unlock wallet and card details safely.',
            ],
          },
          {
            type: 'p',
            text:
              'You do not need to submit ID documents to request a No KYC virtual Visa card for issuing. Optional KYC may exist for other compliance features, but card issuing itself is designed around No KYC access.',
          },
        ],
      },
      {
        heading: 'Step 2 — Buy / deposit USDT into your wallet',
        blocks: [
          {
            type: 'p',
            text:
              'To buy a virtual Visa with USDT, fund your Eisy Myanmar USDT wallet first:',
          },
          {
            type: 'ol',
            items: [
              'Go to the USDT wallet / deposit section.',
              'Copy your personal TRC20 deposit address (or scan the QR).',
              'Send USDT from your exchange or self-custody wallet on TRON.',
              'Wait for network confirmations — the balance updates automatically when the deposit is detected.',
            ],
          },
          {
            type: 'p',
            text:
              'If you prefer local currency, use the MMK-related flows shown in the app (including P2P where available), then convert or fund as guided before card reload.',
          },
        ],
      },
      {
        heading: 'Step 3 — Request your No KYC virtual Visa card',
        blocks: [
          {
            type: 'ol',
            items: [
              'Open My Cards / card request in the dashboard.',
              'Confirm the Visa product and any optional starting balance (USD range shown in-app).',
              'Pay the issuing fee (and optional load) from your USDT wallet.',
              'When the card is ready, unlock with your PIN and reveal number, expiry, and CVV securely.',
            ],
          },
          {
            type: 'p',
            text:
              'Your new card is a virtual Visa card — ready for online payments. Keep credentials private and only reveal them when you need to check out.',
          },
        ],
      },
      {
        heading: 'Step 4 — Reload and spend online',
        blocks: [
          {
            type: 'ul',
            items: [
              'Reload the Visa card from your USDT wallet when you need more spend power.',
              'Use the card number for Facebook Ads billing, ChatGPT Plus, cloud tools, and other Visa-accepting sites.',
              'Track transactions in the card activity panel and keep a small buffer for FX/network fees.',
            ],
          },
        ],
      },
      {
        heading: 'Safety checklist when you buy a virtual Visa with USDT',
        blocks: [
          {
            type: 'ul',
            items: [
              'Bookmark only https://eisymyanmar.com — ignore lookalike phishing domains.',
              'Never share PIN, OTP, or card CVV in chat or Telegram DMs.',
              'Prefer official in-app support channels listed on the site.',
              'Start with a small reload before large ad-account spends.',
            ],
          },
        ],
      },
      {
        heading: 'FAQ — No KYC virtual Visa card with USDT',
        blocks: [
          {
            type: 'p',
            text:
              'Is this a Visa card? Yes. Eisy Myanmar issues virtual Visa cards only.',
          },
          {
            type: 'p',
            text:
              'Do I need ID verification to issue the card? No KYC is required for virtual Visa card issuing on Eisy Myanmar.',
          },
          {
            type: 'p',
            text:
              'Can I fund with crypto? Yes — deposit USDT (TRC20) into your wallet, then request or reload the Visa card.',
          },
        ],
      },
    ],
  },
  {
    slug: 'myanmar-chatgpt-plus-facebook-ads-virtual-visa',
    title:
      'မြန်မာပြည်မှနေ၍ ChatGPT Plus နှင့် Facebook Ads ဖိုးကို Virtual Visa Card ဖြင့် ရှင်းနည်း',
    description:
      'မြန်မာမှ ChatGPT Plus နှင့် Facebook Ads ကို Virtual Visa card ဖြင့် ပေးချေနည်း။ No KYC Visa card၊ USDT top-up၊ Virtual Visa card Myanmar လမ်းညွှန်။',
    keywords: [
      'Virtual Visa card Myanmar',
      'pay Facebook Ads Myanmar',
      'ChatGPT Plus Visa card',
      'No KYC virtual Visa card',
      'Eisy Myanmar',
    ],
    locale: 'my_MM',
    lang: 'my',
    publishedAt: '2026-11-23',
    updatedAt: '2026-11-23',
    readingMinutes: 8,
    heroLabel: 'Guide · Myanmar + English',
    sections: [
      {
        heading: 'ဘာကြောင့် Virtual Visa card လိုအပ်သလဲ',
        blocks: [
          {
            type: 'p',
            text:
              'မြန်မာပြည်မှနေ၍ ChatGPT Plus၊ Facebook Ads၊ Google services စသည့် နိုင်ငံတကာ ဝန်ဆောင်မှုများကို ပေးချေရန် နိုင်ငံတကာ Online Visa card လိုအပ်တတ်သည်။ Eisy Myanmar ၏ No KYC Virtual Visa card ဖြင့် ID တင်စရာမလိုဘဲ ကတ်ထုတ်နိုင်ပြီး USDT (သို့) MMK ဖြင့် ငွေသွင်းနိုင်သည်။',
          },
          {
            type: 'p',
            text:
              'English summary: From Myanmar, a virtual Visa card helps you pay ChatGPT Plus and Facebook Ads. Eisy Myanmar offers No KYC virtual Visa cards funded with USDT or MMK.',
          },
        ],
      },
      {
        heading: 'လိုအပ်သောအရာများ',
        blocks: [
          {
            type: 'ul',
            items: [
              'Gmail account (Eisy Myanmar စာရင်းသွင်းရန်)',
              'USDT TRC20 (သို့) အက်ပ်ထဲရှိ MMK ငွေသွင်းနည်းလမ်း',
              'ChatGPT / Meta Ads အကောင့် billing page',
            ],
          },
        ],
      },
      {
        heading: 'အဆင့် ၁ — Eisy Myanmar တွင် အကောင့်ဖွင့်ပါ',
        blocks: [
          {
            type: 'ol',
            items: [
              'https://eisymyanmar.com သို့ ဝင်ပါ။',
              'Register (သို့) Google ဖြင့် ဝင်ပါ။',
              'Security PIN ၆ လုံး သတ်မှတ်ပါ။',
            ],
          },
          {
            type: 'p',
            text:
              'Virtual Visa card ထုတ်ရန် KYC (မှတ်ပုံတင်/ပတ်စပို့) မလိုပါ။',
          },
        ],
      },
      {
        heading: 'အဆင့် ၂ — USDT သို့မဟုတ် MMK ဖြင့် Wallet ငွေသွင်းပါ',
        blocks: [
          {
            type: 'p',
            text:
              'USDT: Wallet ထဲက TRC20 လိပ်စာကို ကူးပြီး exchange / wallet မှ ပို့ပါ။ Network မှန်ကြောင်း အမြဲစစ်ပါ။',
          },
          {
            type: 'p',
            text:
              'MMK: အက်ပ်တွင် ပြသထားသော MMK / P2P လမ်းကြောင်းဖြင့် ငွေသွင်းနိုင်ပါသည်။',
          },
        ],
      },
      {
        heading: 'အဆင့် ၃ — Virtual Visa Card ထုတ်ပြီး Reload လုပ်ပါ',
        blocks: [
          {
            type: 'ol',
            items: [
              'My Cards မှ Visa card တောင်းဆိုပါ။',
              'Issuing fee (နှင့် လိုအပ်ပါက starting balance) ကို USDT wallet မှ ပေးချေပါ။',
              'PIN ဖြင့် unlock လုပ်ပြီး card number / expiry / CVV ကို ကြည့်ပါ။',
              'Facebook Ads သို့ ChatGPT Plus မပေးခင် လိုအပ်သလောက် reload လုပ်ပါ။',
            ],
          },
        ],
      },
      {
        heading: 'ChatGPT Plus ကို Virtual Visa ဖြင့် ပေးချေခြင်း',
        blocks: [
          {
            type: 'ol',
            items: [
              'ChatGPT → Settings → Billing / Upgrade to Plus သို့ သွားပါ။',
              'Payment method တွင် Visa card number, expiry, CVV ထည့်ပါ။',
              'Billing name / country ကို checkout form အတိုင်း ဖြည့်ပါ။',
              'ပေးချေမှု မအောင်မြင်ပါက card balance လုံလောက်မှုနှင့် 3D Secure code (ရှိပါက) ကို စစ်ပါ။',
            ],
          },
          {
            type: 'p',
            text:
              'Keyword focus: ChatGPT Plus Visa card — use your Eisy Myanmar virtual Visa details at OpenAI checkout.',
          },
        ],
      },
      {
        heading: 'Facebook Ads ကို Virtual Visa ဖြင့် ပေးချေခြင်း',
        blocks: [
          {
            type: 'ol',
            items: [
              'Meta Ads Manager → Billing → Payment methods သို့ သွားပါ။',
              'Add payment method တွင် Visa card အချက်အလက် ထည့်ပါ။',
              'Ads account currency နှင့် card spend limit ကို ကိုက်အောင် ထားပါ။',
              'စမ်းသပ်အနေဖြင့် ငွေပမာဏ အနည်းငယ်ဖြင့် campaign စတင်ပြီး မှန်ကန်ကြောင်း အတည်ပြုပါ။',
            ],
          },
          {
            type: 'p',
            text:
              'Keyword focus: pay Facebook Ads Myanmar — reload your Virtual Visa card Myanmar wallet with USDT, then bill Meta.',
          },
        ],
      },
      {
        heading: 'အောင်မြင်စေရန် အကြံပြုချက်များ',
        blocks: [
          {
            type: 'ul',
            items: [
              'ကြော်ငြာ / subscription မတင်မီ card balance လုံလောက်အောင် reload လုပ်ပါ။',
              'CVV နှင့် OTP ကို ဘယ်သူ့ကိုမှ မပို့ပါနှင့်။',
              'Eisy Myanmar တရားဝင် website / support ကိုသာ သုံးပါ။',
              'Visa only — Eisy Myanmar က Virtual Visa card များသာ ထုတ်ပေးသည်။',
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'best-uses-crypto-virtual-visa-card-no-id-verification',
    title: 'Best Uses for a Crypto Virtual Visa Card Without ID Verification',
    description:
      'Practical ways to use a crypto Visa card with no ID verification: ads, AI subscriptions, SaaS, and online tools. Fund with USDT on Eisy Myanmar No KYC virtual Visa cards.',
    keywords: [
      'crypto Visa card no verification',
      'anonymous virtual Visa card',
      'No KYC virtual Visa card',
      'USDT virtual Visa card',
      'Eisy Myanmar',
    ],
    locale: 'en_US',
    lang: 'en',
    publishedAt: '2026-11-23',
    updatedAt: '2026-11-23',
    readingMinutes: 8,
    heroLabel: 'Guide · English',
    sections: [
      {
        heading: 'What “no ID verification” really means',
        blocks: [
          {
            type: 'p',
            text:
              'A crypto Visa card with no verification (No KYC issuing) means you can get a virtual Visa card without uploading a passport for card creation. You still use a normal account email/PIN, follow platform rules, and only spend for lawful purposes.',
          },
          {
            type: 'p',
            text:
              'Eisy Myanmar focuses on No KYC virtual Visa cards funded from a USDT wallet — a practical crypto Visa card no verification workflow for online payments.',
          },
          {
            type: 'note',
            text:
              '“Anonymous” in marketing often means no government ID upload for issuing — not zero account security. Protect your login, PIN, and card CVV like any payment instrument.',
          },
        ],
      },
      {
        heading: '1) Facebook, TikTok, and performance ads',
        blocks: [
          {
            type: 'p',
            text:
              'Ad platforms usually need a Visa-capable payment method. Reload your virtual Visa with USDT, then attach it to Ads Manager billing. Start small, confirm the charge settles, then scale budgets.',
          },
        ],
      },
      {
        heading: '2) AI subscriptions (ChatGPT Plus and similar)',
        blocks: [
          {
            type: 'p',
            text:
              'Many AI products bill monthly on Visa rails. Keep a dedicated reload amount for subscriptions so ads spend and SaaS renewals do not compete for the same balance.',
          },
        ],
      },
      {
        heading: '3) Developer SaaS and cloud tools',
        blocks: [
          {
            type: 'ul',
            items: [
              'Hosting, domains, email APIs, and design tools that accept Visa online',
              'Short trial upgrades where a local card is hard to use',
              'Separating business tooling spend from personal banking',
            ],
          },
        ],
      },
      {
        heading: '4) Cross-border freelancers and remote teams',
        blocks: [
          {
            type: 'p',
            text:
              'If you earn or hold USDT but need to pay global vendors, a crypto-funded virtual Visa card bridges wallet balances to checkout forms — without waiting on a local bank card application.',
          },
        ],
      },
      {
        heading: '5) What not to use it for',
        blocks: [
          {
            type: 'ul',
            items: [
              'Anything illegal, sanctioned, or against the merchant’s terms',
              'Sharing card details in public chats or with unknown “agents”',
              'Large first purchases before you confirm billing country / 3DS behavior',
            ],
          },
        ],
      },
      {
        heading: 'How to set up your No KYC crypto Visa workflow',
        blocks: [
          {
            type: 'ol',
            items: [
              'Create an account at https://eisymyanmar.com',
              'Deposit USDT (TRC20) into your wallet',
              'Request a virtual Visa card (No KYC issuing)',
              'Reload the amount you need, then pay online',
            ],
          },
          {
            type: 'p',
            text:
              'This is the simplest path to an anonymous-style virtual Visa card experience: crypto in, Visa checkout out — Visa network only.',
          },
        ],
      },
      {
        heading: 'Quick comparison checklist',
        blocks: [
          {
            type: 'ul',
            items: [
              'Network: Visa (Eisy Myanmar does not issue other card brands)',
              'Funding: USDT TRC20 + MMK options in-app',
              'KYC for issuing: not required for virtual Visa card creation',
              'Best for: ads, AI subscriptions, SaaS, online tools',
            ],
          },
        ],
      },
    ],
  },
];

function getAllPosts() {
  return posts.slice().sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

function getPostBySlug(slug) {
  return posts.find((p) => p.slug === String(slug || '').trim()) || null;
}

function getAllSlugs() {
  return posts.map((p) => p.slug);
}

module.exports = {
  SITE_ORIGIN,
  posts,
  getAllPosts,
  getPostBySlug,
  getAllSlugs,
};
