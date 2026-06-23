/* ================================================================
   osce-engine.js  —  OSCE Virtual Patient Simulator v2
   Redesigned UI: immersive lobby, 3-zone chat, voice mode,
   gamification, SVG radar debrief, achievements, confetti.
   AI transport, prompts, avatar system unchanged.
   ================================================================ */
(function () {
  'use strict';

  var _cs = document.currentScript;
  var ENGINE_BASE = _cs ? _cs.src.replace(/[^\/]*$/, '') : (window.__OSCE_ENGINE_BASE || '');

  /* ── Storage keys ─────────────────────────────────────────── */
  var STORAGE = {
    theme:      'quiz-theme',
    apiKey:     'gemini_api_key',
    model:      'gemini_selected_model',
    progress:   'quiz_progress_v1_osce_',
    maxWait:    'gemini_max_wait',
    retryLevel: 'gemini_retry_level',
    session:    'osce_session_',
    voiceOn:    'osce_voice_on',
    voiceMode:  'osce_voice_mode',
    liveModel:  'osce_live_model',
    ttsVoice:   'osce_tts_voice',
    ttsRate:    'osce_tts_rate'
  };

  var MAX_TURNS  = 30;
  var WARN_TURNS = 25;
  var EXAM_TIME  = 480;
  /* ── Models ─────────────────────────────────────────────────── */
  var MODELS = [
    ['gemini-3.1-flash-lite', 'Gemini 3.1 Flash-Lite (default, fast & modern)'],
    ['gemma-4-26b-a4b-it',    'Gemma 4 26B IT (open model, strong & free)'],
    ['gemma-4-31b-it',        'Gemma 4 31B IT (larger open model)'],
    ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash-Lite'],
    ['gemini-2.5-flash',      'Gemini 2.5 Flash']
  ];

  var LIVE_MODELS = [
    ['gemini-3.1-flash-live-preview',          'Gemini 3.1 Flash Live (recommended)'],
    ['gemini-live-2.5-flash-native-audio',     'Gemini Live 2.5 Flash — native audio'],
    ['gemini-live-2.5-flash-preview-native-audio-09-2025', 'Gemini 2.5 Flash Live — native audio preview']
  ];

  /* ── API key access (thin wrappers over EngineShared) ────────── */
  function _readKey()        { return EngineShared.airReadGeminiKey(); }
  function _hasApiKey()      { return EngineShared.airHasGeminiKey(); }
  function _getSavedModel()  { return localStorage.getItem(STORAGE.model) || MODELS[0][0]; }
  function _getMaxWaitMs()   { var v = localStorage.getItem(STORAGE.maxWait) || '15'; var n = parseInt(v, 10); return n > 0 ? n * 1000 : 0; }
  function _getRetryLevel()  { return localStorage.getItem(STORAGE.retryLevel) || 'balanced'; }
  function modelIsAvailable(id) { return MODELS.some(function (m) { return m[0] === id; }); }
  function _getModelLabel(id) { for (var i = 0; i < MODELS.length; i++) if (MODELS[i][0] === id) return MODELS[i][1]; return id; }
  function _getSavedLiveModel() { return localStorage.getItem(STORAGE.liveModel) || LIVE_MODELS[0][0]; }
  function liveModelIsAvailable(id) { return LIVE_MODELS.some(function (m) { return m[0] === id; }); }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function textOr(v, fallback) { return (v === null || v === undefined || v === '') ? fallback : String(v); }
  function pickField(obj) {
    var fields = Array.prototype.slice.call(arguments, 1);
    for (var i = 0; i < fields.length; i++) { var val = obj[fields[i]]; if (val !== null && val !== undefined && val !== '') return val; }
    return undefined;
  }
  function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
  function _addLink(rel, href, extra) {
    var link = document.createElement('link'); link.rel = rel; link.href = href;
    if (extra) Object.keys(extra).forEach(function (k) { link[k] = extra[k]; });
    document.head.appendChild(link);
  }
  _addLink('preconnect', 'https://fonts.googleapis.com');
  _addLink('preconnect', 'https://fonts.gstatic.com', { crossOrigin: '' });
  _addLink('stylesheet', 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Playfair+Display:wght@700&display=swap');

  /* ── Config + case normalization ─────────────────────────────── */
  function normalizeConfig(raw) {
    raw = raw || {};
    var title = textOr(pickField(raw, 'title', 'name'), 'OSCE Virtual Patient');
    return {
      uid:         textOr(pickField(raw, 'uid', 'id'), slugify(title) || 'osce_cases'),
      title:       title,
      description: textOr(pickField(raw, 'description', 'desc', 'subtitle'), 'Practice history-taking with an AI virtual patient, then get examiner feedback.'),
      icon:        textOr(pickField(raw, 'icon', 'emoji'), '🩺')
    };
  }
  function normalizeCase(raw, idx) {
    raw = raw || {}; var patient = raw.patient || {}; var hidden = raw.hiddenProfile || raw.hidden_profile || {}; var rubric = raw.rubric || {};
    var type = (String(raw.type || 'history')).toLowerCase();
    return {
      id:         textOr(pickField(raw, 'id'), 'case-' + (idx + 1)),
      title:      textOr(pickField(raw, 'title', 'name'), 'Case ' + (idx + 1)),
      type:       type === 'data-interp' ? 'data-interp' : 'history',
      specialty:  textOr(pickField(raw, 'specialty', 'category'), 'General'),
      difficulty: textOr(pickField(raw, 'difficulty', 'level'), 'Intermediate'),
      task:       textOr(pickField(raw, 'task', 'instructions'), type === 'data-interp' ? 'Interpret the data and answer the examiner\'s questions.' : 'Take a focused history from this patient.'),
      time:       Number(pickField(raw, 'time')) || EXAM_TIME,
      examiner:   raw.examiner || { name: 'Examiner', title: 'Consultant' },
      dataPresented: raw.dataPresented || null,
      // Image extension: dataPresented.images = [{title, caption, src, alt}]
      questions:  Array.isArray(raw.questions) ? raw.questions : [],
      patient: {
        name:       textOr(pickField(patient, 'name', 'displayName'), 'Patient'),
        age:        Number(pickField(patient, 'age')) || 40,
        gender:     (pickField(patient, 'gender', 'sex') || 'male').toLowerCase() === 'female' ? 'female' : 'male',
        avatarSeed: textOr(pickField(patient, 'avatarSeed', 'avatar_seed'), 'osce-' + idx),
        opening:    textOr(pickField(patient, 'opening', 'greeting'), 'Hello doctor, thank you for seeing me.')
      },
      hiddenProfile: {
        diagnosis:   hidden.diagnosis || '',
        keySymptoms: hidden.keySymptoms || hidden.key_symptoms || [],
        redFlags:    hidden.redFlags   || hidden.red_flags    || [],
        pastHistory: hidden.pastHistory|| hidden.past_history || [],
        vitalSigns:  hidden.vitalSigns || hidden.vital_signs  || ''
      },
      rubric: { mustAsk: rubric.mustAsk || rubric.must_ask || [], bonus: rubric.bonus || [] }
    };
  }

  function readOsceData() {
    var config = null, caseObj = null;
    try { if (typeof OSCE_CONFIG !== 'undefined') config = OSCE_CONFIG; } catch (_) {}
    if (!config || !Object.keys(config).length) config = window.OSCE_CONFIG || {};
    try { if (typeof OSCE_CASE !== 'undefined') caseObj = OSCE_CASE; } catch (_) {}
    if (!caseObj) { try { if (typeof OSCE_CASES !== 'undefined') caseObj = OSCE_CASES[0]; } catch (_) {} }
    if (!caseObj) caseObj = recoverOsceCaseFromScripts();
    return { config: normalizeConfig(config), case: normalizeCase(caseObj, 0) };
  }

  function recoverOsceCaseFromScripts() {
    var scripts = document.querySelectorAll('script'); var result = null;
    Array.prototype.some.call(scripts, function (script) {
      var text = script.textContent || '';
      if (!text || text.indexOf('OSCE_') === -1) return false;
      try {
        var re = /(?:var|let|const)\s+OSCE_CASE\s*=([\s\S]*?);\s*(?:\/\*\s*\[)/;
        var m = text.match(re);
        if (m) { result = new Function('return (' + m[1] + ')')(); return !!result; }
        re = /(?:var|let|const)\s+OSCE_CASES\s*=([\s\S]*?);\s*(?:\/\*\s*\[)/;
        m = text.match(re);
        if (m) { var arr = new Function('return (' + m[1] + ')')(); result = Array.isArray(arr) ? arr[0] : null; return !!result; }
      } catch (_) {}
      return false;
    });
    return result;
  }

  /* ================================================================
     AVATAR SYSTEM — procedural inline SVG
     ================================================================ */
  function _mulberry32(seedStr) {
    var h = 1779033703 ^ seedStr.length;
    for (var i = 0; i < seedStr.length; i++) { h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    return function () { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  }
  function _ageBand(age) { if (age < 13) return 'child'; if (age < 20) return 'teen'; if (age < 60) return 'adult'; return 'elder'; }
  function _isPediatric(age) { return (age||0) < 16; }
  function _getSpeaker(c) {
    if (!c) return { name:'Speaker', gender: 'female', isParent: false };
    if (c.type === 'data-interp') {
      var e = c.examiner || { name:'Examiner', title:'Consultant' };
      return { name: e.name, gender: 'male', isParent: false };
    }
    if (!c.patient) return { name:'Patient', gender: 'female', isParent: false };
    var p = c.patient;
    if (_isPediatric(p.age)) {
      var parentGender = p.parentGender || 'female';
      var parentLabel = parentGender === 'male' ? 'Father' : 'Mother';
      return { name: parentLabel + (p.name ? ' of ' + p.name.split('(')[0].trim() : ''), gender: parentGender, isParent: true };
    }
    return { name: p.name, gender: p.gender, isParent: false };
  }
  var SKIN_TONES  = ['#FCE4D6','#F3C9A0','#E0AC82','#C68658','#9E5F32','#6B3F1C'];
  var HAIR_COLORS = { dark:'#2B2118', brown:'#5A3A22', blonde:'#D9B26A', grey:'#B8B8B8', white:'#ECECEC', red:'#A14A23' };
  var HAIR_STYLES = {
    male:   { child:['short','buzz','curly-short'], teen:['short','buzz','spiky'], adult:['short','side-part','bald'], elder:['short','bald','side-part'] },
    female: { child:['long','pigtails','bob'], teen:['long','bob','ponytail'], adult:['long','bob','bun','hijab'], elder:['bob','bun','short'] }
  };
  var FACE_SHAPES = ['oval','round','square'];
  var ACCESSORIES = { none:0.6, glasses:0.3, hearingAid:0.1 };
  var EXPRESSIONS  = ['neutral','concerned','tired','mild-pain'];
  function _pick(rnd, arr)       { return arr[Math.floor(rnd() * arr.length)]; }
  function _weighted(rnd, weights) {
    var keys = Object.keys(weights), total = 0;
    keys.forEach(function (k) { total += weights[k]; });
    var r = rnd() * total, acc = 0;
    for (var i = 0; i < keys.length; i++) { acc += weights[keys[i]]; if (r <= acc) return keys[i]; } return keys[0];
  }
  function buildAvatarParams(gender, age, seed) {
    gender = (gender||'male').toLowerCase() === 'female' ? 'female' : 'male';
    age = Number(age)||40; var band = _ageBand(age);
    var rnd = _mulberry32(String(seed||'x')+':'+gender+':'+age);
    var headCovering = 'none';
    var hairStyle = _pick(rnd, HAIR_STYLES[gender][band]||HAIR_STYLES[gender].adult);
    if (hairStyle === 'hijab') { headCovering = 'hijab'; hairStyle = 'hidden'; }
    if (hairStyle === 'bald')    hairStyle = 'bald';
    var hairColorKey = band==='child' ? _pick(rnd,['dark','brown','blonde','red']) : band==='elder' ? _pick(rnd,['grey','white','grey']) : _pick(rnd,['dark','brown','blonde']);
    var skin = _pick(rnd, SKIN_TONES);
    var accWeights = Object.assign({}, ACCESSORIES);
    if (band==='elder') { accWeights.hearingAid=0.25; accWeights.glasses=0.4; accWeights.none=0.35; }
    return {
      gender:gender, age:age, ageBand:band, skin:skin, hair:HAIR_COLORS[hairColorKey], hairStyle:hairStyle,
      hairColorKey:hairColorKey, headCovering:headCovering, faceShape:_pick(rnd,FACE_SHAPES),
      accessory:_weighted(rnd,accWeights), expression:band==='elder'?_pick(rnd,['tired','concerned','mild-pain','neutral']):_pick(rnd,EXPRESSIONS), seed:String(seed||'x')
    };
  }
  function renderAvatar(p) {
    var bandLabel = p.ageBand==='elder'?'Older adult':p.ageBand==='child'?'Child':p.ageBand==='teen'?'Teenager':'Adult';
    var accent = p.gender==='female'?'#b35c8a':'#2f7fb9';
    var muted  = p.ageBand==='elder'?'#d1d5db':p.skin;
    return '<svg viewBox="0 0 200 210" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Patient avatar">' +
      '<rect x="18" y="18" width="164" height="174" rx="22" fill="rgba(255,255,255,.08)" stroke="rgba(255,255,255,.18)" stroke-width="2"/>' +
      '<rect x="34" y="34" width="132" height="30" rx="15" fill="'+accent+'" opacity=".9"/>' +
      '<circle cx="100" cy="104" r="38" fill="'+muted+'" opacity=".9"/>' +
      '<path d="M54 170 Q60 135 100 135 Q140 135 146 170 Z" fill="'+accent+'" opacity=".75"/>' +
      '<path d="M74 104 Q100 78 126 104" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="8" stroke-linecap="round"/>' +
      '<circle cx="84" cy="108" r="4" fill="rgba(0,0,0,.45)"/><circle cx="116" cy="108" r="4" fill="rgba(0,0,0,.45)"/>' +
      '<path d="M82 126 Q100 134 118 126" fill="none" stroke="rgba(0,0,0,.38)" stroke-width="4" stroke-linecap="round"/>' +
      '<text x="100" y="55" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#fff">PATIENT</text>' +
      '<text x="100" y="185" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" font-weight="700" fill="currentColor">'+bandLabel+'</text>' +
    '</svg>';
  }

  /* ================================================================
     PROMPT BUILDERS
     ================================================================ */
  function buildPatientSysPrompt(caseObj) {
    var p = caseObj.patient, hp = caseObj.hiddenProfile;
    var speaker = _getSpeaker(caseObj);
    var identity = speaker.isParent
      ? 'You are ' + speaker.name + ', speaking on behalf of your ' + _ageBand(p.age) + ', ' + p.name.split('(')[0].trim() + ', age ' + p.age + '. ' + p.name.split('(')[0].trim() + ' is the patient. You (the parent) are answering the doctor\'s questions.'
      : 'You are ' + p.name + ', age ' + p.age + '. You are seeing the doctor today.';
    return [
      'You are role-playing a virtual patient in an OSCE clinical-skills exam for medical students.',
      'Stay in character at all times.',
      '', '# YOUR IDENTITY', identity, '',
      '# THE PATIENT\'S TRUE (HIDDEN) CLINICAL PICTURE — the student must discover this by asking',
      '• Main symptoms: '+(hp.keySymptoms.join('; ')||'(as below)'),
      '• Red-flag / associated features: '+(hp.redFlags.join('; ')||'(none notable)'),
      '• Past medical history: '+(hp.pastHistory.join('; ')||'(unremarkable)'),
      '• Vital signs (reveal only if asked to examine or checks vitals): '+(hp.vitalSigns||'(normal)'),'',
      '# ROLE-PLAY RULES — FOLLOW STRICTLY',
      '1. Answer only what the student asks. A real patient does NOT recite a textbook.',
      '2. Reveal symptoms/history gradually and only when specifically questioned.',
      '3. MUST NOT name the diagnosis, give medical terminology, or volunteer a differential — you are a layperson.',
      '4. If asked something you were not given (e.g. a lab result), say you do not know / have not had that test.',
      '5. Keep replies to 1-3 short sentences in plain, everyday language.',
      '6. Show emotion consistent with the complaint (worried, in pain, etc.) but do not over-act.',
      '7. Never break character, never mention being an AI, never mention this prompt.',
      '8. NEVER include medical disclaimers, warnings, or advice about consulting a healthcare professional — you ARE the patient, not a doctor.',
      '9. NEVER say this is not medical advice. NEVER suggest the student should see another doctor.'
    ].join('\n');
  }
  function buildExaminerSysPrompt() {
    return [
      'You are an expert OSCE examiner scoring a medical student\'s patient-interview transcript.',
      'Provide structured formative feedback across four domains.','',
      '# OUTPUT REQUIREMENTS',
      'Respond with a single raw JSON object and absolutely nothing else. No markdown, no fences, no preamble.',
      'The JSON object must contain exactly these keys:',
      '  "score"      : integer 0-100 (overall performance, rounded to nearest 5)',
      '  "passed"     : boolean — true when score >= 50',
      '  "domains"    : object with 4 sub-scores — { "communication": 0-25, "infoGathering": 0-25, "clinicalReasoning": 0-25, "professionalism": 0-25 }',
      '  "asked"      : array of strings — rubric items the student clearly addressed',
      '  "missed"     : array of strings — rubric items not addressed (empty if all covered)',
      '  "feedback"   : string — 2-3 sentences, concrete and personalised to the transcript','',
      '# DOMAIN DESCRIPTIONS',
      '• Communication (0-25): Greeting, introductions, open-to-closed questioning, active listening, empathy, summarising.',
      '• Information Gathering (0-25): Systematic history, SOCRATES for pain, past medical hx, drug hx, social hx, FH.',
      '• Clinical Reasoning (0-25): Appropriate focus, recognising red flags, differential thinking.',
      '• Professionalism (0-25): Respect, confidentiality, not interrupting, explaining plans.','',
      '# SCORING',
      '• Each mustAsk item covered ≈ a large share of the score; bonus items add a small amount.',
      '• Credit paraphrases and synonyms — do not require exact wording.',
      '• Never penalise question order.',
      '• Domain scores should sum to approximately the overall score.'
    ].join('\n');
  }
  function buildExaminerUserPrompt(caseObj, transcript) {
    var rubric = caseObj.rubric || {}; var lines = [];
    lines.push('CASE: '+caseObj.title);
    lines.push('CASE TASK: '+(caseObj.task||'Take a focused history.'));
    lines.push('MUST-ASK CRITERIA:');
    (rubric.mustAsk||[]).forEach(function (m, i) { lines.push('  '+(i+1)+'. '+m); });
    if (rubric.bonus&&rubric.bonus.length) { lines.push('BONUS CRITERIA:'); rubric.bonus.forEach(function (m, i) { lines.push('  '+(i+1)+'. '+m); }); }
    lines.push('');
    lines.push('INTERVIEW TRANSCRIPT (user = student, model = patient):');
    transcript.forEach(function (t) { lines.push((t.role==='user'?'Student: ':'Patient: ')+t.text); });
    lines.push(''); lines.push('Score this transcript against the criteria. Return the JSON object only.');
    return lines.join('\n');
  }
  function scoreRubric(raw) {
    var obj = null; try { obj = JSON.parse(raw); } catch (_) { return null; }
    if (!obj||typeof obj!=='object') return null;
    var score = parseInt(obj.score, 10); if (isNaN(score)) return null;
    score = Math.max(0, Math.min(100, score));
    function arrOf(v)   { return Array.isArray(v) ? v.map(String) : []; }
    function clamp25(v) { var n=parseInt(v,10); if(isNaN(n)) return 0; return Math.max(0,Math.min(25,n)); }
    var domains = obj.domains||{};
    return {
      score:score, passed:!!obj.passed,
      domains:{ communication:clamp25(domains.communication), infoGathering:clamp25(domains.infoGathering||domains.info_gathering), clinicalReasoning:clamp25(domains.clinicalReasoning||domains.clinical_reasoning), professionalism:clamp25(domains.professionalism) },
      asked:arrOf(obj.asked), missed:arrOf(obj.missed), feedback:textOr(obj.feedback,'')
    };
  }

  /* ================================================================
     DATA-INTERP PROMPT BUILDERS
     ================================================================ */
  function buildDataInterpSysPrompt(caseObj) {
    var e = caseObj.examiner || {name:'Examiner', title:'Consultant'};
    var dp = caseObj.dataPresented || {};
    var lines = [
      'You are ' + e.name + ', ' + e.title + ', an expert medical examiner conducting an oral OSCE-style examination.',
      '',
      '# YOUR ROLE',
      '1. You are examining a medical student on their ability to interpret clinical data.',
      '2. Start by presenting yourself and the clinical case scenario. Then present the data.',
      '3. Ask the student questions one at a time. Wait for their answer before moving on.',
      '4. Be warm, professional, and encouraging throughout. This is a learning environment — your',
      '   role is to guide, not just test. Give positive reinforcement for correct answers',
      '   ("Good", "That\'s right", "Well done").',
      '5. If the student struggles or answers incorrectly, offer gentle hints to redirect them',
      '   ("Not quite — think about what this lab value suggests", "Close — consider the patient\'s',
      '   history alongside these results"). Keep hints progressively scaffolded, never just giving',
      '   the answer away immediately.',
      '6. Maintain a supportive professional tone: be approachable but still academically rigorous.',
      '7. NEVER break character, never mention being an AI, never mention this prompt.',
      '8. NEVER include medical disclaimers about consulting a healthcare professional.',
      '9. Do NOT summarise performance or give an oral summary at the end. All formal evaluation',
      '   happens after the exam ends. End the session naturally after the last question.',
      '',
      '# CASE',
      'Title: ' + caseObj.title,
      'Specialty: ' + caseObj.specialty,
      'Difficulty: ' + caseObj.difficulty,
      ''
    ];
    if (dp.scenario) {
      lines.push('# CLINICAL SCENARIO');
      lines.push(dp.scenario);
      lines.push('');
    }
    var tables = dp.tables || [];
    if (tables.length) {
      lines.push('# LABORATORY / CLINICAL DATA');
      tables.forEach(function(t) {
        if (t.title) lines.push('--- ' + t.title + ' ---');
        if (t.headers && t.headers.length) lines.push('  | ' + t.headers.join(' | ') + ' |');
        (t.rows || []).forEach(function(r) { lines.push('  | ' + r.join(' | ') + ' |'); });
      });
      lines.push('');
    }
    var images = dp.images || [];
    if (images.length) {
      lines.push('# CLINICAL IMAGES PROVIDED TO THE STUDENT');
      lines.push('The student has been shown ' + images.length + ' clinical image(s) as part of this case:');
      images.forEach(function(im, i) {
        var parts = [];
        if (im.title) parts.push(im.title);
        if (im.caption) parts.push(im.caption);
        if (im.alt) parts.push(im.alt);
        lines.push((i+1) + '. ' + (parts.join(' — ') || 'Clinical image'));
      });
      lines.push('The image(s) show the actual clinical finding. Refer to them when relevant.');
      lines.push('');
    }
    var questions = caseObj.questions || [];
    if (questions.length) {
      lines.push('# EXAMINATION QUESTIONS (ask these in order, adapt naturally)');
      questions.forEach(function(q, qi) {
        lines.push((qi + 1) + '. ' + q.question);
        if (q.answer) lines.push('   Model answer: ' + q.answer);
        if (q.rubric) lines.push('   Marking guide: ' + q.rubric);
      });
      lines.push('');
    }
    lines.push('# LANGUAGE',
      'Match the student\'s language. If they write in Arabic, respond in Arabic.',
      'If they write in English, respond in English. Never switch mid-conversation.',
      'IMPORTANT: When responding in Arabic, keep ALL medical terminology, lab values,',
      'test names, diagnoses, drug names, and anatomical terms in their original English.',
      'Example: "تحليل CBC يظهر microcytic anemia مع ارتفاع HbA2" NOT "فقر الدم صغير الخلايا".',
      'Only the conversational framing should be in Arabic; clinical terms stay in English.',
      'Mixing Arabic and English is normal in Arab-world medical education — never penalise or',
      'comment negatively on code-switching. This is expected and appropriate.',
      '',
      '# SCORING',
      'Keep a mental score out of 100 based on:',
      '- Accuracy of answers (40%)',
      '- Clinical reasoning (30%)',
      '- Systematic approach (15%)',
      '- Communication (15%)',
      'Do NOT share this score or any oral summary with the student. Evaluation is reserved for the formal debrief.'
    );
    return lines.join('\n');
  }

  function buildDataInterpScoreSysPrompt() {
    return [
      'You are an expert medical examiner scoring a student\'s performance in a data-interpretation OSCE.',
      'Respond with a single raw JSON object and absolutely nothing else. No markdown, no fences, no preamble.',
      'The JSON object must contain exactly these keys:',
      '  "score"      : integer 0-100 (overall performance, rounded to nearest 5)',
      '  "passed"     : boolean — true when score >= 50',
      '  "domains"    : object — { "knowledge": 0-30, "interpretation": 0-30, "reasoning": 0-25, "communication": 0-15 }',
      '  "asked"      : array of strings — what the student did well',
      '  "missed"     : array of strings — areas that need improvement',
      '  "feedback"   : string — 2-3 sentences of personalised feedback',
      '',
      '# DOMAIN DESCRIPTIONS',
      '• Knowledge (0-30): Depth of clinical knowledge, accuracy of factual recall.',
      '• Interpretation (0-30): Ability to interpret lab values, recognise patterns, draw correct conclusions.',
      '• Reasoning (0-25): Logical differential diagnosis, appropriate next steps, systematic approach.',
      '• Communication (0-15): Clarity of responses, professional language, structured presentation.',
      '',
      '# LANGUAGE POLICY',
      'Mixing Arabic and English in responses is NORMAL and expected in Arab-world medical education.',
      'Do NOT penalise code-switching between Arabic and English. Clinical terms in English are standard.',
      'This must NOT appear in "missed" or negative feedback.'
    ].join('\n');
  }

  function buildDataInterpScoreUserPrompt(caseObj, transcript) {
    var dp = caseObj.dataPresented || {};
    var lines = ['CASE: ' + caseObj.title, 'SPECIALTY: ' + caseObj.specialty, ''];
    if (dp.scenario) lines.push('SCENARIO: ' + dp.scenario);
    if (dp.images && dp.images.length) {
      lines.push('IMAGES SHOWN TO STUDENT:');
      dp.images.forEach(function(im, i) {
        var parts = [];
        if (im.title) parts.push(im.title);
        if (im.caption) parts.push(im.caption);
        lines.push('  ' + (i+1) + '. ' + (parts.join(' — ') || 'Clinical image'));
      });
    }
    if (caseObj.questions && caseObj.questions.length) {
      lines.push('', 'QUESTIONS (these were the intended questions):');
      caseObj.questions.forEach(function(q, i) { lines.push((i + 1) + '. ' + q.question + (q.answer ? ' [' + q.answer + ']' : '')); });
    }
    lines.push('', 'TRANSCRIPT (user = student, model = examiner):');
    transcript.forEach(function(t) { lines.push((t.role === 'user' ? 'Student: ' : 'Examiner: ') + t.text); });
    lines.push('', 'Score this transcript against the criteria. Return the JSON object only.');
    return lines.join('\n');
  }

  function scoreDataInterp(raw) {
    var obj = null; try { obj = JSON.parse(raw); } catch (_) { return null; }
    if (!obj || typeof obj !== 'object') return null;
    var score = parseInt(obj.score, 10); if (isNaN(score)) return null;
    score = Math.max(0, Math.min(100, score));
    function arrOf(v) { return Array.isArray(v) ? v.map(String) : []; }
    function clamp(n, max) { var v = parseInt(n, 10); if (isNaN(v)) return 0; return Math.max(0, Math.min(max, v)); }
    var domains = obj.domains || {};
    return {
      score: score, passed: !!obj.passed,
      domains: {
        knowledge: clamp(domains.knowledge, 30),
        interpretation: clamp(domains.interpretation, 30),
        reasoning: clamp(domains.reasoning, 25),
        communication: clamp(domains.communication, 15)
      },
      asked: arrOf(obj.asked), missed: arrOf(obj.missed), feedback: textOr(obj.feedback, '')
    };
  }

  /* ================================================================
     GEMINI TRANSPORT (thin wrappers over EngineShared)
     ================================================================ */
  function _buildAttempts(model) {
    return EngineShared.airBuildAttempts(model, MODELS, _getRetryLevel());
  }
  function _tryRequests(systemPrompt, contents, apiKey, attempts, cancelSignal) {
    return EngineShared.airTryRequests(systemPrompt, contents, apiKey, attempts, cancelSignal, 0.4, _getMaxWaitMs());
  }
  function askPatient(caseObj, transcript, cancelSignal) {
    var apiKey=_readKey(), model=_getSavedModel(); if(!modelIsAvailable(model)) model=MODELS[0][0];
    var contents = transcript.map(function (m) { return {role:m.role==='model'?'model':'user',parts:[{text:m.text}]}; });
    return _tryRequests(buildPatientSysPrompt(caseObj),contents,apiKey,_buildAttempts(model),cancelSignal);
  }
  function scoreInterview(caseObj, transcript, cancelSignal) {
    var apiKey=_readKey(), model=_getSavedModel(); if(!modelIsAvailable(model)) model=MODELS[0][0];
    var contents = [{role:'user',parts:[{text:buildExaminerUserPrompt(caseObj,transcript)}]}];
    return _tryRequests(buildExaminerSysPrompt(),contents,apiKey,_buildAttempts(model),cancelSignal)
      .then(function (raw) { var cleaned=String(raw).replace(/^```(?:json)?/i,'').replace(/```$/,'').trim(); var parsed=scoreRubric(cleaned); if(!parsed) throw new Error('Examiner returned malformed feedback. Try again.'); return parsed; });
  }

  function askExaminer(caseObj, transcript, cancelSignal) {
    var apiKey = _readKey(), model = _getSavedModel();
    if (!modelIsAvailable(model)) model = MODELS[0][0];
    var contents = transcript.map(function (m) { return { role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] }; });
    return _tryRequests(buildDataInterpSysPrompt(caseObj), contents, apiKey, _buildAttempts(model), cancelSignal);
  }

  function scoreDataInterpExam(caseObj, transcript, cancelSignal) {
    var apiKey = _readKey(), model = _getSavedModel();
    if (!modelIsAvailable(model)) model = MODELS[0][0];
    var contents = [{ role: 'user', parts: [{ text: buildDataInterpScoreUserPrompt(caseObj, transcript) }] }];
    return _tryRequests(buildDataInterpScoreSysPrompt(), contents, apiKey, _buildAttempts(model), cancelSignal)
      .then(function (raw) {
        var cleaned = String(raw).replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
        var parsed = scoreDataInterp(cleaned);
        if (!parsed) throw new Error('Examiner returned malformed feedback. Try again.');
        return parsed;
      });
  }

  /* ================================================================
     UI LAYER v2
     ================================================================ */

  /* ── CSS ──────────────────────────────────────────────────────── */
  var _cssInjected = false;
  function _injectCSS() {
    if (_cssInjected) return; _cssInjected = true;
    var st = document.createElement('style');
    st.textContent = _buildCSS();
    document.head.appendChild(st);
  }

  function _buildCSS() {
    return ':root{--bg:#0d1117;--surface:#161b22;--surface2:#1c2330;--surface3:#101722;--border:#30363d;--text:#e6edf3;--text-muted:#8b949e;--accent:#f0a500;--accent-soft:rgba(240,165,0,.12);--accent-dim:rgba(240,165,0,.12);--accent-glow:rgba(240,165,0,.28);--correct:#2ea043;--correct-bg:rgba(46,160,67,.14);--wrong:#da3633;--wrong-bg:rgba(218,54,51,.14);--flag:#58a6ff;--flagged-bg:rgba(88,166,255,.12);--skip:#6e7681;--medical:#38bdf8;--medical-bg:rgba(56,189,248,.12);--purple:#8b5cf6;--purple-bg:rgba(139,92,246,.12);--radius:12px;--radius-sm:8px;--radius-xs:6px;--radius-full:999px;--shadow:0 8px 32px rgba(0,0,0,.32);--shadow-lg:0 20px 60px rgba(0,0,0,.48);--ease-out:cubic-bezier(.16,1,.3,1);--fast:.18s cubic-bezier(.16,1,.3,1);--transition:.2s cubic-bezier(.16,1,.3,1)}' +
    '[data-theme=light]{--bg:#f3f0eb;--surface:#fff;--surface2:#f8f6f1;--surface3:#fff;--border:#d0ccc5;--text:#1c1917;--text-muted:#78716c;--accent:#c27803;--accent-soft:rgba(194,120,3,.10);--accent-dim:rgba(194,120,3,.10);--accent-glow:rgba(194,120,3,.22);--correct:#16a34a;--correct-bg:rgba(22,163,74,.12);--wrong:#dc2626;--wrong-bg:rgba(220,38,38,.12);--flag:#2563eb;--flagged-bg:rgba(37,99,235,.12);--skip:#78716c;--medical:#0284c7;--medical-bg:rgba(2,132,199,.1);--purple:#7c3aed;--purple-bg:rgba(124,58,237,.1);--shadow:0 8px 28px rgba(28,25,23,.10);--shadow-lg:0 20px 60px rgba(28,25,23,.16)}' +
    /* BASE */
    '#osce-root{position:fixed;inset:0;background:var(--bg);color:var(--text);font-family:Outfit,sans-serif;display:flex;flex-direction:column;overflow:hidden}' +
    '#osce-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}' +
    '#osce-root h1,#osce-root h2,#osce-root h3{font-family:"Playfair Display",Georgia,serif}' +
    '#osce-root button{font-family:inherit;cursor:pointer}' +
    /* KEYFRAMES */
    '@keyframes fadeUp{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}' +
    '@keyframes fadeIn{from{opacity:0}to{opacity:1}}' +
    '@keyframes slideUp{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}' +
    '@keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.028)}}' +
    '@keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}' +
    '@keyframes bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-5px)}}' +
    '@keyframes ripple{to{transform:scale(6);opacity:0}}' +
    '@keyframes barGrow{from{width:0}}' +
    '@keyframes floatIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}' +
    '@keyframes scoreReveal{from{opacity:0;transform:scale(.5)}to{opacity:1;transform:scale(1)}}' +
    '@keyframes badgePop{from{opacity:0;transform:scale(.4) rotate(-10deg)}to{opacity:1;transform:scale(1) rotate(0)}}' +
    '@keyframes timerDanger{0%,100%{color:var(--wrong)}50%{color:#ff5555;transform:scale(1.06)}}' +
    '@keyframes micPulse{0%{box-shadow:0 0 0 0 rgba(218,54,51,.65)}70%{box-shadow:0 0 0 16px rgba(218,54,51,0)}100%{box-shadow:0 0 0 0 rgba(218,54,51,0)}}' +
    '@keyframes speakPulse{0%{box-shadow:0 0 0 0 rgba(56,189,248,.65)}70%{box-shadow:0 0 0 16px rgba(56,189,248,0)}100%{box-shadow:0 0 0 0 rgba(56,189,248,0)}}' +
    '@keyframes w1{0%,100%{height:4px}50%{height:18px}}@keyframes w2{0%,100%{height:9px}50%{height:26px}}@keyframes w3{0%,100%{height:6px}50%{height:22px}}' +
    /* LOBBY */
    '.osce-lobby{flex:1;display:flex;align-items:center;justify-content:center;padding:1.25rem;overflow-y:auto;background:var(--bg)}' +
    '.osce-lobby-card{width:min(800px,100%);background:var(--surface);border:1px solid var(--border);border-radius:20px;box-shadow:var(--shadow-lg);animation:fadeUp .32s var(--ease-out) both}' +
    '.osce-lobby-top{display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.25rem;border-bottom:1px solid var(--border)}' +
    '.osce-lobby-kicker{font-size:.65rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);display:flex;align-items:center;gap:.4rem}' +
    '.osce-lobby-hero{display:grid;grid-template-columns:auto 1fr;gap:1.5rem;align-items:center;padding:1.35rem 1.25rem 1rem}' +
    '.osce-lobby-av-wrap{position:relative;flex-shrink:0}' +
    '.osce-lobby-av{width:128px;height:140px;border-radius:14px;overflow:hidden;border:2px solid var(--border);background:var(--surface2);animation:breathe 4s ease-in-out infinite;box-shadow:0 0 0 6px var(--medical-bg)}' +
    '.osce-lobby-av svg{width:100%;height:100%;display:block}' +
    '.osce-pt-name{font-size:1.55rem;font-weight:700;line-height:1.15;font-family:"Playfair Display",Georgia,serif;margin-bottom:.45rem}' +
    '.osce-pt-chips{display:flex;flex-wrap:wrap;gap:.38rem;margin-bottom:.7rem}' +
    '.osce-chip-meta{display:inline-flex;align-items:center;gap:.22rem;font-size:.68rem;font-weight:700;padding:.22rem .55rem;border-radius:var(--radius-full);border:1px solid var(--border);background:var(--surface2);color:var(--text-muted)}' +
    '.osce-chip-meta.sp{border-color:rgba(56,189,248,.3);color:var(--medical);background:var(--medical-bg)}' +
    '.osce-chip-meta.df-e{border-color:rgba(46,160,67,.3);color:var(--correct);background:var(--correct-bg)}' +
    '.osce-chip-meta.df-m{border-color:rgba(240,165,0,.3);color:var(--accent);background:var(--accent-dim)}' +
    '.osce-chip-meta.df-h{border-color:rgba(218,54,51,.3);color:var(--wrong);background:var(--wrong-bg)}' +
    '.osce-lobby-body{padding:0 1.25rem 1rem}' +
    '.osce-task-label{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:.35rem}' +
    '.osce-task-box{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.85rem 1rem;font-size:.92rem;line-height:1.6;margin-bottom:1rem}' +
    '.osce-lobby-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:.45rem;margin-bottom:.9rem}' +
    '.osce-stat-card{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.6rem .7rem;text-align:center}' +
    '.osce-stat-val{font-size:1.05rem;font-weight:800;line-height:1;margin-bottom:.16rem;font-variant-numeric:tabular-nums}' +
    '.osce-stat-lbl{font-size:.58rem;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted);font-weight:700}' +
    '.osce-lobby-flow{display:grid;grid-template-columns:repeat(5,1fr);gap:.38rem;margin-bottom:1.1rem}' +
    '.osce-flow-pill{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.5rem .4rem;text-align:center}' +
    '.osce-flow-pill .n{display:block;font-size:.62rem;font-weight:800;color:var(--accent);margin-bottom:.1rem}' +
    '.osce-flow-pill .t{display:block;font-size:.72rem;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.osce-flow-pill .s{display:block;font-size:.6rem;color:var(--text-muted);margin-top:.08rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.osce-lobby-actions{padding:.9rem 1.25rem;border-top:1px solid var(--border);display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}' +
    /* ROOM */
    '.osce-room{flex:1;display:grid;grid-template-rows:auto 3px auto 1fr auto;min-height:0;overflow:hidden}' +
    '.osce-hdr{display:flex;align-items:center;gap:.6rem;padding:.6rem .9rem;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0}' +
    '.osce-hdr-title{flex:1;min-width:0}' +
    '.osce-hdr-title .c{font-size:.8rem;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.osce-hdr-title .t{font-size:.64rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}' +
    '.osce-hdr-right{display:flex;align-items:center;gap:.35rem;flex-shrink:0}' +
    '.osce-timer-wrap{display:flex;flex-direction:column;align-items:center;gap:1px;padding:0 .55rem;border-left:1px solid var(--border);margin-left:.1rem;flex-shrink:0}' +
    '.osce-timer{font-variant-numeric:tabular-nums;font-weight:800;font-size:1.08rem;font-family:Outfit,system-ui,sans-serif;line-height:1}' +
    '.osce-timer.ok{color:var(--correct)}.osce-timer.warn{color:var(--accent)}.osce-timer.danger{animation:timerDanger .75s ease-in-out infinite}' +
    '.osce-timer-lbl{font-size:.54rem;text-transform:uppercase;letter-spacing:.07em;color:var(--text-muted)}' +
    '.osce-tbar{height:3px;background:var(--surface2);flex-shrink:0;overflow:hidden}' +
    '.osce-tbar-fill{height:100%;transition:width 1s linear,background .5s ease}' +
    '.osce-tbar-fill.ok{background:var(--correct)}.osce-tbar-fill.warn{background:var(--accent)}.osce-tbar-fill.danger{background:var(--wrong)}' +
    '.osce-timeup{display:none;background:linear-gradient(135deg,#7f1d1d,#991b1b);color:#fecaca;font-weight:700;font-size:.8rem;text-align:center;padding:.38rem;flex-shrink:0;animation:pulse 1.5s ease-in-out infinite}' +
    '.osce-timeup.show{display:block}' +
    '.osce-body{min-height:0;display:grid;grid-template-columns:var(--osce-sidebar-w,260px) auto 1fr;overflow:hidden}' +
    /* SIDEBAR DRAG HANDLE */
    '.osce-sidebar-handle{width:5px;cursor:col-resize;flex-shrink:0;position:relative;z-index:3;background:transparent}' +
    '.osce-sidebar-handle::before{content:"";position:absolute;inset:3px 1px;width:3px;border-radius:2px;background:var(--border);transition:background .2s ease,inset .2s ease}' +
    '.osce-sidebar-handle:hover::before,.osce-sidebar-handle:active::before{background:var(--accent);inset:0 1px}' +
    /* COLLAPSIBLE DATA TABLES */
    '.osce-collapse-wrap{margin-bottom:.6rem}' +
    '.osce-collapse-btn{width:100%;padding:.5rem .65rem;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface2);color:var(--text);font-family:inherit;font-size:.75rem;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:space-between;transition:border-color .2s,background .2s}' +
    '.osce-collapse-btn:hover{border-color:var(--accent);background:var(--accent-dim)}' +
    '.osce-collapse-btn .chev{font-size:.55rem;transition:transform .25s ease;display:inline-block}' +
    '.osce-collapse-btn.open .chev{transform:rotate(180deg)}' +
    '.osce-collapse-content{overflow:hidden;max-height:0;transition:max-height .35s ease;will-change:max-height}' +
    '.osce-collapse-content.open{max-height:3000px}' +
    /* SIDEBAR */
    '.osce-sidebar{background:var(--surface2);border-right:1px solid var(--border);display:flex;flex-direction:column;gap:.6rem;padding:.8rem;overflow-y:auto;min-height:0}' +
    '.osce-sidebar::-webkit-scrollbar{width:4px}.osce-sidebar::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}' +
    '.osce-sb-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.7rem}' +
    '.osce-pt-id{display:grid;grid-template-columns:60px 1fr;gap:.6rem;align-items:center}' +
    '.osce-av-mini{width:60px;height:65px;border-radius:8px;overflow:hidden;border:1px solid var(--border);background:var(--surface2)}' +
    '.osce-av-mini svg{width:100%;height:100%;display:block}' +
    '.osce-pt-nm{font-weight:800;font-size:.88rem;line-height:1.2}' +
    '.osce-pt-sb{font-size:.7rem;color:var(--text-muted);margin-top:.14rem;line-height:1.4}' +
    '.osce-sb-lbl{font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:.38rem}' +
    '.osce-instr-box{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.65rem .8rem}' +
    '.osce-instr-txt{font-size:.78rem;line-height:1.5;color:var(--text)}' +
    '.osce-pw-row{display:flex;justify-content:space-between;align-items:center;font-size:.73rem;color:var(--text-muted);margin-bottom:.32rem}' +
    '.osce-pw-row strong{color:var(--text);font-variant-numeric:tabular-nums}' +
    '.osce-xp-track{height:5px;background:var(--border);border-radius:var(--radius-full);overflow:hidden;margin-top:.4rem}' +
    '.osce-xp-fill{height:100%;background:linear-gradient(90deg,var(--medical),var(--accent));border-radius:var(--radius-full);transition:width .35s var(--ease-out)}' +
    '.osce-map-steps{display:flex;flex-direction:column;gap:.26rem}' +
    '.osce-map-step{display:flex;align-items:center;gap:.45rem;font-size:.74rem;color:var(--text-muted);padding:.26rem .35rem;border-radius:var(--radius-xs);transition:all var(--fast)}' +
    '.osce-map-step::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--border);flex:0 0 auto;transition:background var(--fast)}' +
    '.osce-map-step.active{color:var(--text);font-weight:700;background:var(--accent-dim)}.osce-map-step.active::before{background:var(--accent)}' +
    '.osce-map-step.done::before{background:var(--correct)}' +
      '.osce-chips-wrap{display:flex;flex-wrap:wrap;gap:.32rem}' +
      '.osce-qchip{border:1px solid var(--border);background:var(--surface);color:var(--text-muted);border-radius:var(--radius-full);padding:.24rem .52rem;font-size:.68rem;font-weight:650;cursor:pointer;transition:all var(--fast);text-align:left}' +
      '.osce-qchip:hover{border-color:var(--accent);color:var(--text);background:var(--accent-dim)}.osce-qchip:active{transform:scale(.94)}' +
      '@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}' +
    /* CHAT */
    '.osce-chat-zone{min-height:0;display:grid;grid-template-rows:1fr auto auto;background:linear-gradient(180deg,var(--bg),var(--surface3))}' +
    '.osce-transcript{overflow-y:auto;padding:1rem 1.15rem;display:flex;flex-direction:column;gap:.7rem}' +
    '.osce-transcript::-webkit-scrollbar{width:6px}.osce-transcript::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}' +
    '.osce-msg{display:flex;flex-direction:column;max-width:min(82%,650px);animation:fadeUp .22s var(--ease-out) both}' +
    '.osce-msg.patient{align-self:flex-start}.osce-msg.student{align-self:flex-end;align-items:flex-end}' +
    '.osce-msg-lbl{font-size:.58rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-bottom:.28rem;display:flex;align-items:center;gap:.3rem}' +
    '.osce-msg.patient .osce-msg-lbl{color:var(--medical)}.osce-msg.student .osce-msg-lbl{color:var(--accent)}' +
    '.osce-bubble{padding:.65rem .9rem;border-radius:var(--radius);font-size:.9rem;line-height:1.6;position:relative}' +
    '.osce-msg.patient .osce-bubble{background:var(--surface);border:1px solid var(--border);box-shadow:0 2px 12px rgba(0,0,0,.09)}' +
    '.osce-msg.student .osce-bubble{background:linear-gradient(135deg,rgba(240,165,0,.13),rgba(240,165,0,.06));border:1px solid rgba(240,165,0,.26);box-shadow:0 2px 10px rgba(0,0,0,.07)}' +
    '.osce-msg.interim .osce-interim{opacity:.7;font-style:italic;min-width:60px}' +
    '.osce-interim-cursor{animation:osceBlink .6s step-end infinite;display:inline-block;margin-left:2px;color:var(--accent)}' +
    '@keyframes osceBlink{50%{opacity:0}}' +
    '.osce-thinking{align-self:flex-start;animation:fadeUp .18s var(--ease-out) both}' +
    '.osce-thinking-lbl{font-size:.58rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--medical);margin-bottom:.28rem}' +
    '.osce-thinking-bub{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:.6rem .88rem;display:inline-flex;align-items:center;gap:.5rem}' +
    '.osce-thinking-txt{font-size:.8rem;color:var(--text-muted);font-style:italic}' +
    '.osce-dots{display:inline-flex;gap:4px}.osce-dots span{width:6px;height:6px;border-radius:50%;background:var(--medical);animation:bounce 1.4s ease-in-out infinite}' +
    '.osce-dots span:nth-child(2){animation-delay:.22s}.osce-dots span:nth-child(3){animation-delay:.44s}' +
    '.osce-error-bar{background:rgba(218,54,51,.12);border:1px solid rgba(218,54,51,.28);border-radius:var(--radius-sm);color:var(--wrong);font-size:.79rem;padding:.48rem .85rem;margin:.15rem 1.15rem;display:none;animation:fadeIn .2s ease}' +
    '.osce-error-bar.show{display:block}' +
    /* INPUT */
    '.osce-input-area{background:var(--surface);border-top:1px solid var(--border);flex-shrink:0}' +
    '.osce-voice-bar{display:flex;align-items:center;justify-content:center;gap:.55rem;padding:.38rem 1rem;border-bottom:1px solid var(--border);min-height:34px;background:var(--surface2)}' +
    '.osce-voice-status{font-size:.7rem;font-weight:600;color:var(--text-muted);display:flex;align-items:center;gap:.38rem;transition:color var(--fast)}' +
    '.osce-voice-status.listening{color:var(--wrong)}.osce-voice-status.speaking{color:var(--medical)}' +
    '.osce-vstatus-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}' +
    '.osce-voice-status.listening .osce-vstatus-dot,.osce-voice-status.speaking .osce-vstatus-dot{animation:pulse .8s infinite}' +
    '.osce-waveform{display:none;align-items:flex-end;gap:2px;height:20px}' +
    '.osce-waveform.active{display:flex}' +
    '.osce-wbar{width:3px;border-radius:2px;background:var(--wrong)}' +
    '.osce-wbar:nth-child(1){animation:w1 .7s ease-in-out infinite}' +
    '.osce-wbar:nth-child(2){animation:w2 .7s ease-in-out .1s infinite}' +
    '.osce-wbar:nth-child(3){animation:w3 .7s ease-in-out .2s infinite}' +
    '.osce-wbar:nth-child(4){animation:w2 .7s ease-in-out .3s infinite}' +
    '.osce-wbar:nth-child(5){animation:w1 .7s ease-in-out .4s infinite}' +
    '.osce-input-row{display:flex;align-items:flex-end;gap:.48rem;padding:.65rem .9rem}' +
    '.osce-textarea{flex:1;resize:none;min-height:42px;max-height:120px;padding:.58rem .82rem;border-radius:var(--radius-sm);border:1.5px solid var(--border);background:var(--bg);color:var(--text);font-family:Outfit,system-ui,sans-serif;font-size:.88rem;outline:none;transition:border-color var(--fast),box-shadow var(--fast);line-height:1.5}' +
    '.osce-textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-glow)}' +
    '.osce-textarea::placeholder{color:var(--text-muted)}' +
    '.osce-mic-btn{width:44px;height:44px;border-radius:50%;border:2px solid var(--border);background:var(--surface2);color:var(--text-muted);font-size:1.05rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all var(--fast);position:relative}' +
    '.osce-mic-btn:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-dim)}' +
    '.osce-mic-btn.active{background:var(--wrong);border-color:var(--wrong);color:#fff;animation:micPulse 1.3s ease-in-out infinite}' +
    '.osce-mic-btn.speaking{background:var(--medical);border-color:var(--medical);color:#fff;animation:speakPulse 1.3s ease-in-out infinite}' +
    '.osce-mic-btn:disabled{opacity:.35;cursor:not-allowed;animation:none}' +
    '.osce-send-btn{min-height:44px;padding:.6rem 1.05rem;border-radius:var(--radius-sm);border:none;background:var(--accent);color:#000;font-weight:800;font-size:.84rem;cursor:pointer;position:relative;overflow:hidden;flex-shrink:0;transition:opacity var(--fast),transform var(--fast),box-shadow var(--fast)}' +
    '.osce-send-btn:hover{opacity:.9;transform:translateY(-1px);box-shadow:0 4px 16px var(--accent-glow)}' +
    '.osce-send-btn:active{transform:scale(.95) translateY(0)}.osce-send-btn:disabled{opacity:.35;cursor:not-allowed;transform:none;box-shadow:none}' +
    '.osce-submit-row{display:flex;align-items:center;gap:.5rem;padding:.3rem .9rem .6rem}' +
    '.osce-submit-btn{flex:1;min-height:36px;padding:.5rem;border-radius:var(--radius-sm);border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-weight:600;font-size:.78rem;cursor:pointer;transition:all var(--fast)}' +
    '.osce-submit-btn:hover{border-color:var(--medical);color:var(--medical)}' +
    '.osce-reset-btn{min-height:36px;padding:.5rem .7rem;border-radius:var(--radius-sm);border:1.5px solid var(--border);background:var(--surface2);color:var(--text-muted);font-weight:500;font-size:.78rem;cursor:pointer;transition:all var(--fast)}' +
    '.osce-reset-btn:hover{border-color:var(--wrong);color:var(--wrong)}' +
    '.osce-turn-badge{font-size:.68rem;font-weight:800;padding:.2rem .5rem;border-radius:var(--radius-full);background:var(--surface2);border:1px solid var(--border);white-space:nowrap;font-variant-numeric:tabular-nums;transition:all var(--fast)}' +
    '.osce-turn-badge.warn{border-color:rgba(240,165,0,.4);color:var(--accent);background:var(--accent-dim)}' +
    '.osce-turn-badge.danger{border-color:rgba(218,54,51,.4);color:var(--wrong);background:var(--wrong-bg)}' +
    /* COMMON BUTTONS */
    '.osce-icon-btn{width:34px;height:34px;border-radius:var(--radius-sm);background:var(--surface2);border:1px solid var(--border);color:var(--text-muted);font-size:.88rem;display:flex;align-items:center;justify-content:center;transition:all var(--fast);flex-shrink:0}' +
    '.osce-icon-btn:hover{color:var(--text);border-color:var(--accent);background:var(--accent-dim)}.osce-icon-btn:active{transform:scale(.87)}' +
    '.osce-primary-btn{min-height:42px;padding:.65rem 1.3rem;border-radius:var(--radius-sm);border:none;background:var(--accent);color:#000;font-weight:800;font-size:.9rem;cursor:pointer;position:relative;overflow:hidden;transition:opacity var(--fast),transform var(--fast),box-shadow var(--fast)}' +
    '.osce-primary-btn:hover{opacity:.9;transform:translateY(-1px);box-shadow:0 4px 16px var(--accent-glow)}.osce-primary-btn:active{transform:scale(.95) translateY(0)}' +
    '.osce-secondary-btn{min-height:42px;padding:.65rem 1.1rem;border-radius:var(--radius-sm);border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-weight:600;font-size:.88rem;cursor:pointer;transition:border-color var(--fast),background var(--fast)}' +
    '.osce-secondary-btn:hover{border-color:var(--accent)}' +
    '.osce-ripple{position:absolute;border-radius:50%;background:rgba(255,255,255,.22);transform:scale(0);animation:ripple .55s var(--ease-out);pointer-events:none}' +
    /* DEBRIEF — exact match with quiz-engine result screen */
    '.osce-debrief-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9000;display:none;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(6px)}' +
    '.osce-debrief-overlay.open{display:flex}' +
    '.osce-debrief-modal{background:var(--surface);border:1px solid var(--border);border-radius:16px;width:min(840px,97vw);max-height:93vh;overflow-y:auto;animation:slideUp .3s var(--ease-out) both;box-shadow:var(--shadow-lg)}' +
    '.osce-debrief-modal::-webkit-scrollbar{width:5px}.osce-debrief-modal::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}' +
    '.osce-db-body{padding:1.5rem;display:flex;flex-direction:column;gap:1.5rem}' +
    /* Score banner — identical to quiz-engine */
    '.score-banner{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:1.75rem 2rem;display:flex;align-items:center;gap:2rem;flex-wrap:wrap;box-shadow:var(--shadow)}' +
    '.score-circle{width:110px;height:110px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:4px solid var(--accent);flex-shrink:0;position:relative;background:var(--accent-dim)}' +
    '.score-circle .pct{font-size:1.8rem;font-weight:700;color:var(--accent);line-height:1}' +
    '.score-circle .lbl{font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em}' +
    '.score-details{flex:1;min-width:180px}' +
    '.score-details h3{font-family:"Playfair Display",Georgia,serif;font-size:1.4rem;margin:0 0 0.75rem}' +
    '.score-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:0.65rem}' +
    '.score-stat{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:0.65rem 0.85rem;transition:border-color 0.22s cubic-bezier(0.16,1,0.3,1)}' +
    '.score-stat:hover{border-color:var(--accent)}' +
    '.score-stat .n{font-size:1.2rem;font-weight:700}' +
    '.score-stat .t{font-size:0.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.03em}' +
    '.n.green{color:var(--correct)}.n.red{color:var(--wrong)}.n.blue{color:var(--flag)}.n.muted{color:var(--text-muted)}' +
    /* Domain scores grid */
    '.osce-db-section{border:1px solid var(--border);border-radius:16px;padding:1.25rem 1.5rem;background:var(--surface);box-shadow:var(--shadow)}' +
    '.osce-db-sec-title{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:.75rem;display:flex;align-items:center;gap:.38rem}' +
    /* DATA TABLES (data-interp mode) */
    '.osce-data-table-wrap{overflow-x:auto;margin-bottom:.6rem}' +
    '.osce-data-table{width:100%;border-collapse:collapse;font-size:.72rem}' +
    '.osce-data-table th,.osce-data-table td{padding:.28rem .4rem;border:1px solid var(--border);text-align:left}' +
    '.osce-data-table th{background:var(--surface2);font-weight:700;color:var(--text);font-size:.65rem;text-transform:uppercase;letter-spacing:.04em}' +
    '.osce-data-table td{color:var(--text-muted)}' +
    '.osce-data-table td:last-child{font-family:ui-monospace,monospace;font-weight:600;color:var(--text)}' +
    '.osce-data-title{font-size:.68rem;font-weight:700;color:var(--accent);margin-bottom:.25rem;text-transform:uppercase;letter-spacing:.05em}' +
    '.osce-scenario-box{background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.55rem .65rem;font-size:.76rem;line-height:1.5;margin-bottom:.5rem}' +
    /* CASE IMAGES (data-interp mode, radiology/visual diagnosis) */
    '.osce-image-block{margin-bottom:.6rem;background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden}' +
    '.osce-image-block img{display:block;width:100%;height:auto;max-height:340px;object-fit:contain;background:#000;border-bottom:1px solid var(--border)}' +
    '.osce-image-caption{padding:.4rem .55rem;font-size:.68rem;color:var(--text-muted);line-height:1.4}' +
    '.osce-image-title{font-size:.65rem;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:.05em;padding:.4rem .55rem .15rem;border-bottom:1px solid var(--border);background:var(--surface)}' +
    '.osce-images-wrap{margin-bottom:.6rem}' +
    '.osce-collapse-btn.osce-img-toggle{background:var(--surface2);border:1px solid var(--border);color:var(--text);padding:.4rem .6rem;border-radius:var(--radius-sm);font-size:.7rem;font-weight:600;cursor:pointer;width:100%;text-align:left;display:flex;justify-content:space-between;align-items:center;margin-bottom:.4rem}' +
    '.osce-collapse-btn.osce-img-toggle:hover{border-color:var(--accent)}' +
    '.osce-collapse-content.osce-images-content{max-height:0;overflow:hidden;transition:max-height .3s ease}' +
    '.osce-collapse-content.osce-images-content.open{max-height:5000px;overflow:auto}' +
    '.osce-domain-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}' +
    '.osce-domain-item{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:.6rem .75rem}' +
    '.osce-domain-name{font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:.16rem}' +
    '.osce-domain-score{font-size:1rem;font-weight:800;font-variant-numeric:tabular-nums}' +
    '.osce-domain-score .of{font-size:.62rem;font-weight:400;color:var(--text-muted)}' +
    '.osce-dbar-track{height:4px;background:var(--border);border-radius:999px;overflow:hidden;margin-top:.38rem}' +
    '.osce-dbar-fill{height:100%;border-radius:999px;animation:barGrow .8s var(--ease-out) .4s both}' +
    '.osce-domain-item.good .osce-dbar-fill{background:var(--correct)}.osce-domain-item.avg .osce-dbar-fill{background:var(--accent)}.osce-domain-item.low .osce-dbar-fill{background:var(--wrong)}' +
    '.osce-domain-item.good .osce-domain-score{color:var(--correct)}.osce-domain-item.avg .osce-domain-score{color:var(--accent)}.osce-domain-item.low .osce-domain-score{color:var(--wrong)}' +
    /* Radar */
    '.osce-radar-wrap{display:flex;align-items:center;gap:1.5rem}' +
    '.osce-radar-svg-el{width:160px;height:160px;flex-shrink:0}' +
    '.osce-radar-legend{flex:1;display:flex;flex-direction:column;gap:.45rem}' +
    '.osce-radar-legend-row{display:flex;align-items:center;gap:.45rem;font-size:.74rem}' +
    '.osce-radar-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}' +
    /* Feedback */
    '.osce-feedback-box{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:.8rem 1rem;font-size:.88rem;line-height:1.65}' +
    '.osce-dx-box{background:var(--medical-bg);border:1px solid rgba(56,189,248,.25);border-radius:10px;padding:.62rem .88rem;font-size:.85rem;margin:.6rem 0;display:flex;align-items:center;gap:.55rem}' +
    '.osce-dx-box strong{color:var(--medical)}' +
    /* Criteria */
    '.osce-criteria-grid{display:grid;grid-template-columns:1fr 1fr;gap:1rem}' +
    '.osce-criteria-sec h4{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:.45rem;display:flex;align-items:center;gap:.3rem}' +
    '.osce-criteria-sec ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.3rem}' +
    '.osce-criteria-sec ul li{font-size:.79rem;line-height:1.45;padding:.28rem .48rem;border-radius:6px;animation:floatIn .3s var(--ease-out) both}' +
    '.osce-asked-item{background:var(--correct-bg);color:var(--correct);border-left:3px solid var(--correct)}' +
    '.osce-missed-item{background:var(--wrong-bg);color:var(--wrong);border-left:3px solid var(--wrong)}' +
    /* Badges */
    '.osce-badges{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.5rem}' +
    '.osce-badge{display:flex;align-items:center;gap:.38rem;padding:.32rem .65rem;border-radius:999px;font-size:.7rem;font-weight:700;animation:badgePop .4s var(--ease-out) both;border:1px solid var(--border);background:var(--surface2)}' +
    '.osce-badge.gold{border-color:rgba(240,165,0,.4);background:var(--accent-dim);color:var(--accent)}' +
    '.osce-badge.green{border-color:rgba(46,160,67,.4);background:var(--correct-bg);color:var(--correct)}' +
    '.osce-badge.blue{border-color:rgba(56,189,248,.4);background:var(--medical-bg);color:var(--medical)}' +
    '.osce-badge.purple{border-color:rgba(139,92,246,.4);background:var(--purple-bg);color:var(--purple)}' +
    '.osce-badge-icon{font-size:.95rem}' +
    /* Actions — identical to quiz-engine result-actions */
    '.result-actions{display:flex;gap:1rem;flex-wrap:wrap}' +
    '.btn-restart{display:flex;align-items:center;gap:0.5rem;padding:0.85rem 1.75rem;border-radius:10px;background:var(--accent);color:#000;font-weight:700;font-size:0.95rem;border:1.5px solid var(--accent);transition:all 0.22s cubic-bezier(0.16,1,0.3,1);cursor:pointer;text-decoration:none}' +
    '.btn-restart:hover{opacity:0.85;transform:translateY(-1px)}' +
    '.btn-secondary{background:var(--surface2);color:var(--text);border-color:var(--border)}' +
    '.btn-secondary:hover{border-color:var(--accent);color:var(--accent);opacity:1}' +
    /* SETTINGS */
    '#osce-sov{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:10001;display:none;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(4px)}' +
    '#osce-sov.open{display:flex}' +
    '.osce-reset-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:10002;display:none;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(6px)}' +
    '.osce-reset-overlay.open{display:flex}' +
    '.osce-reset-modal{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:1.8rem;max-width:380px;width:100%;text-align:center;animation:slideUp .32s var(--ease-out) both}' +
    '.osce-reset-modal h3{margin:0 0 .4rem 0;font-size:1.15rem;font-family:"Playfair Display",Georgia,serif}' +
    '.osce-reset-modal p{margin:0 0 1.2rem 0;font-size:.85rem;color:var(--text-muted);line-height:1.5}' +
    '.osce-reset-actions{display:flex;gap:.6rem;justify-content:center}' +
    '.osce-reset-actions button{min-height:38px;padding:.5rem 1.2rem;border-radius:var(--radius-sm);border:1.5px solid var(--border);background:var(--surface2);color:var(--text);font-weight:600;font-size:.82rem;cursor:pointer;transition:all var(--fast)}' +
    '.osce-reset-actions button.osce-reset-danger{border-color:var(--wrong);color:var(--wrong)}' +
    '.osce-reset-actions button.osce-reset-danger:hover{background:var(--wrong);color:#fff}' +
    '.osce-reset-actions button.osce-reset-cancel:hover{border-color:var(--accent);color:var(--accent)}' +
    '#osce-smodal{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);width:min(460px,96vw);max-height:92vh;overflow-y:auto;box-shadow:var(--shadow-lg);animation:slideUp .25s var(--ease-out)}' +
    '#osce-smodal::-webkit-scrollbar{width:4px}#osce-smodal::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}' +
    '.osce-sh{display:flex;align-items:center;justify-content:space-between;padding:.9rem 1.1rem;border-bottom:1px solid var(--border)}' +
    '.osce-sh h3{margin:0;font-size:1rem;font-family:"Playfair Display",Georgia,serif}' +
    '.osce-sbody{padding:.85rem 1.1rem;display:flex;flex-direction:column;gap:.8rem}' +
    '.field-box label,.field-label{display:block;color:var(--accent);font-size:.78rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-bottom:8px}' +
    '.field-box .note,.field-note{font-size:.82rem;color:var(--text-muted);margin-top:8px}.field-box .note a,.field-note a{color:var(--accent);text-decoration:none}' +
    '.field-box input[type=password],.field-box select{width:100%;padding:.65rem .8rem;border-radius:var(--radius-sm);border:1.5px solid var(--border);background:var(--bg);color:var(--text);font-family:inherit;font-size:.84rem;outline:none;transition:border-color var(--fast)}' +
    '.field-box input:focus,.field-box select:focus{border-color:var(--accent)}' +
    '.api-row{display:flex;gap:8px}.api-row input{flex:1}' +
    '.osce-btn-row,.btn-row{display:flex;gap:8px;margin-top:10px}' +
    '.osce-btn-row button{padding:.48rem .88rem;border-radius:var(--radius-sm);border:1.5px solid var(--border);font-size:.79rem;font-weight:600;cursor:pointer;background:var(--surface2);color:var(--text);transition:all var(--fast)}' +
    '.osce-btn-row button:hover{border-color:var(--accent)}' +
    '.osce-btn-row .bp{background:var(--accent);color:#000;border-color:var(--accent)}' +
    '.osce-btn-row .bp:hover{opacity:.9}' +
    '.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:var(--radius-sm);font-weight:700;min-height:40px;padding:.7rem 1.25rem;transition:transform var(--fast),background var(--fast),border-color var(--fast),color var(--fast);cursor:pointer;font-family:inherit}.btn:hover{transform:translateY(-1px)}' +
    '.btn-primary{background:var(--accent);color:#111;border:1.5px solid var(--accent)}' +
    '.btn-secondary{background:var(--surface2);border:1.5px solid var(--border);color:var(--text)}.btn-secondary:hover{border-color:var(--accent)}' +
    '#settings-status{font-size:.85rem;color:var(--text-muted);margin-top:8px;min-height:1.2em}' +
    '.osce-stitle{font-size:.62rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);padding:.3rem 0;border-bottom:1px solid var(--border);margin-bottom:.1rem}' +
    '.osce-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:.75rem}' +
    '.osce-toggle-row label{font-size:.81rem;font-weight:600;flex:1}' +
    '.osce-toggle{position:relative;width:38px;height:22px;flex-shrink:0}' +
    '.osce-toggle input{opacity:0;width:0;height:0;position:absolute}' +
    '.osce-toggle-tk{position:absolute;inset:0;border-radius:11px;background:var(--border);cursor:pointer;transition:background var(--fast)}' +
    '.osce-toggle-tk::before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;border-radius:50%;background:#fff;transition:transform var(--fast)}' +
    '.osce-toggle input:checked + .osce-toggle-tk{background:var(--accent)}' +
    '.osce-toggle input:checked + .osce-toggle-tk::before{transform:translateX(16px)}' +
    '.osce-sf{padding:.75rem 1.1rem;border-top:1px solid var(--border)}' +
    /* TOAST */
    '.toast{position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%) translateY(80px);background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:.65rem 1.2rem;font-size:.88rem;font-weight:500;color:var(--text);box-shadow:var(--shadow);z-index:9999;transition:transform .3s ease,opacity .3s ease;white-space:nowrap;display:flex;align-items:center;gap:.5rem;max-width:90%}' +
    '.toast.show{transform:translateX(-50%) translateY(0)}' +
    /* DRAWER */
    '.osce-drawer-overlay{position:fixed;inset:0;z-index:500;pointer-events:none}' +
    '.osce-drawer-overlay.open{pointer-events:all}' +
    '.osce-drawer-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.52);opacity:0;transition:opacity .25s ease}' +
    '.osce-drawer-overlay.open .osce-drawer-backdrop{opacity:1}' +
    '.osce-drawer-panel{position:absolute;top:0;left:0;bottom:0;width:280px;background:var(--surface2);border-right:1px solid var(--border);display:flex;flex-direction:column;gap:.6rem;padding:.8rem;overflow-y:auto;transform:translateX(-100%);transition:transform .28s var(--ease-out)}' +
    '.osce-drawer-overlay.open .osce-drawer-panel{transform:translateX(0)}' +
    '.osce-drawer-panel::-webkit-scrollbar{width:4px}.osce-drawer-panel::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}' +
    /* MOBILE */
    '@media(max-width:768px){' +
      '.osce-body{grid-template-columns:1fr}.osce-sidebar,.osce-sidebar-handle{display:none}' +
      '.osce-lobby-hero{grid-template-columns:1fr;text-align:center}' +
      '.osce-lobby-av{margin:0 auto}.osce-pt-chips{justify-content:center}' +
      '.osce-lobby-stats{grid-template-columns:repeat(2,1fr)}' +
      '.osce-lobby-flow{grid-template-columns:repeat(3,1fr)}' +
      '.osce-lobby-actions{justify-content:center}' +
      '.osce-msg{max-width:91%}' +
      '.osce-criteria-grid{grid-template-columns:1fr}' +
      '.score-banner{flex-direction:column;align-items:flex-start;gap:1rem}' +
      '.osce-radar-wrap{flex-direction:column;align-items:center}' +
      '.osce-hdr-title .t{display:none}' +
    '}' +
    '@media(max-width:480px){' +
      '.osce-lobby-stats{grid-template-columns:1fr 1fr}' +
      '.osce-lobby-flow{grid-template-columns:repeat(2,1fr)}' +
      '.osce-domain-grid{grid-template-columns:1fr}' +
      '.result-actions{flex-direction:column}' +
    '}';
  }

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _esc(s) { return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function _md(text) {
    if (!text) return '';
    var h = String(text).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    h = h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\n/g,'<br>');
    return h;
  }
  function showToast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () { t.classList.remove('show'); }, 2200);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }
  function _addRipple(btn) {
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      var rect = btn.getBoundingClientRect();
      var size = Math.max(rect.width, rect.height);
      var x = e.clientX - rect.left - size/2, y = e.clientY - rect.top - size/2;
      var w = document.createElement('span'); w.className = 'osce-ripple';
      w.style.cssText = 'width:'+size+'px;height:'+size+'px;left:'+x+'px;top:'+y+'px';
      btn.appendChild(w); setTimeout(function () { if (w.parentNode) w.parentNode.removeChild(w); }, 600);
    });
  }

  /* ── State ─────────────────────────────────────────────────────── */
  var _data = null, _activeCase = null, _activeCaseIdx = -1;
  var _transcript = [], _abort = null, _lastFailedText = '';
  var _timerRemaining = EXAM_TIME, _timerInterval = null, _timerStarted = false;
  var _drawerOpen = false;

  /* ── Session ────────────────────────────────────────────────────── */
  function _sessionKey()  { return STORAGE.session + (_data?_data.config.uid:'osce'); }
  function _saveSession() {
    if (!_activeCase||!_transcript.length) return;
    try { localStorage.setItem(_sessionKey(), JSON.stringify({transcript:_transcript,timerRemaining:_timerRemaining,timerStarted:_timerStarted})); } catch (_) {}
  }
  function _loadSession() { try { var r=localStorage.getItem(_sessionKey()); return r?JSON.parse(r):null; } catch (_) { return null; } }
  function _clearSession(){ try { localStorage.removeItem(_sessionKey()); } catch (_) {} }

  /* ── Timer ──────────────────────────────────────────────────────── */
  function _startTimer() {
    if (_timerStarted) return; _timerStarted = true;
    _timerInterval = setInterval(function () {
      _timerRemaining = Math.max(0, _timerRemaining - 1);
      _updateTimerUI(); if (_timerRemaining <= 0) _onTimeUp();
    }, 1000);
  }
  function _stopTimer() { if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; } }
  function _formatTime(s) { var m=Math.floor(s/60), sc=s%60; return m+':'+(sc<10?'0':'')+sc; }
  function _timerState(s) { return s>120?'ok':s>30?'warn':'danger'; }
  function _stationDuration() { return (_activeCase&&_activeCase.time)||EXAM_TIME; }
  function _updateTimerUI() {
    var el = document.getElementById('osce-timer-num');
    if (el) { el.textContent = _formatTime(_timerRemaining); el.className = 'osce-timer '+_timerState(_timerRemaining); }
    var f = document.getElementById('osce-tbar-fill');
    if (f) { var pct = (_timerRemaining/_stationDuration())*100; f.style.width = pct+'%'; f.className = 'osce-tbar-fill '+_timerState(_timerRemaining); }
    _updateStationStats();
  }
  function _onTimeUp() {
    _stopTimer(); _Voice.stopSpeaking(); _Voice.disable(); showToast('⏱ Time is up! Submit for examiner feedback.');
    var bar = document.getElementById('osce-timeup'); if (bar) bar.className = 'osce-timeup show';
  }

  /* ── Gamified progress ──────────────────────────────────────────── */
  function _userTurnCount() { var c=0; for(var i=0;i<_transcript.length;i++) if(_transcript[i].role==='user') c++; return c; }
  function _gamifiedProgress() {
    var turns = _userTurnCount();
    var turnPct = Math.min(100, Math.round((turns/Math.max(1,WARN_TURNS))*100));
    var timePct = Math.min(100, Math.round(((_stationDuration()-_timerRemaining)/_stationDuration())*100));
    return { turns:turns, turnPct:turnPct, timePct:timePct, momentum:Math.min(100,Math.round(turnPct*.7+Math.min(timePct,90)*.3)) };
  }
  function _updateStationStats() {
    var p = _gamifiedProgress();
    var qc = document.getElementById('osce-q-count'); if (qc) qc.textContent = p.turns+' / '+MAX_TURNS;
    var xf = document.getElementById('osce-xp-fill'); if (xf) xf.style.width = p.momentum+'%';
    var tu = document.getElementById('osce-time-used'); if (tu) tu.textContent = p.timePct+'%';
    var tb = document.getElementById('osce-turn-badge');
    if (tb) { tb.textContent = 'Q '+p.turns+'/'+MAX_TURNS; tb.className = 'osce-turn-badge'+(p.turns>=WARN_TURNS?' danger':p.turns>=Math.floor(WARN_TURNS*.7)?' warn':''); }
    _updateMap();
  }

  /* ── Consultation map ───────────────────────────────────────────── */
  function _mapStep() {
    var t = _userTurnCount();
    if (t<2) return 0; if (t<7) return 1; if (t<12) return 2; if (t<17) return 3; return 4;
  }
  var _MAP_STEPS = [['Opening','Intro & consent'],['History','Chief complaint'],['Background','PMH, meds, social'],['ICE','Concerns & expectations'],['Closing','Summarise & safety']];
  function _mapHTML() {
    var active = _mapStep();
    return _MAP_STEPS.map(function (s, i) {
      var cls = i<active?'done':i===active?'active':'';
      return '<div class="osce-map-step '+cls+'"><span>'+s[0]+' — <em style="font-weight:400">'+s[1]+'</em></span></div>';
    }).join('');
  }
  function _updateMap() { var el=document.getElementById('osce-map-steps'); if(el) el.innerHTML=_mapHTML(); }

  /* ── Voice Engine (Gemini Live only) ─────────────────────────────── */
  var _Voice = (function () {
    var ttsSupported = 'speechSynthesis' in window;
    var phase = 'idle'; // idle | listening | speaking
    var voiceOn = false;
    var _ttsVoices = [];
    var liveSession = null; // Gemini Live WebSocket
    var liveAudioCtx = null;
    var liveMicStream = null;
    var liveMicProcessor = null;
    var livePlayCtx = null;
    var _livePlayScheduleTime = 0;
    var _liveInterimText = '';
    var _liveModelAccumText = '';

    function _loadVoices() {
      if (!ttsSupported) return;
      _ttsVoices = window.speechSynthesis.getVoices();
      if (!_ttsVoices.length) window.speechSynthesis.onvoiceschanged = function () { _ttsVoices = window.speechSynthesis.getVoices(); };
    }

    function _updateUI() {
      var micBtn = document.getElementById('osce-mic-btn');
      var vsEl   = document.getElementById('osce-vstatus');
      var wavEl  = document.getElementById('osce-waveform');
      if (!micBtn) return;
      micBtn.className = 'osce-mic-btn' + (phase==='speaking'?' speaking':voiceOn?' active':'');
      micBtn.title = phase==='speaking'?'Patient speaking':voiceOn?'Mic active — speak now':'Toggle voice mode';
      if (vsEl) {
        vsEl.className = 'osce-voice-status' + (phase==='speaking'?' speaking':voiceOn?' listening':'');
        var dot = vsEl.querySelector('.osce-vstatus-dot');
        var txt = vsEl.querySelector('.osce-vstatus-txt');
        if (txt) txt.textContent = phase==='speaking'?'Patient speaking…':voiceOn?'Listening — your turn':'Voice off';
      }
      if (wavEl) { wavEl.className = 'osce-waveform'+(voiceOn&&phase!=='speaking'?' active':''); }
    }

    function _setPhase(p) { phase = p; _updateUI(); }

    function _finalizeModelText(text) {
      if (!text) return;
      // Dedup against last model entry
      var last = _transcript.length && _transcript[_transcript.length - 1];
      if (last && last.role === 'model' && last.text === text) return;
      console.log('[GeminiLive] MODEL:', text.slice(0, 120));
      _transcript.push({ role: 'model', text: _sanitizeModelText(text) });
      _liveModelAccumText = '';
      _renderTranscript(); _updateStationStats(); _saveSession();
    }

    function _updateInterimDisplay() {
      var box = document.getElementById('osce-transcript');
      if (!box) return;
      var p = _activeCase && _activeCase.patient;
      var userName = p ? _esc(p.name) : 'Patient';

      // User interim
      var uel = document.getElementById('osce-interim-user');
      if (_liveInterimText) {
        if (!uel) {
          uel = document.createElement('div'); uel.id = 'osce-interim-user';
          uel.className = 'osce-msg student interim';
          uel.innerHTML = '<div class="osce-msg-lbl">🎤 You</div><div class="osce-bubble osce-interim"><span class="osce-interim-text"></span><span class="osce-interim-cursor">▊</span></div>';
          box.appendChild(uel);
        }
        uel.querySelector('.osce-interim-text').textContent = _liveInterimText;
      } else if (uel) { uel.remove(); }

      box.scrollTop = box.scrollHeight;
    }

    function _getGenderVoice() {
      var sp = _getSpeaker(_activeCase);
      return sp.gender === 'female' ? 'Aoede' : 'Charon';
    }

    function speak(text) {
      if (!ttsSupported || !voiceOn) return;
      window.speechSynthesis.cancel();
      var utt = new SpeechSynthesisUtterance(text);
      var savedVoice = localStorage.getItem(STORAGE.ttsVoice);
      if (savedVoice) {
        var v = _ttsVoices.find(function (v) { return v.name === savedVoice; });
        if (v) utt.voice = v;
      } else {
        var preferred = _ttsVoices.find(function (v) { return /en.gb/i.test(v.lang) || /english/i.test(v.name) || /daniel|samantha|karen|moira/i.test(v.name); });
        if (preferred) utt.voice = preferred;
      }
      utt.rate = parseFloat(localStorage.getItem(STORAGE.ttsRate) || '0.95');
      utt.pitch = 1;
      _setPhase('speaking');
      utt.onend = function () { _setPhase('idle'); };
      utt.onerror = function () { _setPhase('idle'); };
      window.speechSynthesis.speak(utt);
    }

    function stopSpeaking() {
      if (ttsSupported) window.speechSynthesis.cancel();
      if (livePlayCtx) { try { livePlayCtx.close(); } catch (_) {} livePlayCtx = null; }
      _livePlayScheduleTime = 0;
      _setPhase('idle');
    }

    /* Gemini Live WebSocket implementation */
    function _startGeminiLive() {
      console.log('[GeminiLive] _startGeminiLive called');
      if (liveSession) { console.log('[GeminiLive] already has session, stopping'); _stopGeminiLive(); return; }
      if (!_hasApiKey()) { console.log('[GeminiLive] no API key'); showToast('API key required for Gemini Live mode.'); return; }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { console.log('[GeminiLive] no getUserMedia'); showToast('Microphone not accessible.'); return; }

      _setPhase('listening');
      var modelName = _getSavedLiveModel();
      var apiKey = _readKey();
      console.log('[GeminiLive] model:', modelName, 'apiKey length:', apiKey ? apiKey.length : 0);
      var wsUrl = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' + apiKey;
      console.log('[GeminiLive] connecting to WebSocket...');
      liveSession = new WebSocket(wsUrl);

      liveSession.onopen = function () {
        console.log('[GeminiLive] WebSocket OPENED successfully');
        var setup = {
          setup: {
            model: 'models/' + modelName,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: _getGenderVoice() } } },
              temperature: 1.0
            },
            systemInstruction: { parts: [{ text: _activeCase && _activeCase.type === 'data-interp' ? buildDataInterpSysPrompt(_activeCase) : buildPatientSysPrompt(_activeCase) }] }
          }
        };
        console.log('[GeminiLive] sending setup message:', JSON.stringify(setup).slice(0, 500));
        liveSession.send(JSON.stringify(setup));
        // Wait for setupComplete before sending any other messages
      };

      liveSession.onmessage = function (e) {
        var raw = e.data;
        if (raw instanceof Blob) {
          var reader = new FileReader();
          reader.onload = function () { _handleLiveMessage(reader.result); };
          reader.readAsText(raw);
          return;
        }
        if (raw instanceof ArrayBuffer) {
          _handleLiveMessage(new TextDecoder().decode(raw));
          return;
        }
        _handleLiveMessage(raw);
      };

      function _handleLiveMessage(jsonStr) {
        try {
          var data = JSON.parse(jsonStr);
          if (data.setupComplete) {
            console.log('[GeminiLive] SETUP COMPLETE');
            // Send conversation history if any must start with a 'user' role
            if (_transcript.length) {
              // Find the first 'model' turn and split there — history must start with user
              var firstUserIdx = -1;
              for (var ti = 0; ti < _transcript.length; ti++) { if (_transcript[ti].role !== 'model') { firstUserIdx = ti; break; } }
              if (firstUserIdx >= 0) {
                var histTurns = _transcript.slice(firstUserIdx).map(function (m) { return { role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.text }] }; });
                console.log('[GeminiLive] sending conversation history (from idx', firstUserIdx, '), entries:', histTurns.length);
                liveSession.send(JSON.stringify({ clientContent: { turns: histTurns, turnComplete: false } }));
              } else {
                console.log('[GeminiLive] all transcript entries are model role, skipping history');
              }
            }
            // Small delay before starting mic
            console.log('[GeminiLive] starting live mic...');
            setTimeout(function () { _startLiveMic(); }, 300);
            return;
          }
          if (data.error) { console.error('[GeminiLive] SERVER ERROR:', JSON.stringify(data.error)); return; }
          var sc = data.serverContent;
          if (!sc) { return; }

          // Capture input transcription (user speech)
          if (sc.inputTranscription && sc.inputTranscription.text) {
            var userText = sc.inputTranscription.text.trim();
            if (phase !== 'listening') _setPhase('listening');
            if (!userText) { _liveInterimText = ''; _updateInterimDisplay(); }
            else if (sc.inputTranscription.finished) {
              // Dedup against last user entry
              var last = _transcript.length && _transcript[_transcript.length - 1];
              if (!(last && last.role === 'user' && last.text === userText)) {
                console.log('[GeminiLive] USER SAID:', userText);
                _transcript.push({ role: 'user', text: userText });
              }
              _liveInterimText = '';
              _renderTranscript();
            } else {
              _liveInterimText = userText;
              _updateInterimDisplay();
            }
          }

          // Capture output transcription (model speech)
          if (sc.outputTranscription && sc.outputTranscription.text) {
            var modelText = sc.outputTranscription.text.trim();
            if (modelText && sc.outputTranscription.finished) {
              _finalizeModelText(modelText);
            } else if (modelText) {
              if (phase !== 'speaking') _setPhase('speaking');
              // API may send full accumulated text OR incremental diffs — handle both
              if (modelText.length > _liveModelAccumText.length && modelText.startsWith(_liveModelAccumText)) {
                _liveModelAccumText = modelText; // full accumulated, replace
              } else {
                _liveModelAccumText += (_liveModelAccumText ? ' ' : '') + modelText; // diff, append
              }
            }
          }

          // Fallback: modelTurn without outputTranscription — finalize user speech
          if (sc.modelTurn && sc.modelTurn.parts && sc.modelTurn.parts.length) {
            if (phase !== 'speaking') _setPhase('speaking');
            if (_liveInterimText) {
              var last = _transcript.length && _transcript[_transcript.length - 1];
              if (!(last && last.role === 'user' && last.text === _liveInterimText)) {
                _transcript.push({ role: 'user', text: _liveInterimText });
              }
              _liveInterimText = '';
              // Don't re-render here — modelTurn audio/text will trigger it
            }
            sc.modelTurn.parts.forEach(function (part) {
              if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.indexOf('audio') !== -1) {
                _playLiveAudio(part.inlineData.data, part.inlineData.mimeType);
              }
            });
          }

          // Handle interruption
          if (sc.interrupted) {
            console.log('[GeminiLive] INTERRUPTED');
            if (livePlayCtx) { try { livePlayCtx.close(); } catch (_) {} livePlayCtx = null; }
            _livePlayScheduleTime = 0;
            _liveModelAccumText = '';
            if (phase !== 'listening') _setPhase('listening');
          }

          // Handle turn completion — finalize model text if still pending
          if (sc.turnComplete) {
            console.log('[GeminiLive] TURN COMPLETE — finalizing model text');
            if (_liveModelAccumText) {
              _finalizeModelText(_liveModelAccumText);
            }
            _setPhase('idle');
          }
        } catch (e) { console.error('[GeminiLive] onmessage parse error:', e, 'data:', jsonStr.slice(0, 200)); }
      }

      liveSession.onerror = function (evt) { console.error('[GeminiLive] WEBSOCKET ERROR event:', evt.type); _stopGeminiLive(); showToast('Gemini Live connection failed. Falling back to text mode.'); };
      liveSession.onclose = function (evt) {
        console.log('[GeminiLive] WebSocket CLOSED code:', evt.code, 'reason:', evt.reason, 'wasClean:', evt.wasClean);
        liveSession = null;
        if (phase === 'listening') _setPhase('idle');
        _stopLiveMic();
      };
    }

    function _stopGeminiLive() {
      _stopLiveMic();
      _livePlayScheduleTime = 0;
      _liveInterimText = '';
      _liveModelAccumText = '';
      if (liveSession) { try { liveSession.close(); } catch (_) {} liveSession = null; }
      if (livePlayCtx) { try { livePlayCtx.close(); } catch (_) {} livePlayCtx = null; }
      if (liveAudioCtx) { try { liveAudioCtx.close(); } catch (_) {} liveAudioCtx = null; }
      _setPhase('idle');
    }

    function _startLiveMic() {
      console.log('[GeminiLive] _startLiveMic: requesting microphone...');
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        console.log('[GeminiLive] microphone ACCESS GRANTED');
        liveMicStream = stream;
        liveAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        console.log('[GeminiLive] AudioContext created, sampleRate:', liveAudioCtx.sampleRate, 'state:', liveAudioCtx.state);
        var source = liveAudioCtx.createMediaStreamSource(stream);
        var processorCode = 'class MicProcessor extends AudioWorkletProcessor{process(inputs){this.port.postMessage(inputs[0][0]);return true;}}registerProcessor("mic-processor",MicProcessor);';
        var blob = new Blob([processorCode], { type: 'application/javascript' });
        var url = URL.createObjectURL(blob);
        liveAudioCtx.audioWorklet.addModule(url).then(function () {
          console.log('[GeminiLive] AudioWorklet MODULE LOADED');
          var node = new AudioWorkletNode(liveAudioCtx, 'mic-processor');
          node.port.onmessage = function (e) {
            if (!liveSession || liveSession.readyState !== WebSocket.OPEN) { return; }
            var input = e.data;
            var pcm = new Int16Array(input.length);
            for (var i = 0; i < input.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
            var bytes = new Uint8Array(pcm.buffer);
            var b64 = btoa(String.fromCharCode.apply(null, bytes));
            var msg = JSON.stringify({ realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm' } } });
            liveSession.send(msg);
          };
          source.connect(node);
          liveMicProcessor = node;
          URL.revokeObjectURL(url);
          console.log('[GeminiLive] AudioWorklet mic started');
        }).catch(function (err) {
          console.log('[GeminiLive] AudioWorklet failed, falling back:', err.message);
          _startLiveMicFallback(stream);
        });
      }).catch(function (err) { console.error('[GeminiLive] getUserMedia DENIED:', err.message); _stopGeminiLive(); showToast('Microphone access denied: ' + err.message); });
    }

    function _startLiveMicFallback(stream) {
      console.log('[GeminiLive] _startLiveMicFallback (ScriptProcessorNode)');
      try {
        liveMicProcessor = liveAudioCtx.createScriptProcessor(4096, 1, 1);
        liveMicProcessor.onaudioprocess = function (e) {
          if (!liveSession || liveSession.readyState !== WebSocket.OPEN) return;
          var input = e.inputBuffer.getChannelData(0);
          var pcm = new Int16Array(input.length);
          for (var i = 0; i < input.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
          var bytes = new Uint8Array(pcm.buffer);
          var b64 = btoa(String.fromCharCode.apply(null, bytes));
          liveSession.send(JSON.stringify({ realtimeInput: { audio: { data: b64, mimeType: 'audio/pcm' } } }));
        };
        var source = liveAudioCtx.createMediaStreamSource(stream);
        source.connect(liveMicProcessor);
        console.log('[GeminiLive] ScriptProcessorNode mic started (fallback)');
      } catch (e) { console.error('[GeminiLive] Fallback mic init failed:', e.message); _stopGeminiLive(); showToast('Microphone init failed: ' + e.message); }
    }

    function _stopLiveMic() {
      if (liveMicProcessor) { try { liveMicProcessor.disconnect(); } catch (_) {} liveMicProcessor = null; }
      if (liveMicStream) { liveMicStream.getTracks().forEach(function (t) { t.stop(); }); liveMicStream = null; }
    }

    function _playLiveAudio(b64data, mimeType) {
      try {
        var sampleRate = 24000;
        var match = mimeType && mimeType.match(/rate=(\d+)/);
        if (match) sampleRate = parseInt(match[1], 10);
        console.log('[GeminiLive] _playLiveAudio mimeType:', mimeType, 'sampleRate:', sampleRate, 'b64 length:', b64data.length);
        if (!livePlayCtx) {
          livePlayCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: sampleRate });
          _livePlayScheduleTime = 0;
          console.log('[GeminiLive] livePlayCtx created, state:', livePlayCtx.state);
        }
        if (livePlayCtx.state === 'suspended') { livePlayCtx.resume(); }
        var raw = atob(b64data);
        var bytes = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        var int16 = new Int16Array(bytes.buffer);
        var float32 = new Float32Array(int16.length);
        for (var j = 0; j < int16.length; j++) float32[j] = int16[j] / 32768;
        var buf = livePlayCtx.createBuffer(1, float32.length, sampleRate);
        buf.getChannelData(0).set(float32);
        var when = _livePlayScheduleTime > livePlayCtx.currentTime ? _livePlayScheduleTime : livePlayCtx.currentTime + 0.01;
        var src = livePlayCtx.createBufferSource();
        src.buffer = buf; src.connect(livePlayCtx.destination); src.start(when);
        _livePlayScheduleTime = when + buf.duration;
        _setPhase('speaking');
        console.log('[GeminiLive] audio scheduled at', when.toFixed(3), 'duration', buf.duration.toFixed(3), 'samples:', float32.length);
      } catch (e) { console.error('[GeminiLive] _playLiveAudio error:', e); }
    }

    function sendLiveText(text) {
      if (liveSession && liveSession.readyState === WebSocket.OPEN) {
        liveSession.send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text: text }] }], turnComplete: true } }));
      }
    }

    function toggle() {
      voiceOn = !voiceOn;
      if (voiceOn && !_hasApiKey()) {
        voiceOn = false; _updateUI();
        showToast('Set a Gemini API key in ⚙ Settings first.');
        return;
      }
      localStorage.setItem(STORAGE.voiceOn, voiceOn);
      _updateUI();
      if (!voiceOn) { stopSpeaking(); _stopGeminiLive(); showToast('🔇 Voice off'); return; }
      _startGeminiLive();
    }

    function isOn() { return voiceOn; }
    function getInterimText() { return _liveInterimText; }
    function _getModelAccumText() { return _liveModelAccumText; }

    function init() {
      voiceOn = localStorage.getItem(STORAGE.voiceOn) === 'true';
      _loadVoices();
    }

    function getVoices() { return _ttsVoices; }
    function isTTSSupported() { return ttsSupported; }
    function disable() {
      voiceOn = false;
      localStorage.setItem(STORAGE.voiceOn, 'false');
      stopSpeaking();
      _stopGeminiLive();
      _updateUI();
    }

    return { init:init, toggle:toggle, stopSpeaking:stopSpeaking, speak:speak, isOn:isOn, getInterimText:getInterimText, updateInterimDisplay:_updateInterimDisplay, sendLiveText:sendLiveText, getVoices:getVoices, isTTSSupported:isTTSSupported, disable:disable };
  })();

  /* ── Boot / root / theme ────────────────────────────────────────── */
  function boot() {
    _data = readOsceData();
    _injectCSS();
    _ensureRoot(); _applyTheme();
    _activeCase = _data.case; _activeCaseIdx = 0;
    _timerRemaining = _data.case.time || EXAM_TIME;
    _Voice.init();
    if (_Voice.isOn()) { _Voice.toggle(); } /* start with voice off */
    var saved = _loadSession();
    if (saved && saved.transcript && saved.transcript.length) {
      _transcript = saved.transcript;
      _timerRemaining = saved.timerRemaining || _timerRemaining;
      _timerStarted = false;
      _openConversation();
      setTimeout(function () { showToast('📋 Session restored — continue your consultation.'); }, 500);
    } else {
      _showDoorCard();
    }
  }

  function _ensureRoot() {
    var root = document.getElementById('osce-root');
    if (!root) { root = document.createElement('div'); root.id = 'osce-root'; document.body.appendChild(root); }
    if (!root._osceImgClickInit) {
      root._osceImgClickInit = true;
      root.addEventListener('click', function (e) {
        var t = e.target;
        if (t.tagName === 'IMG' && t.classList.contains('osce-clickable-img')) {
          _openLightbox(t.src, t.alt || 'Clinical image');
        }
      });
    }
    return root;
  }
  function _applyTheme() { document.documentElement.setAttribute('data-theme', localStorage.getItem(STORAGE.theme)||'dark'); }
  function _toggleTheme() {
    var t = localStorage.getItem(STORAGE.theme)||'dark';
    t = t==='dark'?'light':'dark';
    localStorage.setItem(STORAGE.theme, t); _applyTheme();
    var el = document.getElementById('osce-theme-btn'); if (el) el.textContent = t==='dark'?'☀️':'🌙';
    var el2 = document.getElementById('osce-lobby-theme'); if (el2) el2.textContent = t==='dark'?'☀️':'🌙';
  }

  /* ── Difficulty chip class ────────────────────────────────────── */
  function _diffClass(d) { var l = (d||'').toLowerCase(); return l.indexOf('found')!==-1||l==='easy'?'df-e':l.indexOf('adv')!==-1||l==='hard'?'df-h':'df-m'; }

  /* ── Door Card (Lobby Screen) ─────────────────────────────────── */
  function _showDoorCard() {
    var p = _activeCase.patient;
    var av = renderAvatar(buildAvatarParams(p.gender, p.age, p.avatarSeed));
    var themeIcon = (localStorage.getItem(STORAGE.theme)||'dark')==='dark'?'☀️':'🌙';
    var dur = Math.floor(_stationDuration()/60);
    var isDataInterp = _activeCase.type === 'data-interp';
    var root = _ensureRoot();
    root.innerHTML =
      '<div class="osce-lobby">' +
        '<div class="osce-lobby-card">' +
          '<div class="osce-lobby-top">' +
            '<div class="osce-lobby-kicker">'+ (isDataInterp ? '🧑‍🏫 OSCE Data Interpretation' : '🩺 OSCE Virtual Patient') +'</div>' +
            '<div style="display:flex;gap:.4rem">' +
              '<button class="osce-icon-btn" id="osce-lobby-back" title="Back to Hub">←</button>' +
              '<button class="osce-icon-btn" id="osce-lobby-settings" title="AI Settings">⚙</button>' +
              '<button class="osce-icon-btn" id="osce-lobby-theme" title="Toggle theme">'+themeIcon+'</button>' +
            '</div>' +
          '</div>' +
          (isDataInterp
            ? '<div class="osce-lobby-hero" style="grid-template-columns:1fr">' +
                '<div>' +
                  '<div class="osce-pt-name">🧑‍🏫 '+_esc((_activeCase.examiner||{}).name||'Examiner')+'</div>' +
                  '<div class="osce-pt-chips">' +
                    '<span class="osce-chip-meta sp">'+_esc(_activeCase.specialty)+'</span>' +
                    '<span class="osce-chip-meta '+_diffClass(_activeCase.difficulty)+'">'+_esc(_activeCase.difficulty)+'</span>' +
                  '</div>' +
                  '<div style="font-size:.88rem;color:var(--text-muted);line-height:1.4">'+_esc(_activeCase.title)+'</div>' +
                '</div>' +
              '</div>'
            : '<div class="osce-lobby-hero">' +
                '<div class="osce-lobby-av-wrap"><div class="osce-lobby-av">'+av+'</div></div>' +
                '<div>' +
                  '<div class="osce-pt-name">'+_esc(p.name)+'</div>' +
                  '<div class="osce-pt-chips">' +
                    '<span class="osce-chip-meta">'+p.age+' yrs</span>' +
                    '<span class="osce-chip-meta">'+_esc(p.gender)+'</span>' +
                    '<span class="osce-chip-meta sp">'+_esc(_activeCase.specialty)+'</span>' +
                    '<span class="osce-chip-meta '+_diffClass(_activeCase.difficulty)+'">'+_esc(_activeCase.difficulty)+'</span>' +
                  '</div>' +
                  '<div style="font-size:.88rem;color:var(--text-muted);line-height:1.4">'+_esc(_activeCase.title)+'</div>' +
                '</div>' +
              '</div>'
          ) +
          '<div class="osce-lobby-body">' +
            '<div class="osce-task-label">Your Task</div>' +
            '<div class="osce-task-box">'+_esc(_activeCase.task)+'</div>' +
            (isDataInterp && _activeCase.dataPresented && _activeCase.dataPresented.scenario
              ? '<div class="osce-task-label" style="margin-top:.6rem">Clinical Scenario</div>' +
                '<div class="osce-task-box">'+_esc(_activeCase.dataPresented.scenario)+'</div>'
              : ''
            ) +
            (isDataInterp ? _renderDataTables(_activeCase.dataPresented && _activeCase.dataPresented.tables, true) : '') +
            (isDataInterp ? _renderCaseImages(_activeCase.dataPresented && _activeCase.dataPresented.images, true) : '') +
            '<div class="osce-lobby-stats">' +
              '<div class="osce-stat-card"><div class="osce-stat-val">'+dur+'m</div><div class="osce-stat-lbl">Time</div></div>' +
              '<div class="osce-stat-card"><div class="osce-stat-val">'+MAX_TURNS+'</div><div class="osce-stat-lbl">Questions</div></div>' +
              '<div class="osce-stat-card"><div class="osce-stat-val">'+(isDataInterp?'3':'4')+'</div><div class="osce-stat-lbl">Domains</div></div>' +
              '<div class="osce-stat-card"><div class="osce-stat-val">AI</div><div class="osce-stat-lbl">Examiner</div></div>' +
            '</div>' +
            (isDataInterp
              ? '<div class="osce-lobby-flow" style="grid-template-columns:repeat(3,1fr)">' +
                  '<div class="osce-flow-pill"><span class="n">1</span><span class="t">Data</span><span class="s">Review & interpret</span></div>' +
                  '<div class="osce-flow-pill"><span class="n">2</span><span class="t">Questions</span><span class="s">Oral examination</span></div>' +
                  '<div class="osce-flow-pill"><span class="n">3</span><span class="t">Feedback</span><span class="s">Examiner scores</span></div>' +
                '</div>'
              : '<div class="osce-lobby-flow">' +
                  '<div class="osce-flow-pill"><span class="n">1</span><span class="t">Open</span><span class="s">Intro & ID</span></div>' +
                  '<div class="osce-flow-pill"><span class="n">2</span><span class="t">History</span><span class="s">Chief complaint</span></div>' +
                  '<div class="osce-flow-pill"><span class="n">3</span><span class="t">Background</span><span class="s">PMH & meds</span></div>' +
                  '<div class="osce-flow-pill"><span class="n">4</span><span class="t">ICE</span><span class="s">Concerns</span></div>' +
                  '<div class="osce-flow-pill"><span class="n">5</span><span class="t">Close</span><span class="s">Summarise</span></div>' +
                '</div>'
            ) +
          '</div>' +
          '<div class="osce-lobby-actions">' +
            '<button class="osce-primary-btn" id="osce-start-btn">'+(isDataInterp?'Begin Exam →':'Enter Room →')+'</button>' +
            '<button class="osce-secondary-btn" id="osce-lobby-settings2">AI Settings</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    _addRipple(document.getElementById('osce-start-btn'));
    document.getElementById('osce-start-btn').addEventListener('click', function () {
      _transcript = []; _renderedCount = 0; _timerRemaining = _activeCase.time||EXAM_TIME; _timerStarted = false; _openConversation();
    });
    var lb = document.getElementById('osce-lobby-back');
    if (lb) lb.addEventListener('click', function (e) { window.navigateToIndex(e); });
    document.getElementById('osce-lobby-theme').addEventListener('click', _toggleTheme);
    document.getElementById('osce-lobby-settings').addEventListener('click', _openSettings);
    document.getElementById('osce-lobby-settings2').addEventListener('click', _openSettings);
    _initCollapseToggles(root);
  }

  /* ── Data Tables Renderer (data-interp mode) ─────────────────── */
  function _renderDataTables(tables, collapsed) {
    if (!tables || !tables.length) return '';
    var content = tables.map(function (t) {
      var hdr = t.title ? '<div class="osce-data-title">'+_esc(t.title)+'</div>' : '';
      var thead = t.headers && t.headers.length ? '<thead><tr>'+t.headers.map(function(h){return '<th>'+_esc(h)+'</th>';}).join('')+'</tr></thead>' : '';
      var tbody = t.rows && t.rows.length ? '<tbody>'+t.rows.map(function(r){return '<tr>'+r.map(function(c){return '<td>'+_esc(c)+'</td>';}).join('')+'</tr>';}).join('')+'</tbody>' : '';
      return '<div class="osce-data-table-wrap"><div class="osce-sb-card">'+hdr+'<table class="osce-data-table">'+thead+tbody+'</table></div></div>';
    }).join('');
    if (collapsed) {
      return '<div class="osce-collapse-wrap">' +
        '<button class="osce-collapse-btn" data-collapse="osce-lobby-tables">📊 Lab Data <span class="chev">▼</span></button>' +
        '<div class="osce-collapse-content" id="osce-lobby-tables">'+content+'</div></div>';
    }
    return content;
  }

  /* ── Image Lightbox ──────────────────────────────────────────── */
  function _openLightbox(src, title) {
    var ov = document.createElement('div');
    ov.id = 'osce-lightbox';
    ov.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.88);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;padding:1rem';
    ov.innerHTML =
      '<div style="max-width:min(94vw,1200px);max-height:92vh;display:flex;flex-direction:column;gap:.5rem">' +
      (title ? '<div style="color:#e6edf3;font-size:.85rem;font-weight:700;text-align:center">'+_esc(title)+'</div>' : '') +
      '<img src="'+src+'" style="display:block;max-width:100%;max-height:80vh;border-radius:8px;object-fit:contain;background:#000">' +
      '<div style="color:#8b949e;font-size:.72rem;text-align:center">Click anywhere to close</div></div>';
    ov.addEventListener('click', function() { document.body.removeChild(ov); });
    document.body.appendChild(ov);
  }

  /* ── Case Images Renderer (data-interp mode) ────────────────── */
  function _renderCaseImages(images, collapsed) {
    if (!images || !images.length) return '';
    var content = images.map(function(im) {
      var title = im.title ? '<div class="osce-image-title">'+_esc(im.title)+'</div>' : '';
      var caption = im.caption ? '<div class="osce-image-caption">'+_esc(im.caption)+'</div>' : '';
      var alt = im.alt || im.caption || im.title || 'Clinical image';
      var src = im.src || im.url || im.data || '';
      if (!src) return '';
      return '<div class="osce-image-block">'+title+'<img src="'+src+'" alt="'+_esc(alt)+'" loading="lazy" class="osce-clickable-img">'+caption+'</div>';
    }).join('');
    if (!content) return '';
    if (collapsed) {
      return '<div class="osce-images-wrap">' +
        '<button class="osce-collapse-btn osce-img-toggle" data-collapse="osce-lobby-images">🖼️ Clinical Images ('+images.length+') <span class="chev">▼</span></button>' +
        '<div class="osce-collapse-content osce-images-content" id="osce-lobby-images">'+content+'</div></div>';
    }
    return '<div class="osce-images-wrap">'+content+'</div>';
  }

  /* ── Sidebar drag handle ──────────────────────────────────────── */
  function _initSidebarDrag() {
    var handle = document.getElementById('osce-sidebar-handle');
    var body = document.getElementById('osce-body');
    if (!handle || !body) return;
    var startX = 0, startW = 260;
    function onDown(e) {
      startX = e.clientX;
      var cur = body.style.getPropertyValue('--osce-sidebar-w');
      startW = cur ? parseInt(cur) : 260;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    }
    function onMove(e) {
      var w = Math.max(160, Math.min(520, startW + (e.clientX - startX)));
      body.style.setProperty('--osce-sidebar-w', w + 'px');
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      var cur = body.style.getPropertyValue('--osce-sidebar-w');
      if (cur) try { localStorage.setItem('osce_sidebar_w', parseInt(cur)); } catch (_) {}
    }
    handle.addEventListener('mousedown', onDown);
    var saved = localStorage.getItem('osce_sidebar_w');
    if (saved) body.style.setProperty('--osce-sidebar-w', Math.max(160, Math.min(520, parseInt(saved))) + 'px');
  }

  /* ── Collapse toggles ──────────────────────────────────────────── */
  function _initCollapseToggles(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll('.osce-collapse-btn'), function (btn) {
      btn.addEventListener('click', function () {
        this.classList.toggle('open');
        var id = this.getAttribute('data-collapse');
        if (id) {
          var target = document.getElementById(id);
          if (target) target.classList.toggle('open');
        }
      });
    });
  }

  /* ── Conversation Screen ─────────────────────────────────────── */
  function _openConversation() {
    var p = _activeCase.patient;
    var av = renderAvatar(buildAvatarParams(p.gender, p.age, p.avatarSeed));
    var themeIcon = (localStorage.getItem(STORAGE.theme)||'dark')==='dark'?'☀️':'🌙';
    var dur = Math.floor(_stationDuration()/60);
    var prog = _gamifiedProgress();
    var voiceIcon = _Voice.isOn() ? '🎤' : '🎤';
    var root = _ensureRoot();

    root.innerHTML =
      '<div class="osce-room">' +
        /* HEADER */
        '<div class="osce-hdr">' +
          '<button class="osce-icon-btn" id="osce-back-btn" title="Back to door card" style="flex-shrink:0">←</button>' +
          '<button class="osce-icon-btn" id="osce-drawer-btn" title="'+( _activeCase.type==='data-interp'?'Case data':'Patient info')+'" style="display:none;flex-shrink:0">☰</button>' +
          '<div class="osce-hdr-title">' +
            '<div class="c">'+( _activeCase.type==='data-interp'?'🧑‍🏫 '+_esc((_activeCase.examiner||{}).name||'Examiner'):_esc(_activeCase.title))+'</div>' +
            '<div class="t">'+_esc(_activeCase.task)+'</div>' +
          '</div>' +
          '<div class="osce-hdr-right">' +
            '<div class="osce-timer-wrap">' +
              '<div class="osce-timer '+_timerState(_timerRemaining)+'" id="osce-timer-num">'+_formatTime(_timerRemaining)+'</div>' +
              '<div class="osce-timer-lbl">'+dur+' min</div>' +
            '</div>' +
            '<button class="osce-icon-btn" id="osce-theme-btn" title="Toggle theme">'+themeIcon+'</button>' +
            '<button class="osce-icon-btn" id="osce-settings-btn" title="AI Settings">⚙</button>' +
          '</div>' +
        '</div>' +
        /* TIMER BAR */
        '<div class="osce-tbar"><div class="osce-tbar-fill '+_timerState(_timerRemaining)+'" id="osce-tbar-fill" style="width:'+(_timerRemaining/_stationDuration()*100)+'%"></div></div>' +
        /* TIME UP */
        '<div class="osce-timeup" id="osce-timeup">⏱ Time expired — submit for examiner feedback</div>' +
        /* BODY: sidebar + chat */
        '<div class="osce-body" id="osce-body">' +
          /* SIDEBAR */
          '<aside class="osce-sidebar" id="osce-sidebar">' +
            (_activeCase.type === 'data-interp' ?
              /* ── DATA-INTERP SIDEBAR ── */
              '<div class="osce-sb-card">' +
                '<div class="osce-pt-id" style="grid-template-columns:1fr">' +
                  '<div><div class="osce-pt-nm">🧑‍🏫 '+_esc((_activeCase.examiner||{}).name||'Examiner')+'</div><div class="osce-pt-sb">'+_esc((_activeCase.examiner||{}).title||'Consultant')+'</div></div>' +
                '</div>' +
              '</div>' +
              '<div class="osce-sb-card">' +
                '<div class="osce-sb-lbl">Clinical Scenario</div>' +
                '<div class="osce-scenario-box">'+_esc((_activeCase.dataPresented||{}).scenario||'')+'</div>' +
              '</div>' +
              (_renderDataTables(_activeCase.dataPresented&&_activeCase.dataPresented.tables)||'') + (_renderCaseImages(_activeCase.dataPresented&&_activeCase.dataPresented.images)||'') +
              '<div class="osce-sb-card">' +
                '<div class="osce-sb-lbl">Station Run</div>' +
                '<div class="osce-pw-row"><span>Questions</span><strong id="osce-q-count">'+prog.turns+' / '+MAX_TURNS+'</strong></div>' +
                '<div class="osce-pw-row"><span>Time used</span><strong id="osce-time-used">'+prog.timePct+'%</strong></div>' +
                '<div class="osce-xp-track" title="Progress"><div class="osce-xp-fill" id="osce-xp-fill" style="width:'+prog.momentum+'%"></div></div>' +
              '</div>'
            :
              /* ── HISTORY SIDEBAR ── */
              '<div class="osce-sb-card">' +
                '<div class="osce-pt-id">' +
                  '<div class="osce-av-mini">'+av+'</div>' +
                  '<div><div class="osce-pt-nm">'+_esc(p.name)+'</div><div class="osce-pt-sb">'+p.age+' yrs • '+_esc(p.gender)+'<br>'+_esc(_activeCase.specialty)+' • '+_esc(_activeCase.difficulty)+'</div></div>' +
                '</div>' +
              '</div>' +
              '<div class="osce-sb-card">' +
                '<div class="osce-sb-lbl">Candidate Instructions</div>' +
                '<div class="osce-instr-box"><div class="osce-instr-txt">'+_esc(_activeCase.task)+'</div></div>' +
              '</div>' +
              '<div class="osce-sb-card">' +
                '<div class="osce-sb-lbl">Station Run</div>' +
                '<div class="osce-pw-row"><span>Questions</span><strong id="osce-q-count">'+prog.turns+' / '+MAX_TURNS+'</strong></div>' +
                '<div class="osce-pw-row"><span>Time used</span><strong id="osce-time-used">'+prog.timePct+'%</strong></div>' +
                '<div class="osce-xp-track" title="Consultation momentum"><div class="osce-xp-fill" id="osce-xp-fill" style="width:'+prog.momentum+'%"></div></div>' +
              '</div>' +
              '<div class="osce-sb-card">' +
                '<div class="osce-sb-lbl">Consultation Map</div>' +
                '<div class="osce-map-steps" id="osce-map-steps">'+_mapHTML()+'</div>' +
              '</div>' +
              '<div class="osce-sb-card">' +
                '<div class="osce-sb-lbl" style="margin-bottom:.4rem">Quick Prompts</div>' +
                '<div class="osce-chips-wrap">' +
                  '<button class="osce-qchip" data-p="Can you tell me more about what brought you in today?">Open</button>' +
                  '<button class="osce-qchip" data-p="When did this start, and what were you doing at the time?">Timing</button>' +
                  '<button class="osce-qchip" data-p="On a scale of 1-10, how bad is it?">Severity</button>' +
                  '<button class="osce-qchip" data-p="Does anything make it better or worse?">Triggers</button>' +
                  '<button class="osce-qchip" data-p="Do you have any medical conditions or take any regular medicines?">PMH/Meds</button>' +
                  '<button class="osce-qchip" data-p="Is there anything you are particularly worried this might be?">ICE</button>' +
                  '<button class="osce-qchip" data-p="Does this run in your family?">Family Hx</button>' +
                '</div>' +
              '</div>'
            ) +
          '</aside>' +
          /* DRAG HANDLE */
          '<div class="osce-sidebar-handle" id="osce-sidebar-handle"></div>' +
          /* CHAT */
          '<main class="osce-chat-zone">' +
            '<div class="osce-transcript" id="osce-transcript"></div>' +
            '<div class="osce-error-bar" id="osce-error-bar"></div>' +
          '</main>' +
        '</div>' +
        /* INPUT */
        '<div class="osce-input-area">' +
          '<div class="osce-voice-bar">' +
            '<div class="osce-voice-status" id="osce-vstatus">' +
              '<span class="osce-vstatus-dot"></span>' +
              '<span class="osce-vstatus-txt">'+(_Voice.isOn()?'Voice mode on — tap mic':'Voice mode off')+'</span>' +
            '</div>' +
            '<div class="osce-waveform" id="osce-waveform"><div class="osce-wbar"></div><div class="osce-wbar"></div><div class="osce-wbar"></div><div class="osce-wbar"></div><div class="osce-wbar"></div></div>' +
          '</div>' +
          '<div class="osce-input-row">' +
            '<button class="osce-mic-btn" id="osce-mic-btn" title="Toggle voice mode">🎤</button>' +
            '<textarea class="osce-textarea" id="osce-input" placeholder="Ask the patient a question…" rows="1"></textarea>' +
            '<button class="osce-send-btn" id="osce-send-btn">Send →</button>' +
          '</div>' +
          '<div class="osce-submit-row">' +
            '<span class="osce-turn-badge" id="osce-turn-badge">Q 0/'+MAX_TURNS+'</span>' +
            '<button class="osce-submit-btn" id="osce-submit-btn">Submit for Examiner Feedback ✓</button>' +
            '<button class="osce-reset-btn" id="osce-reset-btn">↺ Reset</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    /* MOBILE: show drawer button, hide sidebar */
    if (window.innerWidth <= 768) {
      var drawerBtn = document.getElementById('osce-drawer-btn');
      if (drawerBtn) drawerBtn.style.display = 'flex';
      drawerBtn && drawerBtn.addEventListener('click', _openDrawer);
    }

    /* Event listeners */
    document.getElementById('osce-back-btn').addEventListener('click', function (e) {
      _stopTimer(); _cancelPending(); _Voice.stopSpeaking(); _Voice.disable();
      window.navigateToIndex(e);
    });
    document.getElementById('osce-theme-btn').addEventListener('click', _toggleTheme);
    document.getElementById('osce-settings-btn').addEventListener('click', _openSettings);
    document.getElementById('osce-mic-btn').addEventListener('click', function () { _Voice.toggle(); });

    _addRipple(document.getElementById('osce-send-btn'));
    _addRipple(document.getElementById('osce-submit-btn'));
    document.getElementById('osce-send-btn').addEventListener('click', _onSend);
    document.getElementById('osce-submit-btn').addEventListener('click', _onSubmit);
    document.getElementById('osce-reset-btn').addEventListener('click', _openResetModal);

    Array.prototype.forEach.call(document.querySelectorAll('.osce-qchip'), function (btn) {
      btn.addEventListener('click', function () { _insertPrompt(btn.getAttribute('data-p')||''); });
    });

    var input = document.getElementById('osce-input');
    input.addEventListener('keydown', function (e) { if (e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); _onSend(); } });
    input.addEventListener('input', function () { this.style.height='auto'; this.style.height=Math.min(120,this.scrollHeight)+'px'; });

    document.addEventListener('keydown', _onKeyDown);

    /* Sidebar drag */
    _initSidebarDrag();

    /* Init transcript — no auto-opening for history (student introduces themselves) */
    if (_activeCase.type === 'data-interp' && !_transcript.length) {
      /* Seed examiner first turn */
      _abort = new AbortController();
      _showThinking(true);
      var seedMsg = 'Please introduce yourself, present the case and data, and ask me the first question.';
      askExaminer(_activeCase, [{role:'user', text:seedMsg}], _abort.signal)
        .then(function (reply) {
          _transcript.push({role:'model', text:_sanitizeModelText(reply)});
          _showThinking(false);
          _renderTranscript(); _updateStationStats(); _saveSession();
          _startTimer();
        })
        .catch(function (err) {
          _showThinking(false);
          _setError('Failed to start examination: '+_friendlyAiError(err));
          _startTimer();
        });
    } else {
      if (!_transcript.length) {
        /* history mode — student must introduce themselves first */
      }
      _renderTranscript(); _updateStationStats();
      _startTimer(); _saveSession();
    }
  }

  /* ── Sidebar drawer (mobile) ─────────────────────────────────── */
  function _openDrawer() {
    if (_drawerOpen) return; _drawerOpen = true;
    var p = _activeCase.patient;
    var av = renderAvatar(buildAvatarParams(p.gender, p.age, p.avatarSeed));
    var prog = _gamifiedProgress();
    var isDataInterp = _activeCase && _activeCase.type === 'data-interp';
    var overlay = document.createElement('div'); overlay.className = 'osce-drawer-overlay'; overlay.id = 'osce-drawer';
    overlay.innerHTML =
      '<div class="osce-drawer-backdrop" id="osce-drawer-backdrop"></div>' +
      '<div class="osce-drawer-panel">' +
        '<div style="display:flex;justify-content:flex-end;margin-bottom:.2rem"><button class="osce-icon-btn" id="osce-drawer-close">✕</button></div>' +
        (isDataInterp
          ? '<div class="osce-sb-card"><div class="osce-pt-id" style="grid-template-columns:1fr"><div><div class="osce-pt-nm">🧑‍🏫 '+_esc((_activeCase.examiner||{}).name||'Examiner')+'</div><div class="osce-pt-sb">'+_esc((_activeCase.examiner||{}).title||'Consultant')+'</div></div></div></div>' +
            '<div class="osce-sb-card"><div class="osce-sb-lbl">Instructions</div><div class="osce-instr-box"><div class="osce-instr-txt">'+_esc(_activeCase.task)+'</div></div></div>' +
            (_renderDataTables(_activeCase.dataPresented&&_activeCase.dataPresented.tables)||'') + (_renderCaseImages(_activeCase.dataPresented&&_activeCase.dataPresented.images)||'')
          : '<div class="osce-sb-card"><div class="osce-pt-id"><div class="osce-av-mini">'+av+'</div><div><div class="osce-pt-nm">'+_esc(p.name)+'</div><div class="osce-pt-sb">'+p.age+' yrs • '+_esc(p.gender)+'</div></div></div></div>' +
            '<div class="osce-sb-card"><div class="osce-sb-lbl">Instructions</div><div class="osce-instr-box"><div class="osce-instr-txt">'+_esc(_activeCase.task)+'</div></div></div>' +
            '<div class="osce-sb-card"><div class="osce-sb-lbl">Consultation Map</div><div class="osce-map-steps">'+_mapHTML()+'</div></div>' +
            '<div class="osce-sb-card"><div class="osce-sb-lbl">Quick Prompts</div><div class="osce-chips-wrap">'+
              '<button class="osce-qchip" data-p="Can you tell me more about what brought you in today?">Open</button>'+
              '<button class="osce-qchip" data-p="When did this start?">Timing</button>'+
              '<button class="osce-qchip" data-p="Does anything make it better or worse?">Triggers</button>'+
              '<button class="osce-qchip" data-p="Do you have any medical conditions or take any regular medicines?">PMH/Meds</button>'+
              '<button class="osce-qchip" data-p="Is there anything you are particularly worried this might be?">ICE</button>'+
            '</div></div>'
        ) +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('open'); });
    function closeDrawer() { overlay.classList.remove('open'); _drawerOpen = false; setTimeout(function () { if(overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 300); }
    document.getElementById('osce-drawer-close').addEventListener('click', closeDrawer);
    document.getElementById('osce-drawer-backdrop').addEventListener('click', closeDrawer);
    Array.prototype.forEach.call(overlay.querySelectorAll('.osce-qchip'), function (btn) {
      btn.addEventListener('click', function () { _insertPrompt(btn.getAttribute('data-p')||''); closeDrawer(); });
    });
  }

  /* ── Transcript rendering (incremental — append only) ──────────── */
  var _renderedCount = 0;
  function _renderTranscript() {
    var box = document.getElementById('osce-transcript'); if (!box) return;
    var sp = _getSpeaker(_activeCase);
    var isDataInterp = _activeCase && _activeCase.type === 'data-interp';
    var examinerLabel = isDataInterp ? _esc((_activeCase.examiner || {}).name || 'Examiner') : _esc(sp.name);
    var frag = document.createDocumentFragment();
    for (var i = _renderedCount; i < _transcript.length; i++) {
      var m = _transcript[i];
      var isModel = m.role === 'model';
      var div = document.createElement('div');
      div.className = 'osce-msg ' + (isModel ? 'patient' : 'student');
      if (isDataInterp) {
        div.innerHTML = '<div class="osce-msg-lbl">' + (isModel ? '🧑‍🏫 ' + examinerLabel : '🩺 You') + '</div><div class="osce-bubble">' + _md(m.text) + '</div>';
      } else {
        div.innerHTML = '<div class="osce-msg-lbl">' + (isModel ? '🧑‍⚕️ ' + examinerLabel : '🩺 You') + '</div><div class="osce-bubble">' + _md(m.text) + '</div>';
      }
      frag.appendChild(div);
    }
    if (frag.childNodes.length) {
      box.appendChild(frag);
      _renderedCount = _transcript.length;
    }
    box.scrollTop = box.scrollHeight;
    _Voice.updateInterimDisplay();
  }

  function _showThinking(show) {
    var box = document.getElementById('osce-transcript'); if (!box) return;
    var ex = document.getElementById('osce-thinking-el');
    if (show && !ex) {
      var isDataInterp = _activeCase && _activeCase.type === 'data-interp';
      var label = isDataInterp ? '🧑‍🏫 '+_esc((_activeCase.examiner||{}).name||'Examiner') : '🧑‍⚕️ '+_esc(_getSpeaker(_activeCase).name);
      var d = document.createElement('div'); d.id = 'osce-thinking-el'; d.className = 'osce-thinking';
      d.innerHTML = '<div class="osce-thinking-lbl">'+label+'</div><div class="osce-thinking-bub"><span class="osce-dots"><span></span><span></span><span></span></span><span class="osce-thinking-txt">'+(isDataInterp?'evaluating…':'typing…')+'</span></div>';
      box.appendChild(d); box.scrollTop = box.scrollHeight;
    } else if (!show && ex) { ex.remove(); }
  }

  function _setError(msg, showRetry) {
    var e = document.getElementById('osce-error-bar'); if (!e) return;
    if (msg) {
      e.className = 'osce-error-bar show';
      e.innerHTML = '⚠ '+_esc(msg)+(showRetry&&_lastFailedText?
        ' <button id="osce-retry-btn" style="margin-left:.5rem;padding:.14rem .48rem;border-radius:4px;border:1px solid var(--wrong);background:transparent;color:var(--wrong);cursor:pointer;font-size:.78rem">↻ Retry</button>':'');
      if (showRetry) { var btn=document.getElementById('osce-retry-btn'); if(btn) btn.addEventListener('click',_onRetry); }
    } else { e.className = 'osce-error-bar'; }
  }

  function _insertPrompt(text) {
    var input = document.getElementById('osce-input'); if (!input) return;
    input.value = text; input.focus(); input.style.height = 'auto'; input.style.height = Math.min(120,input.scrollHeight)+'px';
  }

  function _onRetry() { var input=document.getElementById('osce-input'); if(input&&_lastFailedText){input.value=_lastFailedText;input.focus();} }

  function _onKeyDown(e) {
    if (e.key === 'Escape') {
      var d=document.getElementById('osce-debrief'); if(d&&d.classList.contains('open')){_hideDebrief();e.preventDefault();return;}
      var s=document.getElementById('osce-sov'); if(s&&s.classList.contains('open')){s.className='';e.preventDefault();return;}
      var r=document.getElementById('osce-reset-overlay'); if(r&&r.classList.contains('open')){_closeResetModal();e.preventDefault();return;}
    }
  }

  /* ── Helpers ─────────────────────────────────────────────────────── */
  function _sanitizeModelText(text) {
    // Strip common medical disclaimer that some Gemini variants inject
    return text.replace(/This response is not intended to be medical advice[^.]*(?:consult|professional|treatment)[^.]*\./gi, '').trim();
  }

  /* ── Send / Submit ───────────────────────────────────────────── */
  function _onSend() {
    var input = document.getElementById('osce-input');
    var text = (input.value||'').trim(); if (!text) return;
    if (!_hasApiKey()) { showToast('Configure your Gemini API key in ⚙ Settings first'); _openSettings(); return; }
    var turns = _userTurnCount();
    if (turns >= MAX_TURNS) { showToast('Maximum '+MAX_TURNS+' questions reached. Click Submit for feedback.'); return; }
    if (turns >= WARN_TURNS) showToast('⚠ '+(MAX_TURNS-turns)+' questions remaining — consider submitting.');
    _lastFailedText = text; input.value = ''; input.style.height = 'auto';
    _Voice.stopSpeaking();
    _transcript.push({role:'user',text:text}); _renderTranscript(); _updateStationStats();
    var sendBtn = document.getElementById('osce-send-btn'); if (sendBtn) sendBtn.disabled = true;
    _setError(''); _showThinking(true);
    _abort = new AbortController();
    var aiFn = _activeCase.type === 'data-interp' ? askExaminer : askPatient;
    aiFn(_activeCase, _transcript, _abort.signal)
      .then(function (reply) {
        _showThinking(false);
        _transcript.push({role:'model',text:_sanitizeModelText(reply)}); _renderTranscript(); _updateStationStats(); _saveSession();
        if (_Voice.isOn()) { _Voice.speak(reply); }
      })
      .catch(function (err) {
        _showThinking(false); _setError(_friendlyAiError(err), true);
        if (_transcript.length&&_transcript[_transcript.length-1].role==='user') _transcript.pop();
        _renderTranscript();
      })
      .finally(function () { var sb=document.getElementById('osce-send-btn'); if(sb)sb.disabled=false; var inp=document.getElementById('osce-input'); if(inp)inp.focus(); });
  }

  function _onSubmit() {
    if (!_hasApiKey()) { showToast('Configure your Gemini API key in ⚙ Settings first'); _openSettings(); return; }
    if (!_transcript.filter(function(m){return m.role==='user';}).length) { showToast('Answer at least one question first.'); return; }
    _stopTimer(); _cancelPending(); _Voice.stopSpeaking(); _Voice.disable(); _showDebriefLoading();
    _abort = new AbortController();
    var scoreFn = _activeCase.type === 'data-interp' ? scoreDataInterpExam : scoreInterview;
    scoreFn(_activeCase, _transcript, _abort.signal)
      .then(function (result) { _clearSession(); _showDebrief(result); })
      .catch(function (err) { _hideDebrief(); _setError('Examiner feedback failed: '+_friendlyAiError(err)); });
  }

  function _openResetModal() {
    var overlay = document.getElementById('osce-reset-overlay');
    if (!overlay) {
      overlay = document.createElement('div'); overlay.id = 'osce-reset-overlay'; overlay.className = 'osce-reset-overlay';
      overlay.innerHTML =
        '<div class="osce-reset-modal">' +
          '<h3>Reset Consultation?</h3>' +
          '<p>This will clear the entire conversation, timer, and progress. This cannot be undone.</p>' +
          '<div class="osce-reset-actions">' +
            '<button class="osce-reset-cancel" id="osce-reset-cancel-btn">Go Back</button>' +
            '<button class="osce-reset-danger" id="osce-reset-confirm-btn">Reset Now</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      document.getElementById('osce-reset-cancel-btn').addEventListener('click', _closeResetModal);
      document.getElementById('osce-reset-confirm-btn').addEventListener('click', _confirmResetAction);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) _closeResetModal(); });
    }
    overlay.classList.add('open');
  }

  function _closeResetModal() { var o = document.getElementById('osce-reset-overlay'); if (o) o.classList.remove('open'); }

  function _confirmResetAction() {
    _closeResetModal();
    if (_Voice.isOn()) { _Voice.toggle(); }
    _stopTimer(); _cancelPending(); _clearSession();
    _transcript = []; _renderedCount = 0; _timerRemaining = _activeCase.time || EXAM_TIME; _timerStarted = false;
    _showDoorCard();
    showToast('🔄 Consultation reset — start fresh.');
  }

  function _cancelPending() {
    if (_abort) { try { _abort.abort(); } catch (_) {} _abort = null; }
    _showThinking(false);
  }

  /* ── Debrief Loading ─────────────────────────────────────────── */
  function _showDebriefLoading() {
    var d = document.getElementById('osce-debrief');
    if (!d) { d = document.createElement('div'); d.id = 'osce-debrief'; d.className = 'osce-debrief-overlay'; document.body.appendChild(d); }
    d.className = 'osce-debrief-overlay open';
    d.innerHTML = '<div class="osce-debrief-modal" style="padding:2rem;text-align:center">' +
      '<div class="osce-thinking-bub" style="display:inline-flex;margin-bottom:1rem"><span class="osce-dots"><span></span><span></span><span></span></span></div>' +
      '<div style="font-size:.95rem;color:var(--text-muted)">Examiner is reviewing your consultation…</div>' +
      '</div>';
  }

  function _hideDebrief() { var d=document.getElementById('osce-debrief'); if(d){d.className='osce-debrief-overlay';} }

  /* ── Debrief ─────────────────────────────────────────────────── */
  function _showDebrief(result) {
    var d = document.getElementById('osce-debrief');
    var c = _activeCase, hp = c.hiddenProfile;
    var band = result.score>=90?'Outstanding':result.score>=75?'Strong pass':result.score>=60?'Clear pass':result.score>=40?'Needs improvement':'Restart recommended';
    var timeUsedPct = Math.round((_stationDuration()-_timerRemaining)/_stationDuration()*100);
    var turnCount = _userTurnCount();

    /* Domain grid */
    var isDataInterp = _activeCase && _activeCase.type === 'data-interp';
    var domains = result.domains||{};
    var domainDefs = isDataInterp
      ? [{k:'knowledge',l:'Knowledge',m:30},{k:'interpretation',l:'Interpretation',m:30},{k:'reasoning',l:'Reasoning',m:25},{k:'communication',l:'Communication',m:15}]
      : [{k:'communication',l:'Communication',m:25},{k:'infoGathering',l:'Info Gathering',m:25},{k:'clinicalReasoning',l:'Clinical Reasoning',m:25},{k:'professionalism',l:'Professionalism',m:25}];
    var domColors = ['#38bdf8','#f0a500','#8b5cf6','#2ea043'];
    var domainHTML = domainDefs.map(function(dd,i){
      var v=domains[dd.k]||0, pct=(v/dd.m)*100;
      var q = pct>=70?'good':pct>=40?'avg':'low';
      return '<div class="osce-domain-item '+q+'"><div class="osce-domain-name">'+dd.l+'</div>' +
        '<div class="osce-domain-score">'+v+' <span class="of">/ '+dd.m+'</span></div>' +
        '<div class="osce-dbar-track"><div class="osce-dbar-fill" style="width:'+pct+'%"></div></div></div>';
    }).join('');

    /* Radar SVG + legend */
    var radarSVG = _buildRadarSVG(domains);
    var radarLegend = domainDefs.map(function(dd,i){
      return '<div class="osce-radar-legend-row"><div class="osce-radar-dot" style="background:'+domColors[i]+'"></div><span>'+dd.l+'</span><span style="margin-left:auto;font-weight:700;font-variant-numeric:tabular-nums">'+(domains[dd.k]||0)+'/25</span></div>';
    }).join('');

    /* Criteria */
    var askedHTML = (result.asked.length?result.asked:['(none matched)']).map(function(x,i){return '<li class="osce-asked-item" style="animation-delay:'+(i*.05)+'s">✓ '+_esc(x)+'</li>';}).join('');
    var missedHTML = (result.missed.length?result.missed:['(nothing missed — excellent coverage)']).map(function(x,i){return '<li class="osce-missed-item" style="animation-delay:'+(i*.05)+'s">✗ '+_esc(x)+'</li>';}).join('');

    /* Achievements */
    var badges = _buildAchievements(result, timeUsedPct, turnCount);
    var badgesHTML = badges.map(function(b,i){return '<div class="osce-badge '+b[3]+'" style="animation-delay:'+(i*.08)+'s"><span class="osce-badge-icon">'+b[0]+'</span><span>'+b[1]+'</span></div>';}).join('');

    d.innerHTML =
      '<div class="osce-debrief-modal">' +
        '<div class="osce-db-body">' +
          /* ── Score banner (identical to quiz-engine) ── */
          '<div class="score-banner">' +
            '<div class="score-circle">' +
              '<div class="pct" id="osce-db-pct">'+result.score+'%</div>' +
              '<div class="lbl">Score</div>' +
            '</div>' +
            '<div class="score-details">' +
              '<h3 id="osce-db-grade">'+_esc(band)+'</h3>' +
              '<div class="score-grid">' +
                '<div class="score-stat"><div class="n green">'+timeUsedPct+'%</div><div class="t">Time Used</div></div>' +
                '<div class="score-stat"><div class="n blue">'+turnCount+'</div><div class="t">Turns</div></div>' +
                '<div class="score-stat"><div class="n green">'+result.asked.length+'</div><div class="t">Covered</div></div>' +
                '<div class="score-stat"><div class="n red">'+result.missed.length+'</div><div class="t">Missed</div></div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          /* ── Domain Scores ── */
          '<div class="osce-db-section"><div class="osce-db-sec-title">📊 Domain Scores</div><div class="osce-domain-grid">'+domainHTML+'</div></div>' +
          /* ── Performance Radar ── */
          '<div class="osce-db-section"><div class="osce-db-sec-title">🕸 Performance Radar</div>' +
            '<div class="osce-radar-wrap"><svg class="osce-radar-svg-el" viewBox="0 0 160 160">'+radarSVG+'</svg>' +
            '<div class="osce-radar-legend">'+radarLegend+'</div></div>' +
          '</div>' +
          /* ── Examiner Feedback ── */
          '<div class="osce-db-section"><div class="osce-db-sec-title">💬 Examiner Feedback</div><div class="osce-feedback-box">'+_md(result.feedback)+'</div>' +
            '<div class="osce-dx-box"><span>🩺</span><div><strong>Hidden diagnosis:</strong> '+_esc(hp.diagnosis||'(not specified)')+'</div></div>' +
          '</div>' +
          /* ── Criteria Review ── */
          '<div class="osce-db-section"><div class="osce-db-sec-title">📋 Criteria Review</div>' +
            '<div class="osce-criteria-grid">' +
              '<div class="osce-criteria-sec"><h4>✓ Covered ('+result.asked.length+')</h4><ul>'+askedHTML+'</ul></div>' +
              '<div class="osce-criteria-sec"><h4>✗ Missed ('+result.missed.length+')</h4><ul>'+missedHTML+'</ul></div>' +
            '</div>' +
          '</div>' +
          /* ── Achievements ── */
          (badges.length?'<div class="osce-db-section"><div class="osce-db-sec-title">🏆 Achievements</div><div class="osce-badges">'+badgesHTML+'</div></div>':'') +
          /* ── Actions (identical to quiz-engine result-actions) ── */
          '<div class="result-actions">' +
            '<button class="btn-restart btn-secondary" id="osce-db-back">← Back to Consultation</button>' +
            '<button class="btn-restart" id="osce-db-new">↻ Try Again</button>' +
            '<button class="btn-restart btn-secondary" id="osce-db-hub">🏠 Back to Hub</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    _addRipple(document.getElementById('osce-db-back'));
    _addRipple(document.getElementById('osce-db-new'));
    _addRipple(document.getElementById('osce-db-hub'));
    document.getElementById('osce-db-back').addEventListener('click', _hideDebrief);
    document.getElementById('osce-db-new').addEventListener('click', function () {
      _stopTimer(); _hideDebrief(); _clearSession(); _transcript = []; _renderedCount = 0;
      _timerRemaining = _activeCase.time||EXAM_TIME; _timerStarted = false; _showDoorCard();
    });
    document.getElementById('osce-db-hub').addEventListener('click', function (e) {
      window.navigateToIndex(e);
    });

    /* Confetti on excellent pass */
    if (result.score >= 80) setTimeout(function () { _confetti(); }, 400);
  }

  /* ── Radar Chart ────────────────────────────────────────────── */
  function _buildRadarSVG(domains) {
    var cx = 80, cy = 80, maxR = 60;
    var isDataInterp = _activeCase && _activeCase.type === 'data-interp';
    var domainKeys = isDataInterp
      ? [{k:'knowledge',m:30},{k:'interpretation',m:30},{k:'reasoning',m:25},{k:'communication',m:15}]
      : [{k:'communication',m:25},{k:'infoGathering',m:25},{k:'clinicalReasoning',m:25},{k:'professionalism',m:25}];
    var vals = domainKeys.map(function(dk) { return (domains[dk.k]||0) / dk.m; });
    var colors = ['#38bdf8','#f0a500','#8b5cf6','#2ea043'];
    // 4 axes at 45deg offsets (top, right, bottom, left)
    var angles = [-90, 0, 90, 180];
    function pt(angle, r) {
      var rad = angle*Math.PI/180;
      return {x:cx+r*Math.cos(rad), y:cy+r*Math.sin(rad)};
    }
    // Background grid circles
    var gridHTML = [0.25,0.5,0.75,1].map(function(f){
      var r=f*maxR;
      var pts=angles.map(function(a){return pt(a,r);});
      var d=pts.map(function(p,i){return (i===0?'M':'L')+p.x.toFixed(1)+','+p.y.toFixed(1);}).join(' ')+'Z';
      return '<path d="'+d+'" fill="none" stroke="var(--border)" stroke-width="1" opacity="0.7"/>';
    }).join('');
    // Axis lines
    var axisHTML = angles.map(function(a){
      var p=pt(a,maxR); return '<line x1="'+cx+'" y1="'+cy+'" x2="'+p.x.toFixed(1)+'" y2="'+p.y.toFixed(1)+'" stroke="var(--border)" stroke-width="1" opacity="0.5"/>';
    }).join('');
    // Score polygon
    var scorePts = vals.map(function(v,i){return pt(angles[i],v*maxR);});
    var scoreD = scorePts.map(function(p,i){return (i===0?'M':'L')+p.x.toFixed(1)+','+p.y.toFixed(1);}).join(' ')+'Z';
    var scoreHTML = '<path d="'+scoreD+'" fill="rgba(240,165,0,.18)" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>';
    // Dots
    var dotsHTML = scorePts.map(function(p,i){return '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="4" fill="'+colors[i]+'" stroke="var(--surface)" stroke-width="1.5"/>';}).join('');
    return gridHTML+axisHTML+scoreHTML+dotsHTML;
  }

  /* ── Achievements ────────────────────────────────────────────── */
  function _buildAchievements(result, timeUsedPct, turnCount) {
    var b = [];
    if (result.score >= 80) b.push(['🌟','Outstanding','Score ≥ 80','gold']);
    else if (result.score >= 50) b.push(['✅','Passed','Station passed','green']);
    if (result.missed.length === 0 && result.asked.length > 0) b.push(['🎯','Full Coverage','All criteria covered','green']);
    if (result.domains.communication >= 22) b.push(['💬','Communicator','Communication ≥ 22/25','blue']);
    if (result.domains.professionalism >= 22) b.push(['🎖','Professional','Professionalism ≥ 22/25','blue']);
    if (result.domains.clinicalReasoning >= 22) b.push(['🧠','Clinician','Clinical reasoning ≥ 22/25','purple']);
    if (result.domains.infoGathering >= 22) b.push(['🔍','Thorough','Info gathering ≥ 22/25','purple']);
    if (typeof timeUsedPct === 'number' && timeUsedPct < 65 && result.score >= 50) b.push(['⚡','Efficient','Completed quickly','gold']);
    if (typeof turnCount === 'number' && turnCount >= 15 && result.score >= 50) b.push(['💪','Persistent','15+ questions asked','blue']);
    return b;
  }

  /* ── Confetti ────────────────────────────────────────────────── */
  function _confetti() {
    var canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;width:100%;height:100%';
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    document.body.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var colors = ['#f0a500','#38bdf8','#2ea043','#8b5cf6','#da3633','#fff'];
    var particles = Array.from({length:120}, function() {
      return {
        x: Math.random()*canvas.width, y: Math.random()*-canvas.height*.5,
        w: 6+Math.random()*8, h: 3+Math.random()*5,
        color: colors[Math.floor(Math.random()*colors.length)],
        vx: (Math.random()-.5)*4, vy: 2+Math.random()*5,
        rot: Math.random()*360, vrot: (Math.random()-.5)*8, alpha: 1
      };
    });
    var start = null;
    function frame(ts) {
      if (!start) start = ts;
      var elapsed = ts - start;
      ctx.clearRect(0,0,canvas.width,canvas.height);
      particles.forEach(function(p) {
        p.y += p.vy; p.x += p.vx; p.rot += p.vrot;
        if (elapsed > 2200) p.alpha = Math.max(0, p.alpha - .03);
        ctx.save(); ctx.globalAlpha = p.alpha; ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180);
        ctx.fillStyle = p.color; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore();
      });
      if (elapsed < 3500) requestAnimationFrame(frame);
      else { if (canvas.parentNode) canvas.parentNode.removeChild(canvas); }
    }
    requestAnimationFrame(frame);
  }

  /* ── Settings Modal ──────────────────────────────────────────── */
  function _renderSettingsHTML() {
    var ex = document.getElementById('osce-sov'); if (ex) { ex.className = 'open'; _syncSettings(); return; }
    var div = document.createElement('div'); div.id = 'osce-sov'; div.className = 'open';
    div.innerHTML =
      '<div id="osce-smodal">' +
        '<div class="osce-sh"><h3>⚙ AI & Voice Settings</h3><button class="osce-icon-btn" id="osce-s-close">✕</button></div>' +
        '<div class="osce-sbody">' +
          '<div class="osce-stitle">Gemini API</div>' +
          '<div class="field-box">' +
            '<label class="field-label" for="osce-key-input">Gemini API Key</label>' +
            '<div class="api-row"><input id="osce-key-input" type="password" autocomplete="off" placeholder="Enter your Gemini API key"></div>' +
            '<div class="field-note">Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank">AI Studio</a>. Shared with all QuizTool engines.</div>' +
            '<div class="btn-row"><button class="btn btn-primary" id="osce-key-save">Save</button><button class="btn btn-secondary" id="osce-key-clear">Clear</button><button class="btn btn-secondary" id="osce-key-test">Test</button></div>' +
            '<div id="settings-status"></div>' +
          '</div>' +
          '<div class="osce-stitle">AI Model</div>' +
           '<div class="field-box"><label class="field-label">Model</label><select id="osce-model-sel"></select></div>' +
           '<div class="field-box"><label class="field-label">Max Wait</label><select id="osce-max-wait"><option value="15">15 seconds</option><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="0">No limit</option></select></div>' +
           '<div class="field-box"><label class="field-label">Retry on Failure</label><select id="osce-retry"><option value="fast">Fast (1 attempt)</option><option value="balanced">Balanced (2 attempts)</option><option value="thorough">Thorough (3 attempts)</option></select></div>' +
            '<div class="osce-stitle">Live Model (Gemini Live voice)</div>' +
            '<div class="field-box"><label class="field-label">Live Model</label><select id="osce-live-model-sel"></select></div>' +
          '</div>' +
        '<div class="osce-sf"><div class="btn-row"><button class="btn btn-primary" id="osce-s-done">Done</button></div></div>' +
      '</div>';
    document.body.appendChild(div);

    /* Populate model selects */
    var ms = document.getElementById('osce-model-sel');
    MODELS.forEach(function(m){var o=document.createElement('option');o.value=m[0];o.textContent=m[1];ms.appendChild(o);});
    var lms = document.getElementById('osce-live-model-sel');
    LIVE_MODELS.forEach(function(m){var o=document.createElement('option');o.value=m[0];o.textContent=m[1];lms.appendChild(o);});

    _syncSettings();

    document.getElementById('osce-s-close').addEventListener('click', _closeSettings);
    document.getElementById('osce-s-done').addEventListener('click', function(){_saveSettings();_closeSettings();});
    document.getElementById('osce-key-save').addEventListener('click', _saveKey);
    document.getElementById('osce-key-clear').addEventListener('click', _clearKey);
    document.getElementById('osce-key-test').addEventListener('click', _testKey);
    document.getElementById('osce-model-sel').addEventListener('change', function(){localStorage.setItem(STORAGE.model,this.value);});
    document.getElementById('osce-live-model-sel').addEventListener('change', function(){localStorage.setItem(STORAGE.liveModel,this.value);});
    document.getElementById('osce-max-wait').addEventListener('change', function(){localStorage.setItem(STORAGE.maxWait,this.value);});
    document.getElementById('osce-retry').addEventListener('change', function(){localStorage.setItem(STORAGE.retryLevel,this.value);});
    div.addEventListener('click', function(e){if(e.target===div)_closeSettings();});
    setTimeout(function(){var k=document.getElementById('osce-key-input');if(k)k.focus();},100);
  }

  function _syncSettings() {
    var ki=document.getElementById('osce-key-input'); if(ki)ki.value=_readKey();
    var ms=document.getElementById('osce-model-sel'); if(ms){var sm=_getSavedModel();if(modelIsAvailable(sm))ms.value=sm;}
    var lms=document.getElementById('osce-live-model-sel'); if(lms){var lm=_getSavedLiveModel();if(liveModelIsAvailable(lm))lms.value=lm;}
    var mw=document.getElementById('osce-max-wait'); if(mw)mw.value=localStorage.getItem(STORAGE.maxWait)||'15';
    var rl=document.getElementById('osce-retry'); if(rl)rl.value=_getRetryLevel();
  }
  function _saveSettings() {
  }
  function _openSettings()  { _renderSettingsHTML(); }
  function _closeSettings() { var s=document.getElementById('osce-sov'); if(s)s.className=''; }

  function _saveKey() {
    var v=document.getElementById('osce-key-input').value.trim();
    EngineShared.airWriteGeminiKey(v);
    var st=document.getElementById('settings-status'); if(st)st.textContent=v?'✓ API key saved.':'✗ API key cleared.';
    _closeSettings();
  }
  function _clearKey() {
    EngineShared.airWriteGeminiKey('');
    var ki=document.getElementById('osce-key-input'); if(ki)ki.value='';
    var st=document.getElementById('settings-status'); if(st)st.textContent='✗ API key cleared.';
  }
  function _testKey() {
    var v=document.getElementById('osce-key-input').value.trim();
    var st=document.getElementById('settings-status'); if(!v){st.textContent='✗ No key entered.';return;}
    st.textContent='Testing…';
    fetch('https://generativelanguage.googleapis.com/v1beta/models',{headers:{'x-goog-api-key':v}})
      .then(function(r){return r.text().then(function(t){return{status:r.status,body:t};});})
      .then(function(resp){
        var data; try{data=JSON.parse(resp.body);}catch(e){st.textContent='✗ Parse error';return;}
        if(resp.status===200&&data&&data.models&&data.models.length){
          st.textContent='✓ Key valid ('+data.models.length+' models available).';
        } else {
          var msg=(data&&data.error&&data.error.message)||'Unexpected response';
          st.textContent='✗ '+msg;
        }
      })
      .catch(function(){st.textContent='✗ Connection failed. Check key or network.';});
  }

  /* ── Navigate to parent index ───────────────────────────────── */
  window.navigateToIndex = function(event) {
    if (event) event.preventDefault();
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = 'index.html';
    }
  };

  /* ── Public API ──────────────────────────────────────────────── */
  window.OsceSimulator = { boot:boot, openSettings:_openSettings, hasApiKey:_hasApiKey };

  /* Auto-boot — works reliably whether loaded via <script src>, document.write,
     or bundled modules. Falls back silently so test environments are not affected. */
  try {
    if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', function(){try{boot()}catch(_){}});
    else boot();
  } catch (_) {}

  window.__OSCE_TEST_HOOKS = {
    normalizeConfig:normalizeConfig, normalizeCase:normalizeCase, slugify:slugify,
    buildAvatarParams:buildAvatarParams, renderAvatar:renderAvatar,
    buildPatientSysPrompt:buildPatientSysPrompt, buildExaminerSysPrompt:buildExaminerSysPrompt,
    buildExaminerUserPrompt:buildExaminerUserPrompt, scoreRubric:scoreRubric,
    buildDataInterpSysPrompt:buildDataInterpSysPrompt,
    buildDataInterpScoreSysPrompt:buildDataInterpScoreSysPrompt,
    buildDataInterpScoreUserPrompt:buildDataInterpScoreUserPrompt,
    scoreDataInterp:scoreDataInterp
  };

})();
