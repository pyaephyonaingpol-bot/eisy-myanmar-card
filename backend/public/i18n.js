/**
 * Eisy Myanmar — lightweight i18n (English / Myanmar)
 * Usage: I18n.t('card_requests'), data-i18n="card_requests" on static elements
 */
(function (global) {
  'use strict';

  const DEFAULT_LANG = (window.Eisy && window.Eisy.config && window.Eisy.config.DEFAULT_LANG) || 'en';
  const STORAGE_KEY = (window.Eisy && window.Eisy.storageKeys && window.Eisy.storageKeys.LANG) || 'eisy_lang';
  const SUPPORTED = ['en', 'my'];

  const messages = {
    en: {
      // Language switcher
      lang_switcher_label: 'Select language',
      lang_my: '🇲🇲 မြန်မာ',
      lang_en: '🇬🇧 EN',

      brand_sub: 'Virtual Card Platform',

      nav_dashboard: 'Dashboard',
      nav_my_cards: 'My Cards',
      nav_instant_card: 'Instant Card',
      instant_card_page_desc: 'No KYC. Fund via Master USDT Wallet (TRC20), then issue Instant Card through Kripicard.',
      cards_apply_heading: 'Get a new card',
      cards_apply_hint: 'Issue Instant Card from your Master USDT Wallet (TRC20).',
      cards_apply_split_hint: 'Open the Instant portal to fund your Master USDT Wallet and issue cards.',
      home_card_purchase_hint: 'Master USDT Wallet · Instant Card (No KYC).',
      nav_deposits: 'Deposit & History',
      nav_p2p: 'P2P Express',
      nav_rates: 'Exchange Rates & Fees',
      nav_profile: 'Profile',
      nav_settings: 'Settings & Security',
      nav_admin_portal: 'Admin Portal',
      nav_user_app: 'User App',

      // Navigation — admin
      nav_admin_deposits: 'Deposits',
      nav_admin_cards: 'Cards',
      nav_admin_users: 'Users',
      nav_admin_transactions: 'Transactions',
      nav_admin_revenue: 'Revenue & Profit',
      nav_admin_support: 'Support',
      nav_admin_kyc: 'KYC Requests',
      nav_admin_settings: 'Rates & Fees',

      // Header / common
      header_signed_in_as: 'Signed in as',
      header_admin_panel: 'Admin control panel',
      header_mmk_wallet: 'MMK Wallet',
      header_usdt_wallet: 'USDT Wallet',
      header_mmk_wallet_hint: 'Bank withdrawal only · no MMK→USDT convert',
      account_menu: 'Account',
      account_security_heading: 'Account & security',
      wallet_actions_label: 'Wallet actions',
      btn_unlock_pin: 'Unlock PIN',
      btn_register_bio: 'Register Biometrics',
      btn_logout: 'Logout',
      btn_refresh: 'Refresh',
      btn_submit: 'Submit',
      btn_cancel: 'Cancel',
      btn_save: 'Save',
      btn_close: 'Close',
      btn_copy: 'Copy',
      btn_clear: 'Clear',
      btn_edit: 'Edit',
      btn_reject: 'Reject',
      btn_approve: 'Approve',
      btn_issue_card: 'Issue Card',
      btn_reload_card: 'Reload Card',
      btn_top_up_usdt: 'Top Up USDT',
      btn_sell_convert_usdt: 'Sell USDT / Convert to MMK',
      btn_scan_pay: 'Scan Pay',
      scan_pay_title: 'Scan Pay',
      scan_pay_hint: 'Choose how to read the payment QR: live camera scan, or upload a saved QR image from your gallery.',
      scan_pay_option_camera_title: 'Camera Scan',
      scan_pay_option_camera_desc: 'Open your device camera and scan a QR code live.',
      scan_pay_option_upload_title: 'Upload QR Image',
      scan_pay_option_upload_desc: 'Pick a saved QR code photo from your gallery or computer.',
      scan_pay_start_camera: 'Start Camera',
      scan_pay_upload_image: 'Upload QR Image',
      scan_pay_back_options: 'Back to options',
      scan_pay_destination: 'Destination',
      scan_pay_network: 'Network',
      scan_pay_rescan: 'Scan Again',
      scan_pay_confirm: 'Confirm & Pay',
      btn_done: 'Done',
      btn_withdraw_usdt: 'Withdraw USDT',
      btn_withdraw_mmk: 'Withdraw to Bank',
      sell_usdt_mmk_title: 'Sell USDT / Convert to MMK',
      sell_usdt_mmk_hint: 'Convert USDT from your wallet to MMK at today\'s admin rate and receive payout to your bank or mobile wallet after review.',
      sell_usdt_mmk_notice_title: 'Processing notice',
      sell_usdt_mmk_notice: 'Withdrawals are processed via Kripicard within 48 hours.',
      sell_usdt_bank_wallet: 'Bank / Wallet',
      sell_usdt_bank_placeholder: '— Select bank or wallet —',
      sell_usdt_bank_required: 'Select a bank or wallet',
      sell_usdt_account_number_phone: 'Account Number / Phone Number',
      sell_usdt_preview: 'Conversion Preview',
      sell_usdt_preview_rate: 'Daily Rate',
      btn_submit_sell_usdt: 'Submit Conversion Request',
      withdraw_usdt_title: 'Withdraw USDT',
      withdraw_usdt_hint: 'Withdrawals are processed via Kripicard within 48 hours. Fee is 4% (3% Kripicard network + 1% platform). Crypto (TRC20/BEP20) or bank payout in MMK.',
      withdraw_mmk_title: 'Withdraw MMK to Bank',
      withdraw_mmk_hint: 'Transfer your MMK wallet balance directly to your bank account. MMK cannot be converted to USDT inside the app.',
      withdraw_payout_method: 'Payout Method',
      withdraw_method_crypto: 'USDT Crypto (Kripicard · 48h)',
      withdraw_method_crypto_hint: 'Kripicard crypto payout (TRC20/BEP20). Fee: 4% (3% network + 1% platform). Processed within 48 hours.',
      withdraw_method_bank: 'Bank Account (USDT → MMK)',
      withdraw_method_bank_hint: 'Convert USDT to MMK at the platform rate via Kripicard. Fee: 4% (3% network + 1% platform). Bank transfer within 48 hours.',
      btn_submit_withdraw: 'Withdraw USDT',
      withdraw_network: 'Network',
      withdraw_wallet_address: 'Destination Wallet Address',
      withdraw_bank_name: 'Bank Name',
      withdraw_account_name: 'Account Holder Name',
      withdraw_account_number: 'Account Number',
      withdraw_amount_usdt: 'Withdrawal Amount (USDT)',
      withdraw_amount_mmk: 'Withdrawal Amount (MMK)',
      withdraw_preview: 'Withdrawal Preview',
      withdraw_preview_method: 'Method',
      withdraw_preview_fee: 'Fee',
      withdraw_preview_net_usdt: 'Net USDT',
      withdraw_preview_mmk_payout: 'MMK to Bank',
      withdraw_preview_net_mmk: 'Net to Bank',
      open_menu: 'Open menu',
      close_menu: 'Close menu',
      copied: 'Copied to clipboard!',
      loading: 'Loading…',
      dev_mode: 'Dev mode',

      // Rates
      current_rate: 'Current Rate',
      current_rate_loading: 'Current Rate: loading…',
      todays_exchange_rate: "Today's Exchange Rate",
      todays_rate: "Today's rate",

      // Wallet / home
      wallet_overview: 'Wallet Overview',
      pin_protected: 'PIN Protected',
      wallet_deposit: 'Wallet Deposit',
      issue_card: 'Issue Card',
      reload_card_action: 'Reload Card',
      quick_actions: 'Quick Actions',
      view_my_cards: 'View My Cards',
      make_deposit: 'Make a Deposit',
      view_rates_fees: 'View Rates & Fees',
      activity_log: 'Activity Log',
      active_requests: 'Active Requests',
      view_history: 'View History',
      active_requests_hint: 'Track card and deposit requests awaiting admin approval.',
      loading_requests: 'Loading requests…',
      name: 'Name',
      email: 'Email',
      phone: 'Phone',
      profile_heading: 'Profile',
      profile_page_desc: 'Your account details, contact info, and selected card status.',
      profile_overview_heading: 'Account Overview',
      profile_hint: 'Update your display name and phone number alongside your sign-in email.',
      profile_email_readonly: 'Email is used for sign-in and cannot be changed here.',
      profile_phone_optional: '(optional)',
      btn_save_profile: 'Save Profile',
      btn_open_profile: 'Open Profile',
      settings_profile_link_hint: 'Name, email, phone, and card status are on your Profile page.',
      home_card_purchase_heading: 'Get a Virtual Card',
      selected_card: 'Selected Card',
      card_status: 'Card Status',
      usdt_wallet_hint: 'Kripicard deposit (unique pay address) · min $20 · 1 USDT ≈ 1 USD to card (after fee)',
      nav_usdt_wallet: 'USDT Wallet',
      btn_manage_usdt_wallet: 'Manage Wallet',
      usdt_wallet_page_title: 'USDT Wallet',
      usdt_wallet_page_desc: 'View your platform balance, copy deposit addresses (TRC20), link external wallets, and track USDT activity.',
      usdt_wallet_balance_heading: 'Your USDT Balance',
      usdt_deposit_addresses: 'Kripicard Deposits',
      usdt_deposit_addresses_hint: 'Top up via Kripicard to receive a unique pay address, exact amount, and network (e.g. Tron). Withdrawals are paid via Kripicard within 48 hours (4% markup).',
      usdt_link_external_wallet: 'Link External Wallet',
      usdt_link_external_hint: 'Save a personal TRC20 address for withdrawals and optional on-chain balance checks.',
      network: 'Network',
      wallet_address: 'Wallet Address',
      label_optional: 'Label (optional)',
      link_wallet: 'Link Wallet',
      no_linked_wallets: 'No linked wallets yet.',
      usdt_transaction_history: 'USDT Transaction History',
      refresh: 'Refresh',
      usdt_available_balance: 'Available',
      usdt_locked_balance: 'Locked (Escrow)',
      usdt_total_balance: 'Total',
      usdt_escrow_holds: 'Active Escrow Holds',
      usdt_escrow_holds_hint: 'USDT locked during active P2P trades. Released to the buyer when the trade completes, or returned to you if cancelled.',
      usdt_internal_transfer: 'Send USDT to Another User',
      usdt_internal_transfer_hint: 'Instant internal transfer from your available USDT balance. The recipient must have an Eisy Myanmar account.',
      recipient_email: 'Recipient email',
      amount_usdt: 'Amount (USDT)',
      note_optional: 'Note (optional)',
      send_usdt: 'Send USDT',

      // Cards page
      cards_page_desc: 'View card status, reveal details when needed, and reload your virtual cards.',
      your_virtual_cards: 'Your Virtual Cards',
      prev_card: '‹ Prev',
      next_card: 'Next ›',
      apply_new_card: 'Apply for New Card',
      apply_new_card_hint: 'Pay from your Master USDT Wallet (TRC20), then issue Instant Card.',
      apply_instant_card: 'Instant Card (No KYC)',
      apply_instant_card_hint: 'No KYC required. Pay from your Master USDT Wallet (TRC20), then issue Instant Card.',
      top_up_master_wallet: 'Top up USDT Wallet',
      top_up_usdt_wallet: 'Top up USDT Wallet',
      master_wallet_balance_label: 'USDT Wallet',
      instant_usdt_wallet_balance_label: 'Master USDT Wallet',
      pay_master_wallet_issuance: 'USDT Wallet (1 USDT ≈ 1 USD — Instant Card only)',
      card_flow_desc_instant: 'Master USDT Wallet + Instant Card (No KYC).',
      portal_hub_heading: 'Kripicard Hub',
      portal_hub_hint: 'Open Instant Card or buy Kripicard services. Every service purchase adds a flat $1.00 USD processing fee.',
      portal_hub_instant_title: 'Instant',
      portal_hub_instant_desc: 'Master USDT Wallet · Instant Card (No KYC)',
      hub_cat_sms_title: 'SMS',
      hub_cat_sms_desc: 'Temporary numbers for SMS verification',
      hub_cat_sim_topup_title: 'SIM Top-Up',
      hub_cat_sim_topup_desc: 'Mobile airtime top-ups worldwide',
      hub_cat_esim_title: 'eSIM',
      hub_cat_esim_desc: 'Global data eSIM packages',
      hub_cat_gift_cards_title: 'Gift Cards',
      hub_cat_gift_cards_desc: 'Digital gift cards from top brands',
      hub_cat_social_media_title: 'Social Media',
      hub_cat_social_media_desc: 'Social account tools and boosts',
      hub_cat_proxies_title: 'Proxies',
      hub_cat_proxies_desc: 'Residential and datacenter proxies',
      hub_cat_webhooks_title: 'Webhooks',
      hub_cat_webhooks_desc: 'Webhook delivery and event tooling',
      hub_processing_fee_chip: '+$1.00 fee',
      hub_processing_fee_notice: 'A flat $1.00 USD processing fee is added to every purchase.',
      hub_service_loading: 'Loading services…',
      hub_service_back: '← Categories',
      instant_app_wallet_heading: 'Master USDT Wallet (Instant)',
      instant_app_wallet_desc: 'Internal Master USDT balance. Top up via Kripicard (unique pay address), then issue Instant Card (No KYC). Withdrawals are paid via Kripicard within 48 hours.',
      instant_trc20_deposit_label: 'Kripicard deposit',
      instant_trc20_deposit_hint: 'Each top-up issues a unique pay address, exact amount, and network (e.g. Tron). Min $20 USDT.',
      instant_kripicard_deposit_label: 'Kripicard deposit',
      instant_kripicard_deposit_hint: 'Each top-up issues a unique pay address, exact amount, and network (e.g. Tron). Min $20 USDT.',
      instant_withdraw_legacy_hint: 'Withdrawals are paid via Kripicard within 48 hours (4% markup: 3% network + 1% platform).',
      refresh_instant_deposit: 'Refresh address',
      home_card_purchase_heading_instant: 'Get Instant Card',
      home_card_purchase_hint_instant: 'Master USDT Wallet · Instant Card (No KYC).',
      kyc_verified: 'Verified',
      kyc_unverified: 'Unverified — KYC required',
      btn_copy: 'Copy',
      pill_instant_card: 'Instant Card',
      pill_no_kyc: 'No KYC',
      pill_verified: 'Verified',
      submit_instant_card: 'Issue Instant Card',
      select_card_bin: 'Select a card BIN',
      top_up_usdt_first: 'Top up USDT Wallet first',
      card_bin: 'Card BIN',
      pill_kyc_required: 'Verified',
      initial_card_load: 'Initial Card Load Amount (USD)',
      min_initial_deposit: 'Minimum initial deposit: $10.00',
      name_on_card: 'Name on Card',
      name_on_card_required: 'Enter the name on card (min 2 characters)',
      pay_from: 'Pay From',
      pay_usdt_wallet_issuance: 'USDT Wallet (1 USDT ≈ 1 USD — instant issue)',
      usdt_parity_rate: '1 USDT ≈ 1 USD',
      card_issued_ok: 'Your virtual card is ready.',
      card_issued_log: 'Card issued — {amount}',
      pay_mmk_wallet_reload: 'MMK Wallet — card reloads only (instant)',
      pay_usdt_wallet_reload: 'USDT Wallet (Instant — 1:1 USD)',
      initial_card_load_row: 'Initial Card Load',
      card_issuance_fee: '+ Card Issuance Fee',
      card_funding_fee: '+ Funding Fee',
      card_processing_fee: '+ Processing Fee',
      total_usd_required: '= Total USD Required',
      total_payable_usdt: 'Total Payable (USDT)',
      submit_card_request: 'Issue Instant Card',
      virtual_card: 'Virtual Card',
      status: 'Status',
      show_card_details: 'Show Card Details',
      hide_card_details: 'Hide Card Details',
      top_up_card: 'Top Up Card',
      top_up_reload_card: 'Top Up / Reload Card',
      card_detail_modal_title: 'Card Details',
      btn_delete_card: 'Delete Card',
      card_delete_hint: 'Removes this card from My Cards. Pending requests are cancelled; issued cards stay in records for history.',
      card_delete_confirm: 'Remove this card from My Cards? Pending requests will be cancelled.',
      card_balance: 'Balance',
      card_created: 'Created',
      balance_pending: 'Balance pending',
      card_pending_notice: 'This card request is pending admin approval. You\'ll receive your card number once issued.',
      card_reload_history: 'Card Reload History',
      card_reload_history_hint: 'Top-up requests to your virtual card — wallet funds are held until admin approves.',
      loading_reload_history: 'Loading reload history…',
      copy_card_number: 'Copy Card Number',
      copy_all_details: 'Copy All Details',
      holder: 'HOLDER',
      exp: 'EXP',
      cvv: 'CVV',

      // Deposits page
      deposits_page_title: 'Deposit & Reload History',
      deposits_page_desc: 'Reload a virtual card or top up your USDT wallet via Kripicard. Each deposit gets a unique pay address and exact amount.',
      reload_topup_card: 'Reload / Top-Up Card',
      reload_topup_hint: 'Select a card and pay from your wallet. Funds are deducted immediately and held until admin approves the reload.',
      start_card_reload: 'Start Card Reload',
      top_up_wallet: 'Top Up Wallet',
      deposit_tab_mmk: 'MMK (Manual - KPay / WavePay)',
      deposit_tab_usdt: 'USDT (Kripicard)',
      deposit_usdt_hint: 'Top up via Kripicard Deposit: we issue a unique pay-to address and exact amount for your network (e.g. Tron). Your Master Wallet is credited after on-chain confirmation.',
      deposit_usdt_fee_hint: 'Kripicard gateway fee is deducted — net credit is confirmed when your pay address is issued',
      deposit_network_label: 'Network',
      deposit_network_hint: 'Each deposit gets a unique address on the selected network.',
      deposit_fee_preview: 'Deposit Fee Preview',
      deposit_preview_gross: 'Amount to send',
      deposit_preview_fee: 'Gateway Fee',
      deposit_preview_net: 'Net Credited',
      btn_deposit_tron: 'Get Pay Address',
      btn_deposit_creating: 'Issuing pay address…',
      btn_deposit_tron_waiting: 'Waiting for payment…',
      deposit_usdt_order_label: 'Deposit Order ID',
      copy_order_id: 'Copy Order ID',
      deposit_address_label: 'Pay Address',
      copy_address: 'Copy Address',
      deposit_send_amount: 'Exact amount to send',
      deposit_pay_network: 'Network',
      usdt_order_status_pending: 'Waiting for USDT transfer — verifying automatically…',
      usdt_order_status_verifying: 'Payment detected — confirming on chain…',
      usdt_order_status_completed: 'Payment confirmed — Master Wallet credited!',
      usdt_deposit_success_toast: 'USDT deposit confirmed — Master Wallet credited!',
      mmk_wallet_restriction: 'MMK wallet is for bank withdrawals only. Deposits and card reloads require USDT. MMK → USDT conversion is not available.',
      deposit_mmk_hint: 'Top up via KBZPay or WavePay. Upload transaction proof & TxID after payment.',
      amount_mmk: 'Amount (MMK)',
      method: 'Method',
      generate_ref_deposit: 'Generate Ref Code & Deposit',

      // Modal — reload
      reload_modal_title: 'Reload / Top-Up Card',
      reload_modal_hint: 'Pay from your USDT wallet (1 USDT ≈ 1 USD). Funds are added to your selected card after admin approval.',
      target_card: 'Target Card',
      select_active_card: '— Select an active card —',
      only_active_cards: 'Only active cards are shown.',
      topup_amount_mmk: 'Top-Up Amount (MMK)',
      topup_amount_usdt: 'Top-Up Amount (USDT)',
      reload_min_mmk_hint: 'Minimum top-up: 10,000 MMK — $3.50 USD service fee added on top',
      reload_min_usdt_hint: 'Minimum top-up: $5.00 USDT — service fee added on top',

      // Admin — deposits
      wallet_deposit_requests: 'Wallet Deposit Requests',
      all_statuses: 'All statuses',
      pending_review: 'Pending review',
      verified: 'Verified',
      rejected: 'Rejected',
      loading_deposits: 'Loading deposits…',
      p2p_disputes: 'P2P Disputes — Needs Review',
      p2p_disputes_hint: 'Users flagged orders with payment proof. Force-release USDT or refund escrow after review.',
      loading_disputes: 'Loading disputes…',

      // Admin — cards
      virtual_card_management: 'Virtual Card Management',
      virtual_card_mgmt_hint: 'Approve card applications and reload requests — no per-transaction spending management.',
      card_requests: 'Card Requests',
      card_requests_hint: 'Pending applications awaiting manual card details from admin.',
      loading_card_requests: 'Loading card requests…',
      issue_update_card: 'Issue / Update Card',
      issue_update_card_hint: 'Issue a new card manually or edit an existing issued card — click Edit in the table below to pre-fill this form.',
      user_id: 'User ID',
      card_id: 'Card ID',
      card_id_placeholder: 'Leave empty to issue new',
      card_number: 'Card Number',
      expiry: 'Expiry (MM/YY)',
      admin_notes: 'Admin Notes',
      admin_notes_placeholder: 'Optional internal note',
      clear_form: 'Clear Form',
      save_changes_update: 'Save Changes / Update Card',
      issued_cards_status: 'Issued Cards — Status Control',
      issued_cards_hint: 'Update lifecycle status for issued virtual cards. Optional reason is shown to the user when suspended or frozen.',
      loading_issued_cards: 'Loading issued cards…',
      card_reload_requests: 'Card Reload Requests',
      card_reload_requests_hint: 'Wallet funds were deducted when the user submitted — approve to credit the card or reject to refund.',
      loading_reload_requests: 'Loading reload requests…',
      no_pending_card_requests: 'No pending card requests.',
      no_pending_reloads: 'No pending card reload requests.',
      no_issued_cards: 'No issued virtual cards yet.',

      // Status labels
      pending_approval: 'Pending Approval',
      pending_issuance: 'PENDING_ISSUANCE',
      active: 'ACTIVE',
      suspended: 'SUSPENDED',
      frozen: 'FROZEN',
      terminated: 'TERMINATED',
      pending: 'Pending',

      // Card wallet hints
      card_wallet_ok_usdt: 'Master USDT wallet sufficient — {{available}} available ({{required}} required). Instant Card will be issued.',
      card_wallet_err_usdt: 'Insufficient Master USDT wallet. Need {{required}}, you have {{available}}. Top up first.',
      card_request_submitted: 'Card issued successfully!',
      card_request_submitted_log: 'Card purchase — {{amount}} deducted from USDT wallet',
      card_request_pending_msg: 'Payment received. Finalizing your card…',
      card_request_deducted: '{{amount}} deducted from your USDT wallet.',

      // Settings
      settings_security: 'Settings & Security',
      kyc_verification: 'KYC Verification',
      identity_status: 'Identity status:',
      kyc_hint: 'Required for P2P trading and verified banking features.',
      complete_kyc: 'Complete KYC',
      account: 'Account',
      support: 'Support',
      subject: 'Subject',
      message: 'Message',
      open_support_ticket: 'Open Support Ticket',

      // Table headers
      th_id: 'ID',
      th_user: 'User',
      th_status: 'Status',
      th_holder: 'Holder',
      th_pricing: 'Pricing',
      th_deposit_ref: 'Deposit Ref',
      th_requested: 'Requested',
      th_actions: 'Actions',
      th_amount: 'Amount',
      th_date: 'Date',
      th_card: 'Card',
      th_type: 'Type',
      th_description: 'Description',

      // Auth
      sign_in: 'Sign In',
      register: 'Register',
      send_otp: 'Send OTP',
      verify_pin: 'Verify PIN',
      forgot_pin: 'Forgot PIN — email reset',
    },
    my: {
      lang_switcher_label: 'ဘာသာစကား ရွေးချယ်ရန်',
      lang_my: '🇲🇲 မြန်မာ',
      lang_en: '🇬🇧 EN',

      brand_sub: 'Virtual Card Platform',

      nav_dashboard: 'ဒက်ရှ်ဘုတ်',
      nav_my_cards: 'ကျွန်ုပ်၏ ကဒ်များ',
      nav_instant_card: 'Instant Card',
      instant_card_page_desc: 'KYC မလို။ Master USDT Wallet (TRC20) ဖြင့် ငွေဖြည့်ပြီး Kripicard မှ Instant Card ထုတ်ပါ။',
      cards_apply_heading: 'ကဒ်အသစ်ရယူရန်',
      cards_apply_hint: 'Master USDT Wallet (TRC20) မှ Instant Card ထုတ်ပါ။',
      cards_apply_split_hint: 'Instant portal ကို ဖွင့်ပြီး Master USDT Wallet ဖြင့် ကဒ်ထုတ်ပါ။',
      home_card_purchase_hint: 'Master USDT Wallet · Instant Card (No KYC).',
      nav_deposits: 'ငွေသွင်း & မှတ်တမ်း',
      nav_p2p: 'P2P Express',
      nav_rates: 'လဲလှယ်နှုန်း & အခကြေးငွေ',
      nav_profile: 'ပရိုဖိုင်',
      nav_settings: 'ဆက်တင်များ & လုံခြုံရေး',
      nav_admin_portal: 'Admin Portal',
      nav_user_app: 'User App',

      nav_admin_deposits: 'ငွေသွင်းမှုများ',
      nav_admin_cards: 'ကဒ်များ',
      nav_admin_users: 'အသုံးပြုသူများ',
      nav_admin_transactions: 'ငွေလွှဲမှုများ',
      nav_admin_revenue: 'ဝင်ငွေ & အမြတ်',
      nav_admin_support: 'Support',
      nav_admin_kyc: 'KYC တောင်းဆိုမှုများ',
      nav_admin_settings: 'လဲလှယ်နှုန်း & အခကြေးငွေ',

      header_signed_in_as: 'ဝင်ရောက်ထားသူ',
      header_admin_panel: 'Admin ထိန်းချုပ်မှု',
      header_mmk_wallet: 'MMK ပိုက်ဆံအိတ်',
      header_usdt_wallet: 'USDT ပိုက်ဆံအိတ်',
      header_mmk_wallet_hint: 'ဘဏ်ထုတ်ယူခြင်းသာ · MMK→USDT ပြောင်းလဲမှု မရှိ',
      account_menu: 'အကောင့်',
      account_security_heading: 'အကောင့် & လုံခြုံရေး',
      wallet_actions_label: 'ပိုက်ဆံအိတ် လုပ်ဆောင်ချက်များ',
      btn_unlock_pin: 'PIN ဖွင့်ရန်',
      btn_register_bio: 'Biometrics မှတ်ပုံတင်ရန်',
      btn_logout: 'ထွက်ရန်',
      btn_refresh: 'ပြန်လည်ဖတ်ရန်',
      btn_submit: 'တင်သွင်းမည်',
      btn_cancel: 'ပယ်ဖျက်မည်',
      btn_save: 'သိမ်းမည်',
      btn_close: 'ပိတ်မည်',
      btn_copy: 'ကူးယူမည်',
      btn_clear: 'ရှင်းလင်းမည်',
      btn_edit: 'ပြင်ဆင်မည်',
      btn_reject: 'ငြင်းပယ်မည်',
      btn_approve: 'အတည်ပြုမည်',
      btn_issue_card: 'ကဒ်ထုတ်ပေးမည်',
      btn_reload_card: 'ကဒ် Reload',
      btn_top_up_usdt: 'USDT ဖြည့်မည်',
      btn_sell_convert_usdt: 'USDT ရောင်းမည် / MMK သို့ပြောင်းမည်',
      btn_scan_pay: 'Scan Pay',
      scan_pay_title: 'Scan Pay',
      scan_pay_hint: 'Camera စကင် သို့မဟုတ် သိမ်းထားသော QR ပုံတင်ပြီး ပေးချေနိုင်သည်။',
      scan_pay_option_camera_title: 'Camera Scan',
      scan_pay_option_camera_desc: 'ကင်မရာဖွင့်ပြီး QR ကို တိုက်ရိုက်စကင်ဖတ်ပါ။',
      scan_pay_option_upload_title: 'QR ပုံတင်ရန်',
      scan_pay_option_upload_desc: 'ဂယ်လရီ သို့မဟုတ် ကွန်ပျူတာမှ QR ပုံရွေးပါ။',
      scan_pay_start_camera: 'Camera ဖွင့်ရန်',
      scan_pay_upload_image: 'QR ပုံတင်ရန်',
      scan_pay_back_options: 'ရွေးချယ်မှုသို့ ပြန်ရန်',
      scan_pay_destination: 'ပေးပို့ရန် လိပ်စာ',
      scan_pay_network: 'Network',
      scan_pay_rescan: 'ပြန်စကင်ရန်',
      scan_pay_confirm: 'အတည်ပြုပြီး ပေးချေမည်',
      btn_done: 'ပြီးပါပြီ',
      btn_withdraw_usdt: 'USDT ထုတ်ယူမည်',
      btn_withdraw_mmk: 'ဘဏ်သို့ ထုတ်ယူမည်',
      sell_usdt_mmk_title: 'USDT ရောင်းမည် / MMK သို့ပြောင်းမည်',
      sell_usdt_mmk_hint: 'ယနေ့ admin နှုန်းဖြင့် USDT ကို MMK သို့ပြောင်းပြီး ဘဏ်/ပိုက်ဆံအိတ်သို့ အတည်ပြုပြီးနောက် ပေးချေမည်။',
      sell_usdt_mmk_notice_title: 'လုပ်ငန်းစဉ် အသိပေးချက်',
      sell_usdt_mmk_notice: 'Kripicard ဖြင့် ငွေထုတ်ယူမှုများကို ၄၈ နာရီအတွင်း လုပ်ဆောင်ပေးမည်။',
      sell_usdt_bank_wallet: 'ဘဏ် / ပိုက်ဆံအိတ်',
      sell_usdt_bank_placeholder: '— ဘဏ် သို့မဟုတ် ပိုက်ဆံအိတ် ရွေးပါ —',
      sell_usdt_bank_required: 'ဘဏ် သို့မဟုတ် ပိုက်ဆံအိတ် ရွေးပါ',
      sell_usdt_account_number_phone: 'အကောင့်နံပါတ် / ဖုန်းနံပါတ်',
      sell_usdt_preview: 'ပြောင်းလဲမှု အနှစ်ချုပ်',
      sell_usdt_preview_rate: 'နေ့စဉ် နှုန်း',
      btn_submit_sell_usdt: 'ပြောင်းလဲမှု တောင်းဆိုမည်',
      withdraw_usdt_title: 'USDT ထုတ်ယူမည်',
      withdraw_usdt_hint: 'Kripicard ဖြင့် ၄၈ နာရီအတွင်း ငွေထုတ်ပေးသည်။ Fee ၄% (Kripicard network ၃% + platform ၁%)။ Crypto (TRC20/BEP20) သို့မဟုတ် MMK ဘဏ်ထုတ်ပေးမှု။',
      withdraw_mmk_title: 'MMK ကို ဘဏ်သို့ ထုတ်ယူမည်',
      withdraw_mmk_hint: 'MMK ပိုက်ဆံအိတ်မှ တိုက်ရိုက် ဘဏ်အကောင့်သို့ ထုတ်ယူနိုင်သည်။ App အတွင်း MMK ကို USDT သို့ မပြောင်းနိုင်ပါ။',
      withdraw_payout_method: 'ထုတ်ယူနည်းလမ်း',
      withdraw_method_crypto: 'USDT Crypto (Kripicard · ၄၈ နာရီ)',
      withdraw_method_crypto_hint: 'Kripicard crypto payout (TRC20/BEP20)။ Fee: ၄% (network ၃% + platform ၁%)။ ၄၈ နာရီအတွင်း လုပ်ဆောင်မည်။',
      withdraw_method_bank: 'ဘဏ်အကောင့် (USDT → MMK)',
      withdraw_method_bank_hint: 'USDT ကို ပလက်ဖောင်းနှုန်းဖြင့် MMK သို့ ပြောင်းပြီး Kripicard ဖြင့် ဘဏ်လွှဲမည်။ Fee: ၄%။ ၄၈ နာရီအတွင်း။',
      btn_submit_withdraw: 'USDT ထုတ်ယူမည်',
      withdraw_network: 'Network',
      withdraw_wallet_address: 'Wallet လိပ်စာ',
      withdraw_bank_name: 'ဘဏ်အမည်',
      withdraw_account_name: 'အကောင့်ပိုင်ရှင်အမည်',
      withdraw_account_number: 'အကောင့်နံပါတ်',
      withdraw_amount_usdt: 'ထုတ်ယူမည့် ပမာဏ (USDT)',
      withdraw_amount_mmk: 'ထုတ်ယူမည့် ပမာဏ (MMK)',
      withdraw_preview: 'ထုတ်ယူမှု ကြိုတင်ကြည့်ရှု',
      withdraw_preview_method: 'နည်းလမ်း',
      withdraw_preview_fee: 'အခကြေးငွေ',
      withdraw_preview_net_usdt: 'Net USDT',
      withdraw_preview_mmk_payout: 'ဘဏ်သို့ MMK',
      withdraw_preview_net_mmk: 'ဘဏ်သို့ ရောက်မည့်ငွေ',
      open_menu: 'မီနူးဖွင့်ရန်',
      close_menu: 'မီနူးပိတ်ရန်',
      copied: 'ကလစ်ဘုတ်သို့ ကူးယူပြီးပါပြီ!',
      loading: 'ဖတ်နေသည်…',
      dev_mode: 'Dev mode',

      current_rate: 'လက်ရှိ ပေါက်ဈေး',
      current_rate_loading: 'လက်ရှိ ပေါက်ဈေး: ဖတ်နေသည်…',
      todays_exchange_rate: 'ယနေ့ လဲလှယ်နှုန်း',
      todays_rate: 'ယနေ့ နှုန်း',

      wallet_overview: 'ပိုက်ဆံအိတ် အကျဉ်းချုပ်',
      pin_protected: '🔒 PIN ကာကွယ်ထား',
      wallet_deposit: 'ပိုက်ဆံအိတ် ငွေသွင်းရန်',
      issue_card: 'ကဒ်ထုတ်ယူမည်',
      reload_card_action: 'ကဒ် Reload',
      quick_actions: 'အမြန်လုပ်ဆောင်ချက်များ',
      view_my_cards: 'ကျွန်ုပ်၏ ကဒ်များ',
      make_deposit: 'ငွေသွင်းမည်',
      view_rates_fees: 'လဲလှယ်နှုန်း & အခကြေးငွေ',
      activity_log: 'လုပ်ဆောင်ချက် မှတ်တမ်း',
      active_requests: 'တ актив တောင်းဆိုမှုများ',
      view_history: 'မှတ်တမ်းကြည့်ရန်',
      active_requests_hint: 'Admin အတည်ပြုရန် စောင့်ဆိုင်းနေသော ကဒ်/ငွေသွင်း တောင်းဆိုမှုများ။',
      loading_requests: 'တောင်းဆိုမှုများ ဖတ်နေသည်…',
      name: 'အမည်',
      email: 'အီးမေးလ်',
      phone: 'ဖုန်း',
      profile_heading: 'ပရိုဖိုင်',
      profile_page_desc: 'အကောင့်အချက်အလက်၊ ဆက်သွယ်ရန် အချက်အလက်နှင့် ရွေးထားသော ကဒ် အခြေအနေ။',
      profile_overview_heading: 'အကောင့် အကျဉ်းချုပ်',
      profile_hint: 'အကောင့်ဝင်ရန် အီးမေးလ်နှင့်အတူ အမည်နှင့် ဖုန်းနံပါတ်ကို ပြင်ဆင်ပါ။',
      profile_email_readonly: 'အီးမေးလ်သည် ဝင်ရောက်ရန် အသုံးပြုသောကြောင့် ဤနေရာတွင် မပြောင်းလဲနိုင်ပါ။',
      profile_phone_optional: '(မဖြစ်မနေ မဟုတ်)',
      btn_save_profile: 'ပရိုဖိုင် သိမ်းမည်',
      btn_open_profile: 'ပရိုဖိုင် ဖွင့်ရန်',
      settings_profile_link_hint: 'အမည်၊ အီးမေးလ်၊ ဖုန်းနှင့် ကဒ် အခြေအနေကို ပရိုဖိုင် စာမျက်နှာတွင် ကြည့်ရှုနိုင်ပါသည်။',
      home_card_purchase_heading: 'Virtual Card ရယူရန်',
      selected_card: 'ရွေးချယ်ထားသော ကဒ်',
      card_status: 'ကဒ် အခြေအနေ',
      usdt_wallet_hint: 'Kripicard ငွေသွင်း (unique pay address) · အနည်းဆုံး $20 · 1 USDT ≈ 1 USD (အခကြေးငွေနှင့်အတူ)',
      nav_usdt_wallet: 'USDT Wallet',
      btn_manage_usdt_wallet: 'Wallet စီမံ',
      usdt_wallet_page_title: 'USDT Wallet',
      usdt_wallet_page_desc: 'လက်ကျန်ငွေ၊ deposit လိပ်စာ (TRC20/BEP20/ERC20) နှင့် transaction များ ကြည့်ရှုပါ။',
      usdt_wallet_balance_heading: 'သင့် USDT လက်ကျန်',
      usdt_deposit_addresses: 'Kripicard ငွေသွင်း',
      usdt_deposit_addresses_hint: 'Kripicard ဖြင့် ငွေဖြည့်ပါ — unique pay address၊ exact ပမာဏနှင့် network (ဥပမာ Tron) ရရှိမည်။ ငွေထုတ်ယူမှုကို Kripicard ဖြင့် ၄၈ နာရီအတွင်း ပေးချေသည် (၄% markup)။',
      usdt_link_external_wallet: 'External Wallet ချိတ်ဆက်',
      usdt_link_external_hint: 'TRC20, BEP20 သို့မဟုတ် ERC20 လိပ်စာကို သိမ်းဆည်းပါ။',
      network: 'Network',
      wallet_address: 'Wallet လိပ်စာ',
      label_optional: 'Label (optional)',
      link_wallet: 'Wallet ချိတ်ဆက်',
      no_linked_wallets: 'ချိတ်ဆက်ထားသော wallet မရှိသေးပါ။',
      usdt_transaction_history: 'USDT Transaction မှတ်တမ်း',
      refresh: 'Refresh',
      usdt_available_balance: 'Available',
      usdt_locked_balance: 'Locked (Escrow)',
      usdt_total_balance: 'Total',
      usdt_escrow_holds: 'Active Escrow Holds',
      usdt_escrow_holds_hint: 'P2P trade အတွင်း lock ထားသော USDT — trade ပြီးသွားရင် buyer ထံ release၊ cancel ဖြစ်ရင် ပြန်ရမည်။',
      usdt_internal_transfer: 'အခြား User ထံ USDT ပို့',
      usdt_internal_transfer_hint: 'Available USDT မှ ချက်ချင်း internal transfer ပြုလုပ်ပါ။',
      recipient_email: 'Recipient email',
      amount_usdt: 'Amount (USDT)',
      note_optional: 'Note (optional)',
      send_usdt: 'Send USDT',

      cards_page_desc: 'ကဒ်အခြေအနေ ကြည့်ရှု၊ လိုအပ်ပါက အသေးစိတ်ပြသခြင်း၊ virtual card များကို reload လုပ်ပါ။',
      your_virtual_cards: 'သင်၏ Virtual Cards',
      prev_card: '‹ ယခင်',
      next_card: 'နောက် ›',
      apply_new_card: 'ကဒ်အသစ် လျှောက်ထားရန်',
      apply_new_card_hint: 'Master USDT Wallet (TRC20) မှ ပေးချေပြီး Instant Card ထုတ်ပါ။',
      apply_instant_card: 'Instant Card (No KYC)',
      apply_instant_card_hint: 'KYC မလိုပါ။ Master USDT Wallet (TRC20) မှ ပေးချေပြီး Instant Card ထုတ်ပါ။',
      submit_instant_card: 'Instant Card ထုတ်မည်',
      select_card_bin: 'Card BIN ရွေးပါ',
      top_up_usdt_first: 'USDT Wallet အရင် ငွေဖြည့်ပါ',
      top_up_master_wallet: 'USDT Wallet ငွေဖြည့်မည်',
      top_up_usdt_wallet: 'USDT Wallet ငွေဖြည့်မည်',
      master_wallet_balance_label: 'USDT Wallet',
      instant_usdt_wallet_balance_label: 'Master USDT Wallet',
      pay_master_wallet_issuance: 'USDT Wallet (1 USDT ≈ 1 USD — Instant Card သာ)',
      card_flow_desc_instant: 'Master USDT Wallet + Instant Card (No KYC).',
      card_bin: 'Card BIN',
      portal_hub_heading: 'Kripicard Hub',
      portal_hub_hint: 'Instant Card သို့မဟုတ် Kripicard ဝန်ဆောင်မှုများ။ ဝယ်ယူမှုတိုင်းတွင် $1.00 USD processing fee ပေါင်းထည့်သည်။',
      portal_hub_instant_title: 'Instant',
      portal_hub_instant_desc: 'Master USDT Wallet · Instant Card (No KYC)',
      hub_cat_sms_title: 'SMS',
      hub_cat_sms_desc: 'SMS အတည်ပြုရန် ယာယီ ဖုန်းနံပါတ်',
      hub_cat_sim_topup_title: 'SIM Top-Up',
      hub_cat_sim_topup_desc: 'ကမ္ဘာအနှံ့ မိုဘိုင်း လက်ကျန်ဖြည့်',
      hub_cat_esim_title: 'eSIM',
      hub_cat_esim_desc: 'ကမ္ဘာလုံးဆိုင်ရာ eSIM ဒေတာပက်ကေ့ချ်',
      hub_cat_gift_cards_title: 'Gift Cards',
      hub_cat_gift_cards_desc: 'နာမည်ကြီး brand များ၏ digital gift cards',
      hub_cat_social_media_title: 'Social Media',
      hub_cat_social_media_desc: 'Social account tools နှင့် boosts',
      hub_cat_proxies_title: 'Proxies',
      hub_cat_proxies_desc: 'Residential နှင့် datacenter proxies',
      hub_cat_webhooks_title: 'Webhooks',
      hub_cat_webhooks_desc: 'Webhook delivery နှင့် event tooling',
      hub_processing_fee_chip: '+$1.00 fee',
      hub_processing_fee_notice: 'ဝယ်ယူမှုတိုင်းတွင် $1.00 USD processing fee ပေါင်းထည့်သည်။',
      hub_service_loading: 'ဝန်ဆောင်မှုများ ဖွင့်နေသည်…',
      hub_service_back: '← အမျိုးအစားများ',
      instant_app_wallet_heading: 'Master USDT Wallet (Instant)',
      instant_app_wallet_desc: 'Master USDT လက်ကျန်။ Kripicard (unique pay address) ဖြင့် ငွေဖြည့်ပြီး Instant Card (No KYC) ထုတ်ပါ။ ငွေထုတ်ယူမှုကို Kripicard ဖြင့် ၄၈ နာရီအတွင်း ပေးချေသည်။',
      instant_trc20_deposit_label: 'Kripicard ငွေသွင်း',
      instant_trc20_deposit_hint: 'ငွေဖြည့်တိုင်း unique pay address၊ exact ပမာဏနှင့် network (ဥပမာ Tron) ထုတ်ပေးသည်။ အနည်းဆုံး $20 USDT။',
      instant_kripicard_deposit_label: 'Kripicard ငွေသွင်း',
      instant_kripicard_deposit_hint: 'ငွေဖြည့်တိုင်း unique pay address၊ exact ပမာဏနှင့် network (ဥပမာ Tron) ထုတ်ပေးသည်။ အနည်းဆုံး $20 USDT။',
      instant_withdraw_legacy_hint: 'ငွေထုတ်ယူမှုကို Kripicard ဖြင့် ၄၈ နာရီအတွင်း ပေးချေသည် (၄% markup: network ၃% + platform ၁%)။',
      refresh_instant_deposit: 'လိပ်စာ ပြန်ယူမည်',
      home_card_purchase_heading_instant: 'Instant Card ရယူမည်',
      home_card_purchase_hint_instant: 'Master USDT Wallet · Instant Card (No KYC).',
      kyc_verified: 'Verified',
      kyc_unverified: 'Unverified — KYC လိုအပ်',
      btn_copy: 'Copy',
      pill_instant_card: 'Instant Card',
      pill_no_kyc: 'No KYC',
      pill_verified: 'Verified',
      pill_kyc_required: 'Verified',
      initial_card_load: 'ကဒ်အတွက် အစပြု ငွေဖြည့်ပမာဏ (USD)',
      min_initial_deposit: 'အနည်းဆုံး အစပြု ငွေသွင်း: $10.00',
      name_on_card: 'ကဒ်ပေါ်ရှိ အမည်',
      name_on_card_required: 'ကဒ်ပေါ်ရှိ အမည် ထည့်ပါ (အနည်းဆုံး ၂ လုံး)',
      pay_from: 'ပေးချေရမည့်နေရာ',
      pay_usdt_wallet_issuance: 'USDT ပိုက်ဆံအိတ် (1 USDT ≈ 1 USD — ချက်ချင်း ထုတ်ပေးမည်)',
      usdt_parity_rate: '1 USDT ≈ 1 USD',
      card_issued_ok: 'သင်၏ virtual card အသင့်ဖြစ်ပါပြီ။',
      card_issued_log: 'ကဒ်ထုတ်ပေးပြီး — {amount}',
      pay_mmk_wallet_reload: 'MMK ပိုက်ဆံအိတ် — card reloads only (instant)',
      pay_usdt_wallet_reload: 'USDT ပိုက်ဆံအိတ် (Instant — 1:1 USD)',
      initial_card_load_row: 'ကဒ်အတွက် အစပြု ငွေဖြည့်မှု',
      card_issuance_fee: '+ ကဒ်ထုတ်ပေးခ',
      card_funding_fee: '+ ငွေဖြည့်ခ',
      card_processing_fee: '+ စီမံဆောင်ရွက်ခ',
      total_usd_required: '= စုစုပေါင်း USD',
      total_payable_usdt: 'စုစုပေါင်း USDT',
      submit_card_request: 'Instant Card ထုတ်မည်',
      virtual_card: 'Virtual Card',
      status: 'အခြေအနေ',
      show_card_details: 'ကဒ်အသေးစိတ် ပြမည်',
      hide_card_details: 'ကဒ်အသေးစိတ် ဖျောက်မည်',
      top_up_card: 'ကဒ်ထဲ ငွေဖြည့်ရန်',
      top_up_reload_card: 'ကဒ်ထဲ ငွေဖြည့်ရန် / Reload',
      card_detail_modal_title: 'ကဒ် အသေးစိတ်',
      btn_delete_card: 'ကဒ် ဖျက်မည်',
      card_delete_hint: 'ဤကဒ်ကို My Cards မှ ဖယ်ရှားမည်။ Pending တောင်းဆိုမှုများကို ပယ်ဖျက်မည်။',
      card_delete_confirm: 'ဤကဒ်ကို My Cards မှ ဖယ်ရှားမည်လား။ Pending တောင်းဆိုမှုများကို ပယ်ဖျက်မည်။',
      card_balance: 'လက်ကျန်',
      card_created: 'ဖန်တီးသည့်နေ့',
      balance_pending: 'လက်ကျန် စောင့်ဆိုင်းနေသည်',
      card_pending_notice: 'ဤကဒ်တောင်းဆိုမှုကို admin အတည်ပြုရန် စောင့်ဆိုင်းနေသည်။ ထုတ်ပေးပြီးပါက ကဒ်နံပါတ်ရရှိမည်။',
      card_reload_history: 'ကဒ် Reload မှတ်တမ်း',
      card_reload_history_hint: 'Virtual card သို့ ငွေဖြည့်တောင်းဆိုမှုများ — admin အတည်ပြုသည်အထိ ပိုက်ဆံအိတ်မှ ငွေကို ထားရှိမည်။',
      loading_reload_history: 'Reload မှတ်တမ်း ဖတ်နေသည်…',
      copy_card_number: 'ကဒ်နံပါတ် ကူးယူမည်',
      copy_all_details: 'အသေးစိတ်အားလုံး ကူးယူမည်',
      holder: 'HOLDER',
      exp: 'EXP',
      cvv: 'CVV',

      deposits_page_title: 'ငွေသွင်း & Reload မှတ်တမ်း',
      deposits_page_desc: 'Virtual card reload သို့မဟုတ် Kripicard ဖြင့် USDT ပိုက်ဆံအိတ် ငွေဖြည့်ပါ။ ငွေသွင်းတိုင်း unique pay address နှင့် exact ပမာဏ ရရှိမည်။',
      reload_topup_card: 'Reload / ကဒ်ထဲ ငွေဖြည့်ရန်',
      reload_topup_hint: 'ကဒ်ရွေးချယ်၍ ပိုက်ဆံအိတ်မှ ပေးချေပါ။ Admin အတည်ပြုသည်အထိ ငွေကို ချက်ချင်း နှုတ်ယူပြီး ထားရှိမည်။',
      start_card_reload: 'ကဒ် Reload စတင်မည်',
      top_up_wallet: 'ပိုက်ဆံအိတ် ငွေဖြည့်မည်',
      deposit_tab_mmk: 'MMK (Manual - KPay / WavePay)',
      deposit_tab_usdt: 'USDT (Kripicard)',
      deposit_usdt_hint: 'Kripicard Deposit ဖြင့် ငွေဖြည့်ပါ — network (ဥပမာ Tron) အတွက် unique pay address နှင့် exact ပမာဏ ထုတ်ပေးမည်။ on-chain အတည်ပြုပြီးနောက် Master Wallet သို့ ထည့်မည်။',
      deposit_usdt_fee_hint: 'Kripicard gateway fee နှုတ်မည် — pay address ထုတ်ပေးချိန်တွင် net credit အတည်ပြုမည်',
      deposit_network_label: 'Network',
      deposit_network_hint: 'ရွေးထားသော network တွင် ငွေသွင်းတိုင်း unique လိပ်စာ ရရှိမည်။',
      deposit_fee_preview: 'ငွေသွင်း Fee ကြိုတင်ကြည့်ရှု',
      deposit_preview_gross: 'ပို့ရမည့် ပမာဏ',
      deposit_preview_fee: 'Gateway Fee',
      deposit_preview_net: 'Net ထည့်သွင်းမည့်',
      btn_deposit_tron: 'Pay Address ရယူမည်',
      btn_deposit_creating: 'Pay address ထုတ်ပေးနေသည်…',
      btn_deposit_tron_waiting: 'ငွေသွင်းမှု စောင့်ဆိုင်းနေသည်…',
      deposit_usdt_order_label: 'ငွေသွင်း Order ID',
      copy_order_id: 'Order ID ကူးမည်',
      deposit_address_label: 'Pay Address',
      copy_address: 'လိပ်စာ ကူးမည်',
      deposit_send_amount: 'ပို့ရမည့် exact ပမာဏ',
      deposit_pay_network: 'Network',
      usdt_order_status_pending: 'USDT လွှဲပြောင်းမှု စောင့်ဆိုင်းနေသည် — အလိုအလျောက် စစ်ဆေးနေသည်…',
      usdt_order_status_verifying: 'ငွေသွင်းမှု တွေ့ရှိ — on-chain အတည်ပြုနေသည်…',
      usdt_order_status_completed: 'ငွေသွင်းမှု အတည်ပြုပြီး — Master Wallet ထည့်သွင်းပြီး!',
      usdt_deposit_success_toast: 'USDT ငွေသွင်းမှု အတည်ပြုပြီး — Master Wallet ထည့်သွင်းပြီး!',
      mmk_wallet_restriction: 'MMK ပိုက်ဆံအိတ်သည် ဘဏ်ထုတ်ယူခြင်းအတွက်သာ။ ငွေသွင်းခြင်းနှင့် card reload အတွက် USDT လိုအပ်သည်။ MMK → USDT ပြောင်းလဲမှု မရရှိပါ။',
      deposit_mmk_hint: 'KBZPay/WavePay ဖြင့် ငွေသွင်းပါ။ ပေးချေပြီးနောက် proof & TxID တင်ပါ။',
      amount_mmk: 'ပမာဏ (MMK)',
      method: 'နည်းလမ်း',
      generate_ref_deposit: 'Ref Code ထုတ်ယူ & ငွေသွင်းမည်',

      reload_modal_title: 'Reload / ကဒ်ထဲ ငွေဖြည့်ရန်',
      reload_modal_hint: 'USDT ပိုက်ဆံအိတ်မှ ပေးချေပါ (1 USDT ≈ 1 USD)။ admin အတည်ပြုပြီးနောက် ရွေးထားသော ကဒ်သို့ ထည့်မည်။',
      target_card: 'ရည်မှန်းကဒ်',
      select_active_card: '— Active ကဒ်ရွေးချယ်ပါ —',
      only_active_cards: 'Active ကဒ်များသာ ပြသထားသည်။',
      topup_amount_mmk: 'ငွေဖြည့်ပမာဏ (MMK)',
      topup_amount_usdt: 'ငွေဖြည့်ပမာဏ (USDT)',
      reload_min_mmk_hint: 'အနည်းဆုံး: 10,000 MMK — $3.50 USD service fee ထပ်ပေါင်းမည်',
      reload_min_usdt_hint: 'အနည်းဆုံး: $5.00 USDT — $3.50 USD service fee ထပ်ပေါင်းမည်',

      wallet_deposit_requests: 'ပိုက်ဆံအိတ် ငွေသွင်းတောင်းဆိုမှုများ',
      all_statuses: 'အခြေအနေအားလုံး',
      pending_review: 'စစ်ဆေးဆဲ',
      verified: 'Verified',
      rejected: 'Rejected',
      loading_deposits: 'ငွေသွင်းမှုများ ဖတ်နေသည်…',
      p2p_disputes: 'P2P Disputes — Needs Review',
      p2p_disputes_hint: 'Users flagged orders with payment proof. Force-release USDT or refund escrow after review.',
      loading_disputes: 'Loading disputes…',

      virtual_card_management: 'Virtual Card Management',
      virtual_card_mgmt_hint: 'Approve card applications and reload requests — no per-transaction spending management.',
      card_requests: 'ကဒ် တောင်းဆိုမှုများ',
      card_requests_hint: 'Admin မှ ကဒ်အသေးစိတ် ထည့်သွင်းရန် စောင့်ဆိုင်းနေသော လျှောက်လွှာများ။',
      loading_card_requests: 'ကဒ်တောင်းဆိုမှုများ ဖတ်နေသည်…',
      issue_update_card: 'Issue / Update Card',
      issue_update_card_hint: 'Issue a new card manually or edit an existing issued card — click Edit in the table below to pre-fill this form.',
      user_id: 'User ID',
      card_id: 'Card ID',
      card_id_placeholder: 'Leave empty to issue new',
      card_number: 'Card Number',
      expiry: 'Expiry (MM/YY)',
      admin_notes: 'Admin Notes',
      admin_notes_placeholder: 'Optional internal note',
      clear_form: 'Clear Form',
      save_changes_update: 'Save Changes / Update Card',
      issued_cards_status: 'Issued Cards — Status Control',
      issued_cards_hint: 'Update lifecycle status for issued virtual cards. Optional reason is shown to the user when suspended or frozen.',
      loading_issued_cards: 'Loading issued cards…',
      card_reload_requests: 'Card Reload Requests',
      card_reload_requests_hint: 'Wallet funds were deducted when the user submitted — approve to credit the card or reject to refund.',
      loading_reload_requests: 'Loading reload requests…',
      no_pending_card_requests: 'Pending card requests မရှိပါ။',
      no_pending_reloads: 'Pending card reload requests မရှိပါ။',
      no_issued_cards: 'Issued virtual cards မရှိသေးပါ။',

      pending_approval: 'စစ်ဆေးဆဲ',
      pending_issuance: 'PENDING_ISSUANCE',
      active: 'ACTIVE',
      suspended: 'SUSPENDED',
      frozen: 'FROZEN',
      terminated: 'TERMINATED',
      pending: 'Pending',

      card_wallet_ok_usdt: 'Master USDT ပိုက်ဆံအိတ် လုံလောက်သည် — {{available}} ရှိ ({{required}} လိုအပ်)။ Instant Card ထုတ်ပေးမည်။',
      card_wallet_err_usdt: 'Master USDT ပိုက်ဆံအိတ် မလုံလောက် — {{required}} လိုအပ်၊ {{available}} ရှိသည်။ ငွေဖြည့်ပါ။',
      card_request_submitted: 'ကဒ်ထုတ်ပေးပြီးပါပြီ!',
      card_request_submitted_log: 'ကဒ်ဝယ်ယူမှု — USDT ပိုက်ဆံအိတ်မှ {{amount}} နှုတ်ယူပြီး',
      card_request_pending_msg: 'ငွေပေးချေမှု လက်ခံပြီး — ကဒ်အပြီးသတ် ထုတ်ပေးနေသည်…',
      card_request_deducted: 'သင်၏ USDT ပိုက်ဆံအိတ်မှ {{amount}} နှုတ်ယူပြီးပါပြီ။',

      settings_security: 'ဆက်တင်များ & လုံခြုံရေး',
      kyc_verification: 'KYC Verification',
      identity_status: 'Identity status:',
      kyc_hint: 'Required for P2P trading and verified banking features.',
      complete_kyc: 'Complete KYC',
      account: 'Account',
      support: 'Support',
      subject: 'Subject',
      message: 'Message',
      open_support_ticket: 'Open Support Ticket',

      th_id: 'ID',
      th_user: 'User',
      th_status: 'Status',
      th_holder: 'Holder',
      th_pricing: 'Pricing',
      th_deposit_ref: 'Deposit Ref',
      th_requested: 'Requested',
      th_actions: 'Actions',
      th_amount: 'Amount',
      th_date: 'Date',
      th_card: 'Card',
      th_type: 'Type',
      th_description: 'Description',

      sign_in: 'Sign In',
      register: 'Register',
      send_otp: 'Send OTP',
      verify_pin: 'Verify PIN',
      forgot_pin: 'Forgot PIN — email reset',
    },
  };

  let currentLang = DEFAULT_LANG;
  const listeners = new Set();

  function normalizeLang(lang) {
    const code = String(lang || '').toLowerCase();
    return SUPPORTED.includes(code) ? code : DEFAULT_LANG;
  }

  function interpolate(text, params) {
    if (!params || typeof text !== 'string') return text;
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => (
      params[key] != null ? String(params[key]) : `{{${key}}}`
    ));
  }

  function t(key, params) {
    const k = String(key || '').replace(/\./g, '_');
    const dict = messages[currentLang] || messages.en;
    const fallback = messages.en;
    const raw = dict[k] ?? fallback[k] ?? k;
    return interpolate(raw, params);
  }

  function getLang() {
    return currentLang;
  }

  function setLang(lang) {
    const next = normalizeLang(lang);
    if (next === currentLang) return currentLang;
    currentLang = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (_) { /* ignore */ }
    document.documentElement.lang = next === 'my' ? 'my' : 'en';
    apply(document);
    syncLanguageSwitcherUI();
    listeners.forEach((fn) => {
      try { fn(next); } catch (e) { console.warn('[I18n] listener error', e); }
    });
    document.dispatchEvent(new CustomEvent('eisy:langchange', { detail: { lang: next } }));
    return next;
  }

  function onChange(fn) {
    if (typeof fn === 'function') listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      el.textContent = t(key);
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.placeholder = t(key);
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.title = t(key);
    });
    scope.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      if (key) el.setAttribute('aria-label', t(key));
    });
    scope.querySelectorAll('select option[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      if (key) el.innerHTML = t(key);
    });
  }

  function syncLanguageSwitcherUI() {
    document.querySelectorAll('.lang-switcher [data-lang]').forEach((btn) => {
      const active = btn.dataset.lang === currentLang;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function initLanguageSwitcher(mountEl) {
    if (!mountEl) return;
    // Prefer static markup (reserves header width); only inject when empty.
    if (!mountEl.querySelector('.lang-switcher')) {
      mountEl.innerHTML =
        '<div class="lang-switcher" role="group" aria-label="' + t('lang_switcher_label') + '">' +
          '<button type="button" class="lang-btn" data-lang="my" aria-pressed="false">' + t('lang_my') + '</button>' +
          '<button type="button" class="lang-btn" data-lang="en" aria-pressed="false">' + t('lang_en') + '</button>' +
        '</div>';
    } else {
      const group = mountEl.querySelector('.lang-switcher');
      if (group) group.setAttribute('aria-label', t('lang_switcher_label'));
      mountEl.querySelectorAll('[data-lang]').forEach((btn) => {
        const key = btn.dataset.lang === 'my' ? 'lang_my' : 'lang_en';
        btn.textContent = t(key);
      });
    }
    mountEl.querySelectorAll('[data-lang]').forEach((btn) => {
      if (btn.dataset.bound === '1') return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        if (btn.dataset.lang !== currentLang) setLang(btn.dataset.lang);
      });
    });
    syncLanguageSwitcherUI();
  }

  function init() {
    let stored = DEFAULT_LANG;
    try {
      stored = localStorage.getItem(STORAGE_KEY) || DEFAULT_LANG;
    } catch (_) { /* ignore */ }
    currentLang = normalizeLang(stored);
    document.documentElement.lang = currentLang === 'my' ? 'my' : 'en';
    apply(document);
    initLanguageSwitcher(document.getElementById('langSwitcher'));
    initLanguageSwitcher(document.getElementById('langSwitcherAdmin'));
  }

  const I18n = {
    t,
    getLang,
    setLang,
    apply,
    init,
    onChange,
    initLanguageSwitcher,
    STORAGE_KEY,
    SUPPORTED,
  };

  global.I18n = I18n;
  global.t = t;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}(typeof window !== 'undefined' ? window : global));
