/**
 * Eisy Myanmar — lightweight i18n (English / Myanmar)
 * Usage: I18n.t('card_requests'), data-i18n="card_requests" on static elements
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'eisy_lang';
  const DEFAULT_LANG = 'en';
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
      nav_deposits: 'Deposit & History',
      nav_p2p: 'P2P Express',
      nav_rates: 'Exchange Rates & Fees',
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
      header_mmk_wallet_hint: 'For Virtual Card Issue & Reload Only',
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
      btn_withdraw_usdt: 'Withdraw USDT',
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
      selected_card: 'Selected Card',
      card_status: 'Card Status',
      usdt_wallet_hint: 'TRC20 / BEP20 deposit · 1 USDT ≈ 1 USD to card (after fee)',

      // Cards page
      cards_page_desc: 'View card status, reveal details when needed, and reload your virtual cards.',
      your_virtual_cards: 'Your Virtual Cards',
      prev_card: '‹ Prev',
      next_card: 'Next ›',
      apply_new_card: 'Apply for New Card',
      apply_new_card_hint: 'Pay from your MMK or USDT wallet, or via KBZPay/WavePay manual deposit. Wallet payments are held until an admin issues your card (usually 15–30 mins).',
      initial_card_load: 'Initial Card Load Amount (USD)',
      min_initial_deposit: 'Minimum initial deposit: $10.00',
      pay_from: 'Pay From',
      pay_mmk_wallet_issuance: 'MMK Wallet — card issuance (admin processed)',
      pay_usdt_wallet_issuance: 'USDT Wallet (1 USDT ≈ 1 USD, admin processed)',
      pay_kbzpay: 'KBZPay (Manual Deposit)',
      pay_wavepay: 'WavePay (Manual Deposit)',
      pay_mmk_wallet_reload: 'MMK Wallet — card reloads only (instant)',
      pay_usdt_wallet_reload: 'USDT Wallet (Instant — 1:1 USD)',
      initial_card_load_row: 'Initial Card Load',
      card_issuance_fee: '+ Card Issuance Fee',
      total_usd_required: '= Total USD Required',
      total_payable_mmk: 'Total Payable (MMK)',
      total_payable_usdt: 'Total Payable (USDT)',
      submit_card_request: 'Submit Card Request',
      virtual_card: 'Virtual Card',
      status: 'Status',
      show_card_details: 'Show Card Details',
      top_up_card: 'Top Up Card',
      top_up_reload_card: 'Top Up / Reload Card',
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
      deposits_page_desc: 'Reload a virtual card or top up your MMK wallet (for card issuance & reloads only) via KBZPay/WavePay.',
      reload_topup_card: 'Reload / Top-Up Card',
      reload_topup_hint: 'Select a card and pay from your wallet. Funds are deducted immediately and held until admin approves the reload.',
      start_card_reload: 'Start Card Reload',
      top_up_wallet: 'Top Up Wallet',
      deposit_tab_mmk: 'MMK — KPay / WavePay',
      deposit_tab_usdt: 'USDT — TRC20 / BEP20',
      mmk_wallet_restriction: 'MMK wallet funds are for virtual card issuance and card reloads only.',
      deposit_mmk_hint: 'Top up via KBZPay or WavePay. Upload transaction proof & TxID after payment.',
      amount_mmk: 'Amount (MMK)',
      method: 'Method',
      generate_ref_deposit: 'Generate Ref Code & Deposit',

      // Modal — reload
      reload_modal_title: 'Reload / Top-Up Card',
      reload_modal_hint: 'Pay via KBZPay/WavePay — funds are converted at today\'s rate and added to your selected card after admin approval.',
      target_card: 'Target Card',
      select_active_card: '— Select an active card —',
      only_active_cards: 'Only active cards are shown.',
      topup_amount_mmk: 'Top-Up Amount (MMK)',
      topup_amount_usdt: 'Top-Up Amount (USDT)',
      reload_min_mmk_hint: 'Minimum top-up: 10,000 MMK — $3.50 USD service fee added on top',
      reload_min_usdt_hint: 'Minimum top-up: $5.00 USDT — $3.50 USD service fee added on top',

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
      card_wallet_ok_mmk: 'MMK wallet sufficient — {{available}} available ({{required}} required). Card request will be processed by Admin shortly (usually within 15-30 mins).',
      card_wallet_err_mmk: 'Insufficient MMK wallet. Need {{required}}, you have {{available}}. Top up first.',
      card_wallet_ok_usdt: 'USDT wallet sufficient — {{available}} available ({{required}} required). Card request will be processed by Admin shortly (usually within 15-30 mins).',
      card_wallet_err_usdt: 'Insufficient USDT wallet. Need {{required}}, you have {{available}}. Top up first.',
      card_request_submitted: 'Card request submitted!',
      card_request_submitted_log: 'Card request submitted — {{amount}} deducted, pending admin issuance',
      card_request_pending_msg: 'Card request will be processed by Admin shortly (usually within 15-30 mins).',
      card_request_deducted: '{{amount}} deducted from your wallet.',

      // Settings
      settings_security: 'Settings & Security',
      kyc_verification: 'KYC Verification',
      identity_status: 'Identity status:',
      kyc_hint: 'Required to post P2P ads and trade on the marketplace.',
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
      forgot_pin: 'Forgot PIN / Reset to 123456',
    },
    my: {
      lang_switcher_label: 'ဘာသာစကား ရွေးချယ်ရန်',
      lang_my: '🇲🇲 မြန်မာ',
      lang_en: '🇬🇧 EN',

      brand_sub: 'Virtual Card Platform',

      nav_dashboard: 'ဒက်ရှ်ဘုတ်',
      nav_my_cards: 'ကျွန်ုပ်၏ ကဒ်များ',
      nav_deposits: 'ငွေသွင်း & မှတ်တမ်း',
      nav_p2p: 'P2P Express',
      nav_rates: 'လဲလှယ်နှုန်း & အခကြေးငွေ',
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
      header_mmk_wallet_hint: 'Virtual Card ထုတ်ပေးခြင်း & Reload အတွက်သာ',
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
      btn_withdraw_usdt: 'USDT ထုတ်ယူမည်',
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
      selected_card: 'ရွေးချယ်ထားသော ကဒ်',
      card_status: 'ကဒ် အခြေအနေ',
      usdt_wallet_hint: 'TRC20 / BEP20 ငွေသွင်း · 1 USDT ≈ 1 USD (အခကြေးငွေနှင့်အတူ)',

      cards_page_desc: 'ကဒ်အခြေအနေ ကြည့်ရှု၊ လိုအပ်ပါက အသေးစိတ်ပြသခြင်း၊ virtual card များကို reload လုပ်ပါ။',
      your_virtual_cards: 'သင်၏ Virtual Cards',
      prev_card: '‹ ယခင်',
      next_card: 'နောက် ›',
      apply_new_card: 'ကဒ်အသစ် လျှောက်ထားရန်',
      apply_new_card_hint: 'MMK/USDT ပိုက်ဆံအိတ်မှ သို့မဟုတ် KBZPay/WavePay ငွေသွင်းမှတဆင့် ပေးချေပါ။ ပိုက်ဆံအိတ်မှ ပေးချေပါက admin က ကဒ်ထုတ်ပေးသည်အထိ စောင့်ဆိုင်းရမည် (15–30 မိနစ်)။',
      initial_card_load: 'ကဒ်အတွက် အစပြု ငွေဖြည့်ပမာဏ (USD)',
      min_initial_deposit: 'အနည်းဆုံး အစပြု ငွေသွင်း: $10.00',
      pay_from: 'ပေးချေရမည့်နေရာ',
      pay_mmk_wallet_issuance: 'MMK ပိုက်ဆံအိတ် — ကဒ်ထုတ်ပေးခြင်း (admin လုပ်ဆောင်မည်)',
      pay_usdt_wallet_issuance: 'USDT ပိုက်ဆံအိတ် (1 USDT ≈ 1 USD, admin လုပ်ဆောင်မည်)',
      pay_kbzpay: 'KBZPay (Manual Deposit)',
      pay_wavepay: 'WavePay (Manual Deposit)',
      pay_mmk_wallet_reload: 'MMK ပိုက်ဆံအိတ် — card reloads only (instant)',
      pay_usdt_wallet_reload: 'USDT ပိုက်ဆံအိတ် (Instant — 1:1 USD)',
      initial_card_load_row: 'ကဒ်အတွက် အစပြု ငွေဖြည့်မှု',
      card_issuance_fee: '+ ကဒ်ထုတ်ပေးခ',
      total_usd_required: '= စုစုပေါင်း USD',
      total_payable_mmk: 'စုစုပေါင်း MMK',
      total_payable_usdt: 'စုစုပေါင်း USDT',
      submit_card_request: 'ကဒ်တောင်းဆိုမှု တင်သွင်းမည်',
      virtual_card: 'Virtual Card',
      status: 'အခြေအနေ',
      show_card_details: 'ကဒ်အသေးစိတ် ပြမည်',
      top_up_card: 'ကဒ်ထဲ ငွေဖြည့်ရန်',
      top_up_reload_card: 'ကဒ်ထဲ ငွေဖြည့်ရန် / Reload',
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
      deposits_page_desc: 'Virtual card reload သို့မဟုတ် MMK ပိုက်ဆံအိတ် (ကဒ်ထုတ်ပေးခြင်း & reload အတွက်သာ) KBZPay/WavePay ဖြင့် ငွေဖြည့်ပါ။',
      reload_topup_card: 'Reload / ကဒ်ထဲ ငွေဖြည့်ရန်',
      reload_topup_hint: 'ကဒ်ရွေးချယ်၍ ပိုက်ဆံအိတ်မှ ပေးချေပါ။ Admin အတည်ပြုသည်အထိ ငွေကို ချက်ချင်း နှုတ်ယူပြီး ထားရှိမည်။',
      start_card_reload: 'ကဒ် Reload စတင်မည်',
      top_up_wallet: 'ပိုက်ဆံအိတ် ငွေဖြည့်မည်',
      deposit_tab_mmk: 'MMK — KPay / WavePay',
      deposit_tab_usdt: 'USDT — TRC20 / BEP20',
      mmk_wallet_restriction: 'MMK ပိုက်ဆံအိတ်ငွေသည် virtual card ထုတ်ပေးခြင်းနှင့် reload အတွက်သာ။',
      deposit_mmk_hint: 'KBZPay/WavePay ဖြင့် ငွေသွင်းပါ။ ပေးချေပြီးနောက် proof & TxID တင်ပါ။',
      amount_mmk: 'ပမာဏ (MMK)',
      method: 'နည်းလမ်း',
      generate_ref_deposit: 'Ref Code ထုတ်ယူ & ငွေသွင်းမည်',

      reload_modal_title: 'Reload / ကဒ်ထဲ ငွေဖြည့်ရန်',
      reload_modal_hint: 'KBZPay/WavePay ဖြင့် ပေးချေပါ — ယနေ့နှုန်းဖြင့် ပြောင်းလဲပြီး admin အတည်ပြုပြီးနောက် ကဒ်သို့ ထည့်မည်။',
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

      card_wallet_ok_mmk: 'MMK ပိုက်ဆံအိတ် လုံလောက်သည် — {{available}} ရှိ ({{required}} လိုအပ်)။ Admin က မကြာမီ လုပ်ဆောင်မည် (15-30 မိနစ်)။',
      card_wallet_err_mmk: 'MMK ပိုက်ဆံအိတ် မလုံလောက် — {{required}} လိုအပ်၊ {{available}} ရှိသည်။ ငွေဖြည့်ပါ။',
      card_wallet_ok_usdt: 'USDT ပိုက်ဆံအိတ် လုံလောက်သည် — {{available}} ရှိ ({{required}} လိုအပ်)။ Admin က မကြာမီ လုပ်ဆောင်မည် (15-30 မိနစ်)။',
      card_wallet_err_usdt: 'USDT ပိုက်ဆံအိတ် မလုံလောက် — {{required}} လိုအပ်၊ {{available}} ရှိသည်။ ငွေဖြည့်ပါ။',
      card_request_submitted: 'ကဒ်တောင်းဆိုမှု တင်သွင်းပြီးပါပြီ!',
      card_request_submitted_log: 'ကဒ်တောင်းဆိုမှု တင်သွင်းပြီး — {{amount}} နှုတ်ယူပြီး admin ထုတ်ပေးရန် စောင့်ဆိုင်းနေသည်',
      card_request_pending_msg: 'Admin က မကြာမီ လုပ်ဆောင်မည် (15-30 မိနစ်)။',
      card_request_deducted: 'သင်၏ ပိုက်ဆံအိတ်မှ {{amount}} နှုတ်ယူပြီးပါပြီ။',

      settings_security: 'ဆက်တင်များ & လုံခြုံရေး',
      kyc_verification: 'KYC Verification',
      identity_status: 'Identity status:',
      kyc_hint: 'Required to post P2P ads and trade on the marketplace.',
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
      forgot_pin: 'Forgot PIN / Reset to 123456',
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
    mountEl.innerHTML =
      '<div class="lang-switcher" role="group" aria-label="' + t('lang_switcher_label') + '">' +
        '<button type="button" class="lang-btn" data-lang="my" aria-pressed="false">' + t('lang_my') + '</button>' +
        '<button type="button" class="lang-btn" data-lang="en" aria-pressed="false">' + t('lang_en') + '</button>' +
      '</div>';
    mountEl.querySelectorAll('[data-lang]').forEach((btn) => {
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
