// ═══════════════════════════════════════════════════════════════
//  HEMM Report — config.js
//  Central configuration — NO SECRETS HERE
//  Supabase anon key is safe to expose (RLS protects data)
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── Supabase Config ──────────────────────────────────────────
// Replace these with your actual Supabase project values
// Found in: Supabase Dashboard → Settings → API
const SUPABASE_URL  = 'https://qycbpiotmgwjltduzlvf.supabase.co';
const SUPABASE_ANON = 'sb_publishable_4AozaOFzHIkWI2p0uVNByg_lbMvckjv';

// Fallback Google Sheets Apps Script URL for Local Mock Mode
const FALLBACK_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzvQQcUftmeXPn6u04AzDSyUA9ZYpQIRN1R1Es04pp0DJUu3fNn_te2NEkAgJsBNUblZQ/exec';

// ── App Version ──────────────────────────────────────────────
const APP_VERSION = '7.0.0-secure';

// ── Machine List ─────────────────────────────────────────────
const MACHINES = [
  { id: 'Volvo',      emoji: '🟦', hindi: 'वोल्वो टिपर',      color: '#2980b9' },
  { id: 'SANY',       emoji: '🟥', hindi: 'सेनी टिपर',        color: '#e74c3c' },
  { id: 'BharatBenz', emoji: '🟩', hindi: 'भारत बेंज टिपर',    color: '#16a085' },
  { id: 'TATA',       emoji: '🟧', hindi: 'टाटा टिपर',        color: '#f59e0b' },
];

// ── DGMS Safety Features ─────────────────────────────────────
// h = Hindi name (stored in reports — must match exactly)
// e = English name (display in dashboards/sheets)
// i = emoji icon
// what/why = educational descriptions for operators
const DGMS = [
  {
    i: '📷', h: 'रियर विजन सिस्टम', e: 'Rear Vision System',
    what: 'यह ट्रकों में लगा एक कैमरा सिस्टम है जो पीछे का सीधा दृश्य दिखाता है।',
    why: 'ऑपरेटर को रिवर्स करते समय पीछे मौजूद लोगों या वाहनों को देखने में मदद करता है ताकि दुर्घटना न हो।'
  },
  {
    i: '🔊', h: 'ऑडियो-विजुअल अलार्म', e: 'Audio-Visual Alarm',
    what: 'रिवर्स करते समय बजने वाला तेज अलार्म और चमकने वाली लाइट।',
    why: 'आस-पास काम कर रहे लोगों को सावधान करने के लिए कि भारी मशीन पीछे आ रही है।'
  },
  {
    i: '🏁', h: 'स्पीड गवर्नर', e: 'Speed Governor',
    what: 'यह मशीन की अधिकतम गति (speed) को नियंत्रित करने वाला उपकरण है।',
    why: 'मशीन को ओवरस्पीडिंग से रोकने के लिए, जिससे ऑपरेटर का नियंत्रण न खोए और पलटने का खतरा कम हो।'
  },
  {
    i: '🔥', h: 'अग्नि शमन प्रणाली', e: 'Fire Suppression (AFDSS)',
    what: 'यह एक स्वचालित फायर सिस्टम है जो आग लगने पर उसे बुझाने का काम करता है।',
    why: 'इंजन या अन्य हिस्सों में आग लगने पर तुरंत बुझाने, ऑपरेटर की जान बचाने और मशीन को जलने से बचाने के लिए।'
  },
  {
    i: '🪞', h: 'ब्लाइंड स्पॉट दर्पण', e: 'Blind Spot Mirrors',
    what: 'विशेष प्रकार के शीशे जो मशीन के उन हिस्सों को दिखाते हैं जो सामान्य शीशे में नहीं दिखते।',
    why: 'ऑपरेटर को चारों ओर का पूरा दृश्य देने के लिए ताकि मुड़ते या चलते समय कोई छोटी गाड़ी कुचली न जाए।'
  },
  {
    i: '⬆️', h: 'बॉडी होइस्ट लिमिट', e: 'Body Hoist Limit Switch',
    what: 'यह एक सेंसर स्विच है जो डाला (body) के पूरी तरह उठने पर हाइड्रोलिक को रोक देता है।',
    why: 'डाले को जरूरत से ज्यादा उठने से रोकने के लिए, जिससे मशीन असंतुलित होकर पलटे नहीं।'
  },
  {
    i: '⚙️', h: 'प्रोपेलर शाफ्ट गार्ड', e: 'Propeller Shaft Guard',
    what: 'प्रोपेलर शाफ्ट के ऊपर लगा एक मजबूत लोहे का कवर।',
    why: 'अगर घूमता हुआ शाफ्ट टूट जाए तो उसे उछलकर मशीन या ऑपरेटर के केबिन को नुकसान पहुंचाने से रोकने के लिए।'
  },
  {
    i: '🔔', h: 'सीट बेल्ट चेतावनी', e: 'Seat Belt Warning',
    what: 'सीट बेल्ट न पहनने पर बजने वाला अलार्म या चमकने वाली लाइट।',
    why: 'ऑपरेटर को हमेशा सीट बेल्ट पहनने की याद दिलाने के लिए, जो दुर्घटना या झटके के समय जान बचाता है।'
  },
  {
    i: '🅿️', h: 'पार्किंग ब्रेक', e: 'Parking Brake Interlock',
    what: 'एक सुरक्षा सिस्टम जो मशीन को तब तक चलने नहीं देता जब तक पार्किंग ब्रेक न हटा हो।',
    why: 'मशीन को ढलान पर या खड़ी अवस्था में बिना ऑपरेटर के लुढ़कने से बचाने के लिए।'
  },
  {
    i: '🚗', h: 'आपातकालीन स्टीयरिंग', e: 'Emergency Steering',
    what: 'एक बैकअप स्टीयरिंग सिस्टम जो मुख्य इंजन बंद होने पर काम आता है।',
    why: 'इंजन फेल होने या हाइड्रोलिक पंप खराब होने पर ऑपरेटर को मशीन सुरक्षित किनारे लगाने में मदद करता है।'
  },
  {
    i: '😴', h: 'थकान निगरानी', e: 'Fatigue Monitoring',
    what: 'कैमरा आधारित AI सिस्टम जो ऑपरेटर की आंखों और चेहरे पर नजर रखता है।',
    why: 'ऑपरेटर को नींद आने या ध्यान भटकने पर तुरंत तेज अलार्म बजाकर अलर्ट करने के लिए ताकि हादसा न हो।'
  },
  {
    i: '🌟', h: 'रेट्रो-रिफ्लेक्टिव', e: 'Retro-Reflective Strips',
    what: 'तेज चमकने वाले रिफ्लेक्टर स्टिकर जो मशीन के चारों ओर लगे होते हैं।',
    why: 'रात में, धुंध में या कम रोशनी में मशीन को दूर से ही अन्य ऑपरेटरों को दिखाई देने योग्य बनाने के लिए।'
  },
  {
    i: '🛑', h: 'सर्विस ब्रेक', e: 'Service Brake',
    what: 'मशीन का मुख्य और सबसे जरूरी फुट ब्रेक सिस्टम।',
    why: 'खदान के भारी ढलानों पर चलती हुई मशीन को तुरंत और सुरक्षित तरीके से रोकने के लिए बहुत जरूरी है।'
  },
  {
    i: '🚨', h: 'Proximity Warning Sensor', e: 'Proximity Warning Sensor',
    what: 'यह सेंसर मशीन के चारों ओर निकटवर्ती खतरों को पहचानता है और चेतावनी देता है।',
    why: 'अन्य वाहनों, कर्मचारियों या बाधाओं से टकराव रोकने के लिए और खदान में सुरक्षा बढ़ाने के लिए।'
  },
  {
    i: '🔧', h: 'Turbo Charger Guard', e: 'Turbo Charger Guard',
    what: 'टर्बो चार्जर के चारों ओर लगा एक सुरक्षात्मक कवर जो गर्म हिस्सों को सुरक्षित रखता है।',
    why: 'ऑपरेटर या रखरखाव कर्मचारियों को अत्यधिक गर्म टर्बो चार्जर से होने वाली चोटों से बचाता है।'
  },
  {
    i: '📯', h: 'हॉर्न', e: 'Horn',
    what: 'मशीन में लगा एक तेज ध्वनि उपकरण जो बटन दबाने पर तेज Horn की आवाज़ करता है।',
    why: 'खदान में चलती हुई भारी मशीन के आगे-पीछे के लोगों और वाहनों को सावधान करने के लिए Horn बजाना DGMS नियमों के तहत अनिवार्य है।'
  },
  {
    i: '🪞', h: 'Rear View Mirror', e: 'Rear View Mirror',
    what: 'ड्राइविंग सीट के पास लगा दर्पण जो पीछे का दृश्य दिखाता है।',
    why: 'ड्राइवर को रिवर्स करते समय या पीछे की गतिविधि देखने में मदद करता है, जिससे दुर्घटनाओं में कमी आती है।'
  },
];

// ── DGMS feature names for Apps Script matching ──────────────
const DGMS_FEATURES_HINDI = DGMS.map(f => f.h);
const DGMS_FEATURES_ENGLISH = DGMS.map(f => f.e);

// ── Operator Auth Config ─────────────────────────────────────
const MAX_AUTH_TRIES = 4;

// ── Rate Limiting ────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 5;                      // max 5 reports per window
