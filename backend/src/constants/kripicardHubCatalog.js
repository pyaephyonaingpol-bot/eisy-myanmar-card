/**
 * Fallback catalog for Kripicard Hub service categories.
 * Used when KRIPICARD_API_KEY is missing or the live API is unavailable.
 * Prices are USD base amounts before the flat $1 processing fee.
 *
 * Shape matches live Kripicard filters: platform + subcategory (group/type).
 */
'use strict';

const KRIPICARD_HUB_CATALOG = {
  sms: [
    {
      product_id: 'sms-us-10min',
      name: 'US SMS number · 10 minutes',
      description: 'Receive one verification SMS on a US number',
      price_usd: 0.8,
      platform: 'WhatsApp',
      subcategory: 'United States',
    },
    {
      product_id: 'sms-uk-10min',
      name: 'UK SMS number · 10 minutes',
      description: 'Receive one verification SMS on a UK number',
      price_usd: 1.2,
      platform: 'Telegram',
      subcategory: 'United Kingdom',
    },
    {
      product_id: 'sms-any-rental-1d',
      name: 'Any country SMS rental · 1 day',
      description: 'Rent a number for repeated SMS for 24 hours',
      price_usd: 4.5,
      platform: 'Any',
      subcategory: 'Rental',
    },
  ],
  sim_topup: [
    {
      product_id: 'sim-topup-5',
      name: 'SIM Top-Up · $5',
      description: 'Mobile airtime credit equivalent to $5',
      price_usd: 5,
      platform: 'MM',
      subcategory: 'Airtime',
    },
    {
      product_id: 'sim-topup-10',
      name: 'SIM Top-Up · $10',
      description: 'Mobile airtime credit equivalent to $10',
      price_usd: 10,
      platform: 'MM',
      subcategory: 'Airtime',
    },
    {
      product_id: 'sim-topup-20',
      name: 'SIM Top-Up · $20',
      description: 'Mobile airtime credit equivalent to $20',
      price_usd: 20,
      platform: 'TH',
      subcategory: 'Airtime',
    },
  ],
  esim: [
    {
      product_id: 'esim-global-1gb-7d',
      name: 'Global eSIM · 1GB / 7 days',
      description: 'Travel data pack with QR activation',
      price_usd: 9,
      platform: 'GL',
      subcategory: '1GB',
    },
    {
      product_id: 'esim-us-5gb-30d',
      name: 'USA eSIM · 5GB / 30 days',
      description: 'US coverage data package',
      price_usd: 18,
      platform: 'US',
      subcategory: '5GB',
    },
    {
      product_id: 'esim-eu-10gb-30d',
      name: 'Europe eSIM · 10GB / 30 days',
      description: 'Multi-country EU data package',
      price_usd: 28,
      platform: 'EU',
      subcategory: '10GB',
    },
  ],
  gift_cards: [
    {
      product_id: 'gift-itunes-10',
      name: 'App Store & iTunes · $10',
      description: 'Digital gift card code delivered by email',
      price_usd: 10,
      platform: 'US',
      subcategory: 'Apple',
    },
    {
      product_id: 'gift-amazon-25',
      name: 'Amazon · $25',
      description: 'Digital gift card code delivered by email',
      price_usd: 25,
      platform: 'US',
      subcategory: 'Amazon',
    },
    {
      product_id: 'gift-google-play-15',
      name: 'Google Play · $15',
      description: 'Digital gift card code delivered by email',
      price_usd: 15,
      platform: 'US',
      subcategory: 'Google',
    },
  ],
  social_media: [
    {
      product_id: 'social-ig-boost-1k',
      name: 'Instagram Followers · 1K',
      description: 'Starter Instagram engagement package',
      price_usd: 6,
      platform: 'Instagram',
      subcategory: 'Followers',
      pricing_model: 'package',
    },
    {
      product_id: 'social-ig-likes-1k',
      name: 'Instagram Likes · 1K',
      description: 'Instagram post likes package',
      price_usd: 3.5,
      platform: 'Instagram',
      subcategory: 'Likes',
      pricing_model: 'per_1000',
    },
    {
      product_id: 'social-tt-boost-1k',
      name: 'TikTok Followers · 1K',
      description: 'Starter TikTok engagement package',
      price_usd: 7,
      platform: 'TikTok',
      subcategory: 'Followers',
      pricing_model: 'package',
    },
    {
      product_id: 'social-x-boost-1k',
      name: 'X / Twitter Followers · 1K',
      description: 'Starter X engagement package',
      price_usd: 5,
      platform: 'X',
      subcategory: 'Followers',
      pricing_model: 'package',
    },
    {
      product_id: 'social-yt-views-1k',
      name: 'YouTube Views · 1K',
      description: 'YouTube view package',
      price_usd: 4,
      platform: 'YouTube',
      subcategory: 'Views',
      pricing_model: 'per_1000',
    },
  ],
  proxies: [
    {
      product_id: 'proxy-residential-1gb',
      name: 'Residential proxy · 1GB',
      description: 'Rotating residential bandwidth',
      price_usd: 8,
      platform: 'residential',
      subcategory: 'Pool',
    },
    {
      product_id: 'proxy-datacenter-30d',
      name: 'Datacenter proxy · 30 days',
      description: 'Dedicated datacenter IP for 30 days',
      price_usd: 12,
      platform: 'datacenter',
      subcategory: 'Static',
    },
    {
      product_id: 'proxy-mobile-5gb',
      name: 'Mobile proxy · 5GB',
      description: 'Mobile carrier IP bandwidth',
      price_usd: 22,
      platform: 'mobile',
      subcategory: 'Pool',
    },
  ],
};

module.exports = {
  KRIPICARD_HUB_CATALOG,
};
