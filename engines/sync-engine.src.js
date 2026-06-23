// sync-engine.src.js  v3.3
// Core logic for Progress Synchronization (WebRTC P2P, MQTT Relay, QR, File)
// QRCode.js and Html5Qrcode are lazy-loaded from CDN when needed.
//
// Architecture:
//   SyncProtocol  — framing, checksums, compression, encode/decode (no I/O)
//   SyncEngine    — data management: export, import, merge, trusted devices, localStorage quota guard
//   Transport     — separated into MQTTSignaling, P2PTransport, QRTransport
//   SyncEngine.ui — modal UI (unchanged UX)
//
// v3.2 bug-fixes (on top of v3.1):
//   [CRIT] _safeSetItem now VERIFIES write by reading back; retries on mismatch
//   [CRIT] _processImport sanitizes existing corrupted localStorage data before merge
//   [CRIT] _processImport validates every value after JSON.stringify catches bad data
//   [CRIT] importData auto-repairs corrupted keys in localStorage after import
//   [CRIT] decode() sanitizes wire input: strips BOM, null bytes, control chars
//   [HIGH] _mergeTracker/_mergeProgress safely handle empty-string existing values
//   [HIGH] exportData skips keys whose localStorage values are not valid JSON
//   [HIGH] Per-key import isolation: one corrupt key does not abort entire import
//   [HIGH] _rebuildTrackerIndex validates quiz_tracker_keys before writing
//
// v3.1 bug-fixes:
//   [CRIT] #1  Missing P2P chunks no longer processed as truncated data
//   [CRIT] #2  Reassembly timeout discards incomplete data instead of processing
//   [CRIT] #3  Invalid P2P frames are discarded instead of treated as legacy raw
//   [CRIT] #4  Relay messages capped at MQTT broker limit; oversized forces QR/P2P
//   [HIGH] #5  P2P+Relay duplicate sync eliminated: relay cancels P2P channel
//   [HIGH] #6  ICE candidates queued until remoteDescription is set
//   [HIGH] #7  setPullOnly uses _safeSetItem for quota guard consistency
//   [HIGH] #8  _mergeTrackerKeys validates importedVal is an array
//   [HIGH] #9  _processImport key whitelist prevents arbitrary localStorage writes
//   [MED]  #10 stopScanner: clear() called after stop() resolves
//   [MED]  #11 _importRelay only sends response if sender is also trusted by us
//   [MED]  #12 _pendingSyncs auto-expire after 5 minutes
//   [MED]  #13 _checkQuotaBeforeImport estimates net new storage for merge mode
//   [MED]  #14 Pull-Only devices can initiate connections to receive data
//   [MED]  #15 QR auto-cycling implemented for multi-part codes
//   [MED]  #16 _scanChunks keyed by transfer hash instead of just total
//   [MED]  #17 Device list cleared when MQTT disconnects
//   [MED]  #18 exportData uses proper block-scoped variable in for...of
//   [LOW]  #19 _processIncomingP2PData avoids double decode
//   [LOW]  #20 LZString availability checked before encode/decode
//   [LOW]  #21 Legacy decode fallbacks log parse errors
//
// v3.3 bug-fixes (on top of v3.2):
//   [CRIT] Changed `const` to `var` for SyncProtocol/SyncEngine — `const` at script top-level
//          does NOT create window.* properties, so window.SyncEngine was undefined and the
//          sync modal could never open when the script was loaded dynamically
//   [CRIT] Added explicit window.SyncEngine/window.SyncProtocol assignment as safety net
//   [CRIT] Startup IIFE auto-cleans corrupted empty-string localStorage keys left by prior versions

var SyncProtocol = {
    // --- Wire format v3 ---
    // Full wire:  "QTV3!" + <10-digit base64len> + "!" + <8-hex crc32> + "!" + <lz-base64>
    // QR multi-part: "qtp:<seq>:<total>:<wire-chunk>"
    // P2P chunk frame: "QTF:<seq>:<total>:<wire-chunk>"  (always used, even for single chunk)
    // P2P end-of-transfer: "QTF:END"
    VERSION: 'QTV3',
    P2P_PREFIX: 'QTF:',
    P2P_END: 'QTF:END',
    QR_PREFIX: 'qtp:',
    P2P_CHUNK_SIZE: 16384,
    QR_CHUNK_SIZE: 700,
    MQTT_RELAY_MAX: 262144,

    // [BUG#20] Check LZString availability
    _ensureLZString: function() {
        if (typeof LZString === 'undefined' || !LZString.compressToBase64) {
            throw new Error('LZString library not loaded. Sync cannot proceed.');
        }
    },

    // [v3.2] Sanitize wire input: strip BOM, null bytes, and control chars
    _sanitizeWire: function(wire) {
        if (!wire || typeof wire !== 'string') return wire;
        // Strip UTF-8 BOM
        if (wire.charCodeAt(0) === 0xFEFF) wire = wire.substring(1);
        // Strip UTF-16 LE BOM
        if (wire.charCodeAt(0) === 0xFFFE) wire = wire.substring(1);
        // Remove null bytes and control characters (except tab, newline, carriage return)
        var cleaned = '';
        for (var i = 0; i < wire.length; i++) {
            var code = wire.charCodeAt(i);
            if (code === 0) continue; // null byte
            if (code < 0x20 && code !== 0x09 && code !== 0x0A && code !== 0x0D) continue; // control char
            if (code === 0xFFFD) continue; // Unicode replacement char (corrupted)
            cleaned += wire.charAt(i);
        }
        return cleaned;
    },

    // --- CRC32 ---
    _crcTable: null,
    _ensureCrcTable: function() {
        if (this._crcTable) return;
        var t = new Uint32Array(256);
        for (var i = 0; i < 256; i++) {
            var c = i;
            for (var j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[i] = c;
        }
        this._crcTable = t;
    },
    crc32: function(str) {
        this._ensureCrcTable();
        var crc = 0xFFFFFFFF;
        for (var i = 0; i < str.length; i++) crc = this._crcTable[(crc ^ str.charCodeAt(i)) & 0xFF] ^ (crc >>> 8);
        return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).toUpperCase().padStart(8, '0');
    },

    // --- Encode payload object -> wire string ---
    encode: function(payload) {
        this._ensureLZString();
        var jsonStr = JSON.stringify(payload);
        var compressed = LZString.compressToBase64(jsonStr);
        var lenStr = String(compressed.length).padStart(10, '0');
        var checksum = this.crc32(compressed);
        return this.VERSION + '!' + lenStr + '!' + checksum + '!' + compressed;
    },

    // --- Decode wire string -> payload object (throws on error) ---
    decode: function(wire) {
        this._ensureLZString();
        if (!wire || typeof wire !== 'string') throw new Error('Empty or non-string sync data');
        // [v3.2] Sanitize wire input before processing
        wire = this._sanitizeWire(wire);
        var trimmed = wire.trim();
        if (!trimmed.length) throw new Error('Blank sync data received');

        // v3 format: QTV3!NNNNNNNNNN!CCCCCCCC!<base64>
        if (trimmed.startsWith(this.VERSION + '!') && trimmed.length >= 24) {
            var parts = trimmed.split('!');
            if (parts.length >= 4 && parts[0] === this.VERSION) {
                var lenStr = parts[1];
                var expectedCrc = parts[2];
                var base64 = parts.slice(3).join('!');
                var expectedLen = parseInt(lenStr, 10);
                if (isNaN(expectedLen) || lenStr.length !== 10) throw new Error('Invalid length header');
                if (base64.length !== expectedLen) throw new Error('Length mismatch: expected ' + expectedLen + ', got ' + base64.length);
                var actualCrc = this.crc32(base64);
                if (actualCrc !== expectedCrc) throw new Error('CRC mismatch: expected ' + expectedCrc + ', got ' + actualCrc);
                if (!/^[A-Za-z0-9+/=]+$/.test(base64)) throw new Error('Invalid base64 characters detected');
                var jsonStr = LZString.decompressFromBase64(base64);
                if (!jsonStr) throw new Error('Decompression failed');
                var jsonTrimmed = jsonStr.trim();
                if (!jsonTrimmed.startsWith('{') || !jsonTrimmed.endsWith('}')) throw new Error('Decompressed data is not a JSON object');
                var payload;
                try { payload = JSON.parse(jsonTrimmed); } catch(e) { throw new Error('JSON parse error: ' + e.message); }
                if (!payload || typeof payload.data !== 'object') throw new Error('Missing payload.data');
                return payload;
            }
        }

        // Legacy v2 format: NNNNNNNNNN!XXXX!<base64>  (10-digit len + 4-hex checksum)
        if (trimmed.length >= 16 && trimmed.charAt(10) === '!' && trimmed.charAt(15) === '!') {
            var legacyLen = trimmed.substring(0, 10);
            var legacyChecksum = trimmed.substring(11, 15);
            if (/^\d{10}$/.test(legacyLen) && /^[0-9A-F]{4}$/.test(legacyChecksum)) {
                var legacyBase64 = trimmed.substring(16);
                var sum = 0;
                for (var ci = 0; ci < legacyBase64.length; ci++) sum = (sum + legacyBase64.charCodeAt(ci)) % 65536;
                var legacyHex = sum.toString(16).toUpperCase().padStart(4, '0');
                if (legacyHex === legacyChecksum && legacyBase64.length === parseInt(legacyLen, 10)) {
                    if (/^[A-Za-z0-9+/=]+$/.test(legacyBase64)) {
                        var legacyJson = LZString.decompressFromBase64(legacyBase64);
                        if (legacyJson) {
                            try { return JSON.parse(legacyJson.trim()); } catch(e) { console.warn('[LEGACY] v2 JSON parse failed:', e.message); }
                        }
                    }
                }
                throw new Error('Legacy v2 data corrupted (checksum or length mismatch)');
            }
        }

        // Raw base64 fallback (oldest format — like the user's backup file)
        if (/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
            var rawJson = LZString.decompressFromBase64(trimmed);
            if (rawJson) {
                var rawTrimmed = rawJson.trim();
                try { return JSON.parse(rawTrimmed); } catch(e) { console.warn('[LEGACY] Raw base64 JSON parse failed:', e.message); }
                // [v3.2] Try harder: sometimes LZString decompresses with trailing garbage
                // Find the last } and parse up to it
                var lastBrace = rawTrimmed.lastIndexOf('}');
                if (lastBrace > 0) {
                    var truncated = rawTrimmed.substring(0, lastBrace + 1);
                    try { return JSON.parse(truncated); } catch(e2) { console.warn('[LEGACY] Truncated parse also failed:', e2.message); }
                }
            }
            throw new Error('Failed to decompress or parse raw base64 sync data');
        }

        throw new Error('Unrecognized sync data format');
    },

    // --- Preview payload without full import (returns summary or null) ---
    preview: function(wire) {
        try {
            var payload = this.decode(wire);
            var summary = { senderName: payload.senderName || 'Unknown', trackerCount: 0, progressCount: 0, subjects: [] };
            var subjectNames = {};
            for (var key in payload.data) {
                if (!payload.data.hasOwnProperty(key)) continue;
                if (key.startsWith('quiz_tracker_v2_')) {
                    summary.trackerCount++;
                    var uid = key.replace('quiz_tracker_v2_', '');
                    try {
                        var d = payload.data[key];
                        subjectNames[uid] = { name: d.title || d.name || uid, wrong: (d.wrong||[]).length, flagged: (d.flagged||[]).length };
                    } catch(e) { subjectNames[uid] = { name: uid, wrong: 0, flagged: 0 }; }
                }
                if (key.startsWith('quiz_progress_') || key.startsWith('bank_progress_')) summary.progressCount++;
            }
            summary.subjects = [];
            for (var s in subjectNames) if (subjectNames.hasOwnProperty(s)) summary.subjects.push(subjectNames[s]);
            return summary;
        } catch(e) { return null; }
    },

    // --- Split wire string into P2P frames ---
    frameForP2P: function(wire) {
        var frames = [];
        if (wire.length <= this.P2P_CHUNK_SIZE) {
            frames.push(this.P2P_PREFIX + '1:1:' + wire);
        } else {
            var total = Math.ceil(wire.length / this.P2P_CHUNK_SIZE);
            for (var i = 0; i < total; i++) {
                var chunk = wire.substring(i * this.P2P_CHUNK_SIZE, (i + 1) * this.P2P_CHUNK_SIZE);
                frames.push(this.P2P_PREFIX + (i + 1) + ':' + total + ':' + chunk);
            }
        }
        frames.push(this.P2P_END);
        return frames;
    },

    // --- Parse a P2P frame -> { seq, total, data } or 'END' or null ---
    parseP2PFrame: function(raw) {
        if (raw === this.P2P_END) return 'END';
        if (typeof raw !== 'string' || !raw.startsWith(this.P2P_PREFIX)) return null;
        var body = raw.substring(this.P2P_PREFIX.length);
        var firstColon = body.indexOf(':');
        var secondColon = body.indexOf(':', firstColon + 1);
        if (firstColon < 0 || secondColon < 0) return null;
        var seq = parseInt(body.substring(0, firstColon), 10);
        var total = parseInt(body.substring(firstColon + 1, secondColon), 10);
        var data = body.substring(secondColon + 1);
        if (isNaN(seq) || isNaN(total) || seq < 1 || total < 1 || seq > total) return null;
        return { seq: seq, total: total, data: data };
    },

    // --- Split wire string into QR chunks ---
    frameForQR: function(wire) {
        if (wire.length <= this.QR_CHUNK_SIZE) return [wire];
        var chunks = [];
        var total = Math.ceil(wire.length / this.QR_CHUNK_SIZE);
        for (var i = 0; i < total; i++) {
            var chunk = wire.substring(i * this.QR_CHUNK_SIZE, (i + 1) * this.QR_CHUNK_SIZE);
            chunks.push(this.QR_PREFIX + (i + 1) + ':' + total + ':' + chunk);
        }
        return chunks;
    },

    // --- Parse QR scan text -> { seq, total, data } or null ---
    parseQRChunk: function(text) {
        if (typeof text !== 'string') return null;
        if (!text.startsWith(this.QR_PREFIX)) return { seq: 1, total: 1, data: text };
        var body = text.substring(this.QR_PREFIX.length);
        var firstColon = body.indexOf(':');
        var secondColon = body.indexOf(':', firstColon + 1);
        if (firstColon < 0 || secondColon < 0) return null;
        var seq = parseInt(body.substring(0, firstColon), 10);
        var total = parseInt(body.substring(firstColon + 1, secondColon), 10);
        var data = body.substring(secondColon + 1);
        if (isNaN(seq) || isNaN(total) || seq < 1 || total < 1 || seq > total) return null;
        return { seq: seq, total: total, data: data };
    }
};


var SyncEngine = {
    // Allowed key prefixes for import — prevents arbitrary localStorage writes
    _ALLOWED_IMPORT_PREFIXES: ['quiz_tracker_v2_', 'quiz_progress_', 'bank_progress_'],
    _ALLOWED_IMPORT_EXACT_KEYS: ['quiz_tracker_keys'],

    // Pending sync auto-expiry (5 minutes)
    _PENDING_SYNC_TTL: 5 * 60 * 1000,

    // --- Library Loading (CDN Lazy-Load) ---
    _libLoaded: {},
    _libQueue: {},

    _loadScript: function(url, globalName) {
        return new Promise((resolve, reject) => {
            if (this._libLoaded[url]) { resolve(window[globalName]); return; }
            if (this._libQueue[url]) { this._libQueue[url].push({ resolve, reject }); return; }
            this._libQueue[url] = [{ resolve, reject }];
            var script = document.createElement('script');
            script.src = url;
            script.async = true;
            script.onload = () => {
                this._libLoaded[url] = true;
                var queue = this._libQueue[url] || [];
                delete this._libQueue[url];
                queue.forEach(q => q.resolve(window[globalName]));
            };
            script.onerror = () => {
                var queue = this._libQueue[url] || [];
                delete this._libQueue[url];
                queue.forEach(q => q.reject(new Error('Failed to load: ' + url)));
            };
            document.head.appendChild(script);
        });
    },

    _ensureQRCode: function() {
        return this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', 'QRCode');
    },

    _ensureHtml5Qrcode: function() {
        return this._loadScript('https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js', 'Html5Qrcode');
    },

    // --- Trusted Devices ---
    _getTrustedDevices: function() {
        try { return JSON.parse(localStorage.getItem('quiztool_trusted_devices') || '[]'); } catch(e) { return []; }
    },
    _addTrustedDevice: function(deviceId, deviceName) {
        var trusted = this._getTrustedDevices();
        if (!trusted.find(function(d) { return d.id === deviceId; })) {
            trusted.push({ id: deviceId, name: deviceName, trustedAt: Date.now() });
            this._safeSetItem('quiztool_trusted_devices', JSON.stringify(trusted));
        }
    },
    _removeTrustedDevice: function(deviceId) {
        var trusted = this._getTrustedDevices().filter(function(d) { return d.id !== deviceId; });
        this._safeSetItem('quiztool_trusted_devices', JSON.stringify(trusted));
    },
    _isTrustedDevice: function(deviceId) {
        return this._getTrustedDevices().some(function(d) { return d.id === deviceId; });
    },

    // --- localStorage quota guard ---
    _estimateUsage: function() {
        var total = 0;
        for (var i = 0; i < localStorage.length; i++) {
            var key = localStorage.key(i);
            var val = localStorage.getItem(key);
            if (val) total += key.length + val.length;
        }
        return total * 2;
    },

    // [v3.2] _safeSetItem now VERIFIES the write by reading back
    _safeSetItem: function(key, value) {
        try {
            localStorage.setItem(key, value);
            // [v3.2] VERIFY: read back and confirm the value matches
            var readBack = localStorage.getItem(key);
            if (readBack !== value) {
                // Write was silently truncated or corrupted
                console.error('localStorage VERIFICATION FAILED for', key, ': written', value.length, 'chars, read back', readBack ? readBack.length : 0);
                // Retry once after a short delay
                try { localStorage.removeItem(key); } catch(e) {}
                try { localStorage.setItem(key, value); } catch(e2) {}
                readBack = localStorage.getItem(key);
                if (readBack !== value) {
                    console.error('localStorage RETRY ALSO FAILED for', key);
                    throw { name: 'QuotaExceededError', code: 22, message: 'Write verification failed: stored data does not match' };
                }
            }
        } catch(e) {
            var msg = (e.name === 'QuotaExceededError' || e.code === 22) ? 'QuotaExceeded' : e.message;
            console.error('localStorage write failed for', key, ':', msg);
            if (window.showToast) {
                window.showToast('Storage full! Please clear some tracker data to free space.');
            }
            throw e;
        }
    },

    // [v3.2] Validate that a string is parseable JSON — returns parsed value or undefined
    _tryParseJSON: function(str) {
        if (!str || typeof str !== 'string') return undefined;
        try { return JSON.parse(str); } catch(e) { return undefined; }
    },

    // [v3.2] Check if an existing localStorage value is valid JSON; if not, delete the corrupted key
    _sanitizeExistingValue: function(key) {
        var raw = localStorage.getItem(key);
        if (raw === null) return null; // key doesn't exist — fine
        if (raw === '') {
            // Empty string stored — this is corruption, remove it
            console.warn('Removing corrupted empty localStorage key:', key);
            localStorage.removeItem(key);
            return null;
        }
        // Try to parse — if it fails, the existing data is corrupted
        try { JSON.parse(raw); return raw; }
        catch(e) {
            console.warn('Removing corrupted localStorage key:', key, '(parse error:', e.message, ')');
            localStorage.removeItem(key);
            return null;
        }
    },

    // Helper: check if a key is allowed for import
    _isAllowedImportKey: function(key) {
        if (this._ALLOWED_IMPORT_EXACT_KEYS.indexOf(key) !== -1) return true;
        for (var i = 0; i < this._ALLOWED_IMPORT_PREFIXES.length; i++) {
            if (key.startsWith(this._ALLOWED_IMPORT_PREFIXES[i])) return true;
        }
        return false;
    },

    // Estimate net new bytes for merge mode
    _estimateNetImportSize: function(importedData, mode) {
        var incomingSize = 0;
        for (var key in importedData) {
            if (!importedData.hasOwnProperty(key)) continue;
            if (!this._isAllowedImportKey(key)) continue;
            var valStr = JSON.stringify(importedData[key]);
            incomingSize += key.length + valStr.length;
            if (mode === 'merge') {
                var existing = localStorage.getItem(key);
                if (existing) {
                    incomingSize -= key.length + existing.length;
                }
            }
        }
        incomingSize *= 2;
        return incomingSize;
    },

    _checkQuotaBeforeImport: function(importedData, mode) {
        var incomingSize = this._estimateNetImportSize(importedData, mode || 'merge');
        var currentUsage = this._estimateUsage();
        var APPROX_LIMIT = 4.5 * 1024 * 1024;
        if (currentUsage + incomingSize > APPROX_LIMIT) {
            var currentMB = (currentUsage / 1048576).toFixed(1);
            var incomingMB = (Math.max(0, incomingSize) / 1048576).toFixed(1);
            var msg = 'Import would exceed storage limit (' + currentMB + ' MB used + ' + incomingMB + ' MB net new). Clear some tracker data first.';
            console.warn(msg);
            if (window.showToast) window.showToast(msg);
            return false;
        }
        return true;
    },

    // --- Data Management ---
    exportData: function(options) {
        if (!options) options = { tracker: true, progress: true };
        var payload = { timestamp: Date.now(), senderName: this.webrtc.deviceName, data: {} };

        var keys = [];
        for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
        var subjectSet = new Set(options.subjects || []);

        for (var ki = 0; ki < keys.length; ki++) {
            var key = keys[ki];
            try {
                var val = localStorage.getItem(key);
                if (!val) continue;

                // [v3.2] Validate that the stored value is parseable JSON before including it
                var parsed;
                try { parsed = JSON.parse(val); } catch(e) {
                    console.warn('Export skip (corrupted localStorage value for key):', key);
                    continue;
                }

                if (options.tracker && key.startsWith('quiz_tracker_v2_')) {
                    if (subjectSet.size > 0) {
                        var uid = key.replace('quiz_tracker_v2_', '');
                        if (!subjectSet.has(uid)) continue;
                    }
                    payload.data[key] = parsed;
                }
                if (options.tracker && key === 'quiz_tracker_keys') {
                    payload.data[key] = parsed;
                }
                if (options.progress && (key.startsWith('quiz_progress_') || key.startsWith('bank_progress_'))) {
                    if (subjectSet.size > 0) {
                        var matched = false;
                        for (let subj of subjectSet) { if (key.indexOf(subj) !== -1) { matched = true; break; } }
                        if (!matched) continue;
                    }
                    payload.data[key] = parsed;
                }
            } catch(e) { console.warn('Export skip (invalid JSON):', key); }
        }

        return SyncProtocol.encode(payload);
    },

    importData: function(wire, mode) {
        if (!mode) mode = 'merge';
        try {
            var payload = SyncProtocol.decode(wire);
            if (!payload || !payload.data || typeof payload.data !== 'object') {
                throw new Error('Invalid data format (missing payload.data)');
            }

            if (!this._checkQuotaBeforeImport(payload.data, mode)) {
                return false;
            }

            this._processImport(payload.data, mode);
            return true;
        } catch(e) {
            console.error('Sync import failed:', e);
            if (window.showToast) window.showToast('Import error: ' + e.message);
            return false;
        }
    },

    _processImport: function(importedData, mode) {
        var errors = [];
        for (var key in importedData) {
            if (!importedData.hasOwnProperty(key)) continue;

            // Only write allowed keys
            if (!this._isAllowedImportKey(key)) {
                console.warn('Import skip (disallowed key):', key);
                continue;
            }

            var importedVal = importedData[key];

            // [v3.2] Validate importedVal can be serialized — catch undefined, functions, etc.
            var serialized;
            try { serialized = JSON.stringify(importedVal); } catch(e) {
                console.error('Import skip (non-serializable value for key):', key, e.message);
                errors.push(key);
                continue;
            }
            // [v3.2] Verify the serialized string is valid JSON (round-trip check)
            try { JSON.parse(serialized); } catch(e) {
                console.error('Import skip (round-trip failed for key):', key, e.message);
                errors.push(key);
                continue;
            }

            if (mode === 'replace') {
                this._safeSetItem(key, serialized);
            } else { // merge
                // [v3.2] Sanitize existing value — remove if corrupted
                var existing = this._sanitizeExistingValue(key);
                if (!existing) {
                    this._safeSetItem(key, serialized);
                    continue;
                }

                // [v3.2] Per-key isolation: each merge operation wrapped independently
                try {
                    if (key.startsWith('quiz_tracker_v2_')) {
                        this._mergeTracker(key, existing, importedVal);
                    } else if (key === 'quiz_tracker_keys') {
                        this._mergeTrackerKeys(existing, importedVal);
                    } else if (key.startsWith('quiz_progress_') || key.startsWith('bank_progress_')) {
                        this._mergeProgress(key, existing, importedVal);
                    } else {
                        this._safeSetItem(key, serialized);
                    }
                } catch(mergeErr) {
                    // [v3.2] If merge fails for one key, write imported value as fallback
                    console.warn('Merge failed for', key, ':', mergeErr.message, '— writing imported value directly');
                    try { this._safeSetItem(key, serialized); } catch(writeErr) {
                        console.error('Write also failed for', key, ':', writeErr.message);
                        errors.push(key);
                    }
                }
            }
        }

        this._rebuildTrackerIndex();

        // [v3.2] After import, auto-repair: scan for any corrupted keys and fix them
        this._autoRepairCorruptedKeys();

        if (errors.length > 0) {
            console.warn('Import completed with errors on keys:', errors);
        }
    },

    // [v3.2] Auto-repair: scan localStorage for known key patterns with corrupted values
    _autoRepairCorruptedKeys: function() {
        var repaired = 0;
        for (var i = localStorage.length - 1; i >= 0; i--) {
            var key = localStorage.key(i);
            if (!key) continue;
            var val = localStorage.getItem(key);
            if (val === '') {
                // Empty string is always corruption for our data keys
                if (key.startsWith('quiz_tracker_v2_') || key.startsWith('quiz_progress_') || key.startsWith('bank_progress_') || key === 'quiz_tracker_keys') {
                    console.warn('Auto-repair: removing empty value for', key);
                    localStorage.removeItem(key);
                    repaired++;
                }
            }
        }
        if (repaired > 0) console.log('Auto-repair: cleaned', repaired, 'corrupted keys');
    },

    _mergeTracker: function(key, existingRaw, importedVal) {
        try {
            var existingData = JSON.parse(existingRaw);
            if (!existingData || typeof existingData !== 'object') {
                this._safeSetItem(key, JSON.stringify(importedVal));
                return;
            }
            existingData.wrong = this._mergeTrackerLists(existingData.wrong, importedVal.wrong);
            existingData.flagged = this._mergeTrackerLists(existingData.flagged, importedVal.flagged);
            existingData.wrongCount = (existingData.wrong || []).length;
            existingData.flaggedCount = (existingData.flagged || []).length;
            existingData.timestamp = Math.max(existingData.timestamp || 0, importedVal.timestamp || 0);
            this._safeSetItem(key, JSON.stringify(existingData));
        } catch(e) {
            this._safeSetItem(key, JSON.stringify(importedVal));
        }
    },

    _mergeTrackerLists: function(listA, listB) {
        var a = Array.isArray(listA) ? listA : [];
        var b = Array.isArray(listB) ? listB : [];
        var remaining = a.slice();
        var result = [];

        for (var bi = 0; bi < b.length; bi++) {
            var importedItem = b[bi];
            var matchIndex = -1;
            var hasIdxB = importedItem.idx !== undefined && importedItem.idx !== null;

            for (var ai = 0; ai < remaining.length; ai++) {
                var existingItem = remaining[ai];
                var hasIdxA = existingItem.idx !== undefined && existingItem.idx !== null;

                if (hasIdxA && hasIdxB && String(existingItem.idx) === String(importedItem.idx)) {
                    matchIndex = ai; break;
                }
                if (existingItem.text && importedItem.text && existingItem.text.trim().length > 5) {
                    if (existingItem.text.trim() === importedItem.text.trim()) {
                        if (!hasIdxA || !hasIdxB) { matchIndex = ai; break; }
                    }
                }
            }

            if (matchIndex !== -1) {
                var matched = remaining.splice(matchIndex, 1)[0];
                result.push(Object.assign({}, matched, importedItem));
            } else {
                result.push(importedItem);
            }
        }
        return result.concat(remaining);
    },

    _mergeTrackerKeys: function(existingRaw, importedVal) {
        try {
            if (!Array.isArray(importedVal)) {
                console.warn('_mergeTrackerKeys: importedVal is not an array, skipping');
                return;
            }
            var existingData = JSON.parse(existingRaw || '[]');
            if (!Array.isArray(existingData)) existingData = [];
            var merged = [];
            var seen = {};
            for (var i = 0; i < existingData.length; i++) {
                if (!seen[existingData[i]]) { seen[existingData[i]] = true; merged.push(existingData[i]); }
            }
            for (var j = 0; j < importedVal.length; j++) {
                if (!seen[importedVal[j]]) { seen[importedVal[j]] = true; merged.push(importedVal[j]); }
            }
            this._safeSetItem('quiz_tracker_keys', JSON.stringify(merged));
        } catch(e) { console.warn('_mergeTrackerKeys failed:', e); }
    },

    _mergeProgress: function(key, existingRaw, importedVal) {
        try {
            var existingData = JSON.parse(existingRaw);
            if (!existingData.timestamp || !importedVal.timestamp || importedVal.timestamp > existingData.timestamp) {
                this._safeSetItem(key, JSON.stringify(importedVal));
            }
        } catch(e) {
            this._safeSetItem(key, JSON.stringify(importedVal));
        }
    },

    _rebuildTrackerIndex: function() {
        try {
            var existing = localStorage.getItem('quiz_tracker_keys');
            var keys;
            // [v3.2] Validate before parsing
            if (existing) {
                try { keys = JSON.parse(existing); } catch(e) { keys = []; }
            } else { keys = []; }
            if (!Array.isArray(keys)) keys = [];
            for (var i = 0; i < localStorage.length; i++) {
                var k = localStorage.key(i);
                if (k.startsWith('quiz_tracker_v2_')) {
                    var uid = k.replace('quiz_tracker_v2_', '');
                    if (keys.indexOf(uid) === -1) keys.push(uid);
                }
            }
            this._safeSetItem('quiz_tracker_keys', JSON.stringify(keys));
        } catch(e) { console.warn('_rebuildTrackerIndex failed:', e); }
    },

    // --- WebRTC + MQTT Architecture ---
    webrtc: {
        deviceId: (function() {
            try {
                var id = localStorage.getItem('quiztool-sync-device-id');
                if (!id) { id = Math.random().toString(36).substr(2, 6).toUpperCase(); localStorage.setItem('quiztool-sync-device-id', id); }
                return id;
            } catch(e) { return Math.random().toString(36).substr(2, 6).toUpperCase(); }
        })(),
        deviceName: (function() {
            try {
                var name = localStorage.getItem('quiztool-sync-device-name');
                if (!name) {
                    var adj = ['Red','Blue','Gold','Swift','Calm','Bold','Wise','Keen'];
                    var noun = ['Owl','Fox','Bear','Wolf','Hawk','Lion','Stag','Lynx'];
                    name = adj[Math.floor(Math.random()*adj.length)] + ' ' + noun[Math.floor(Math.random()*noun.length)];
                    localStorage.setItem('quiztool-sync-device-name', name);
                }
                return name;
            } catch(e) { return 'Device'; }
        })(),
        roomHash: null,
        mqttClient: null,
        peers: {},
        devices: {},
        heartbeatInterval: null,
        disconnectTimeout: null,
        _discovering: false,
        _pendingSyncs: {},
        _reassembly: {},
        _iceQueue: {},
        _relayUsedFor: {},
        pullOnly: (function() { try { return localStorage.getItem('quiztool_sync_pull_only') === 'true'; } catch(e) { return false; } })(),

        setPullOnly: function(val) {
            this.pullOnly = val;
            SyncEngine._safeSetItem('quiztool_sync_pull_only', val ? 'true' : 'false');
            var toggle = document.getElementById('sync-pull-only-toggle');
            if (toggle) toggle.checked = val;
            SyncEngine.ui.updateDeviceList();
            this.broadcastPresence();
        },

        _cleanExpiredPendingSyncs: function() {
            var now = Date.now();
            for (var id in this._pendingSyncs) {
                if (!this._pendingSyncs.hasOwnProperty(id)) continue;
                if (now - this._pendingSyncs[id].createdAt > SyncEngine._PENDING_SYNC_TTL) {
                    console.warn('Auto-declining expired pending sync from', id);
                    delete this._pendingSyncs[id];
                    SyncEngine.ui.hideConfirmToast(id);
                }
            }
        },

        initDiscovery: function() {
            if (this.disconnectTimeout) { clearTimeout(this.disconnectTimeout); this.disconnectTimeout = null; }
            if (this.mqttClient || this._discovering) return;
            this._discovering = true;
            SyncEngine.ui.setStatus('Initializing discovery...');
            this._getPublicIP((ip) => {
                this._hashString('quiztool-v2-' + ip).then((hash) => {
                    this.roomHash = hash.substring(0, 8).toUpperCase();
                    SyncEngine.ui.setRoomId(this.roomHash);
                    this._connectMQTT();
                });
            });
        },

        _getPublicIP: function(callback) {
            try {
                var pc = new RTCPeerConnection({iceServers: [{urls: 'stun:stun.l.google.com:19302'}]});
                pc.createDataChannel('');
                pc.createOffer().then(function(offer) { pc.setLocalDescription(offer); });
                var found = false;
                var timeout = setTimeout(function() {
                    if (!found) { found = true; callback('offline'); try { pc.close(); } catch(e) {} }
                }, 2500);
                pc.onicecandidate = function(e) {
                    if (found || !e.candidate) return;
                    var match = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(e.candidate.candidate);
                    if (match && e.candidate.type === 'srflx') {
                        found = true; clearTimeout(timeout); callback(match[1]); pc.close();
                    }
                };
            } catch(e) { callback('offline'); }
        },

        _hashString: async function(str) {
            try {
                if (window.crypto && crypto.subtle) {
                    var buf = new TextEncoder().encode(str);
                    var hash = await crypto.subtle.digest('SHA-256', buf);
                    return Array.from(new Uint8Array(hash)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
                }
            } catch(e) {}
            var h = 0;
            for (var i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
            return Math.abs(h).toString(16).padStart(8, '0');
        },

        _getPahoMsg: function() {
            try { return (window.Paho && Paho.MQTT) ? Paho.MQTT.Message : (window.Paho ? Paho.Message : null); } catch(e) { return null; }
        },
        _getPahoClient: function() {
            try { return (window.Paho && Paho.MQTT) ? Paho.MQTT.Client : (window.Paho ? Paho.Client : null); } catch(e) { return null; }
        },

        _connectMQTT: function() {
            try {
                if (!window.Paho) { SyncEngine.ui.setStatus('Paho MQTT library missing.', false); return; }
                SyncEngine.ui.setStatus('Connecting to signaling network...');
                var clientId = 'qt-' + (this.deviceId || 'UNK') + '-' + Math.floor(Math.random() * 10000);
                var PahoClient = this._getPahoClient();
                if (!PahoClient) { SyncEngine.ui.setStatus('MQTT Setup Failed.', false); return; }
                this.mqttClient = new PahoClient('broker.emqx.io', 8084, '/mqtt', clientId);
            } catch(ce) {
                console.error('Paho Constructor Error:', ce);
                SyncEngine.ui.setStatus('MQTT Setup Failed: ' + ce.message, false);
                return;
            }

            var self = this;
            this.mqttClient.onConnectionLost = function(responseObject) {
                if (responseObject.errorCode !== 0) {
                    SyncEngine.ui.setStatus('Network lost. Will retry on next open.');
                    self.mqttClient = null;
                    self._discovering = false;
                    self.devices = {};
                    if (self.heartbeatInterval) { clearInterval(self.heartbeatInterval); self.heartbeatInterval = null; }
                }
            };
            this.mqttClient.onMessageArrived = function(m) { self._onMqttMessage(m); };

            this.mqttClient.connect({
                useSSL: true, timeout: 5, keepAliveInterval: 30,
                onSuccess: function() {
                    self.mqttClient.subscribe('quiztool/sync/v2/' + self.roomHash + '/#');
                    self._discovering = false;
                    self.broadcastPresence();
                    self._startHeartbeat();
                    SyncEngine.ui.setStatus('Scanning for devices...');
                },
                onFailure: function(e) {
                    console.error('MQTT Connect Failed:', e);
                    SyncEngine.ui.setStatus('Connection failed (Internet/Firewall).', false);
                }
            });
        },

        _startHeartbeat: function() {
            if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = setInterval(() => this.broadcastPresence(), 5000);
        },

        broadcastPresence: function() {
            if (!this.mqttClient) return;
            try {
                var PahoMsg = this._getPahoMsg();
                if (!PahoMsg) return;
                var msg = new PahoMsg(JSON.stringify({ type: 'presence', id: this.deviceId, name: this.deviceName, pullOnly: this.pullOnly }));
                msg.destinationName = 'quiztool/sync/v2/' + this.roomHash + '/presence/' + this.deviceId;
                this.mqttClient.send(msg);
            } catch(e) { console.warn('Presence broadcast failed:', e); }
        },

        _onMqttMessage: function(msg) {
            var payload;
            try { payload = JSON.parse(msg.payloadString); } catch(e) { console.error('MQTT: invalid JSON message'); return; }

            if (payload.type === 'presence' && payload.id !== this.deviceId) {
                this.devices[payload.id] = { name: payload.name, lastSeen: Date.now(), pullOnly: !!payload.pullOnly };
                SyncEngine.ui.updateDeviceList();
            } else if (payload.type === 'signal' && payload.target === this.deviceId) {
                this._handleSignal(payload);
            } else if (payload.type === 'qtp-ack' && payload.target === 'all') {
                if (SyncEngine.ui.qrPage + 1 === parseInt(payload.idx)) SyncEngine.ui.nextQR(true);
            } else if (payload.type === 'relay' && payload.target === this.deviceId) {
                var fromId = payload.sender;
                this._cleanExpiredPendingSyncs();
                if (SyncEngine._isTrustedDevice(fromId)) {
                    this._importRelay(payload);
                } else {
                    var preview = SyncProtocol.preview(payload.data);
                    this._pendingSyncs[fromId] = { type: 'relay', payload: payload, createdAt: Date.now() };
                    SyncEngine.ui.showConfirmToast(fromId, this.devices[fromId] ? this.devices[fromId].name : 'Unknown', preview);
                }
            }
        },

        _importRelay: function(payload) {
            SyncEngine.ui.setStatus('Receiving via Relay...', true);
            if (SyncEngine.importData(payload.data, 'merge')) {
                SyncEngine.ui.setStatus('Relay Sync complete!', true);
                if (window.showToast) window.showToast('Sync complete (via Relay)');
                if (window.renderQuizzes) window.renderQuizzes();
                if (!payload.isResponse && SyncEngine._isTrustedDevice(payload.sender) && !this.pullOnly) {
                    this._sendRelay(payload.sender, SyncEngine.exportData(SyncEngine.ui._getOptions()), true);
                }
            } else {
                SyncEngine.ui.setStatus('Relay data import failed.', false);
            }
        },

        acceptSync: function(fromId, trustAlways) {
            this._cleanExpiredPendingSyncs();
            var pending = this._pendingSyncs[fromId];
            if (!pending) return;
            if (trustAlways) {
                SyncEngine._addTrustedDevice(fromId, this.devices[fromId] ? this.devices[fromId].name : 'Unknown');
                SyncEngine.ui.updateDeviceList();
            }
            if (pending.type === 'relay') {
                this._importRelay(pending.payload);
            } else if (pending.type === 'p2p-data') {
                SyncEngine.ui.setStatus('Receiving data...', true);
                if (SyncEngine.importData(pending.data, 'merge')) {
                    SyncEngine.ui.setStatus('Data received and merged!', true);
                    if (window.showToast) window.showToast('P2P Sync complete!');
                    if (window.renderQuizzes) window.renderQuizzes();
                } else { SyncEngine.ui.setStatus('Import failed.', false); }
            }
            delete this._pendingSyncs[fromId];
            SyncEngine.ui.hideConfirmToast(fromId);
        },

        declineSync: function(fromId) {
            delete this._pendingSyncs[fromId];
            SyncEngine.ui.hideConfirmToast(fromId);
            SyncEngine.ui.setStatus('Sync declined.', false);
        },

        connectToDevice: function(targetId) {
            SyncEngine.ui.setStatus('Connecting to ' + (this.devices[targetId] ? this.devices[targetId].name : targetId) + '...');
            if (this.peers[targetId]) { try { this.peers[targetId].close(); } catch(e) {} delete this.peers[targetId]; }
            this._clearReassembly(targetId);
            var pc = this._createPeerConnection(targetId);
            var channel = pc.createDataChannel('sync');
            this._setupChannel(channel, targetId);
            var relayFired = false;
            pc.onconnectionstatechange = function() {
                if (pc.connectionState === 'connected') {
                    relayFired = true;
                    if (SyncEngine.webrtc._relayUsedFor[targetId]) {
                        console.log('P2P connected but relay already used for', targetId, '— closing P2P');
                        try { pc.close(); } catch(e) {}
                        delete SyncEngine.webrtc.peers[targetId];
                        return;
                    }
                    SyncEngine.ui.setStatus('P2P Established!', true);
                }
            };
            pc.createOffer().then(function(offer) {
                pc.setLocalDescription(offer);
                SyncEngine.webrtc._sendSignal(targetId, { sdp: offer });
            });
            setTimeout(function() {
                if (!relayFired && pc.connectionState !== 'connected' && pc.iceConnectionState !== 'connected') {
                    relayFired = true;
                    SyncEngine.webrtc._relayUsedFor[targetId] = true;
                    SyncEngine.ui.setStatus('P2P slow, using Relay Sync...');
                    var opts = SyncEngine.ui._getOptions();
                    var data = SyncEngine.exportData(opts);
                    SyncEngine.webrtc._sendRelay(targetId, data);
                }
            }, 6000);
        },

        _createPeerConnection: function(targetId) {
            var pc = new RTCPeerConnection({
                iceServers: [
                    {urls: 'stun:stun.l.google.com:19302'},
                    {urls: 'stun:stun1.l.google.com:19302'},
                    {urls: 'stun:stun2.l.google.com:19302'}
                ]
            });
            this.peers[targetId] = pc;
            this._iceQueue[targetId] = { pending: [], remoteSet: false };
            pc.oniceconnectionstatechange = function() {
                if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
                    SyncEngine.ui.setStatus('P2P Failed. Use QR Sync instead.', false);
                    try { pc.close(); } catch(e) {}
                    for (var k in SyncEngine.webrtc.peers) {
                        if (SyncEngine.webrtc.peers[k] === pc) { delete SyncEngine.webrtc.peers[k]; break; }
                    }
                }
            };
            var self = this;
            pc.onicecandidate = function(e) {
                if (e.candidate) self._sendSignal(targetId, { ice: e.candidate });
            };
            pc.ondatachannel = function(e) {
                if (window.showToast) window.showToast('Sync connection from ' + (self.devices[targetId] ? self.devices[targetId].name : 'another device'));
                self._setupChannel(e.channel, targetId);
            };
            return pc;
        },

        _handleSignal: function(payload) {
            var fromId = payload.from;
            var pc = this.peers[fromId];
            if (!pc) pc = this._createPeerConnection(fromId);
            if (payload.sdp) {
                var self = this;
                pc.setRemoteDescription(new RTCSessionDescription(payload.sdp)).then(function() {
                    if (self._iceQueue[fromId]) {
                        self._iceQueue[fromId].remoteSet = true;
                        var pending = self._iceQueue[fromId].pending;
                        self._iceQueue[fromId].pending = [];
                        pending.forEach(function(candidate) {
                            pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(function(err) {
                                console.warn('Deferred ICE candidate add failed:', err);
                            });
                        });
                    }
                    if (payload.sdp.type === 'offer') {
                        SyncEngine.ui.setStatus('Incoming connection from ' + (SyncEngine.webrtc.devices[fromId] ? SyncEngine.webrtc.devices[fromId].name : fromId) + '...');
                        pc.createAnswer().then(function(answer) {
                            pc.setLocalDescription(answer);
                            SyncEngine.webrtc._sendSignal(fromId, { sdp: answer });
                        });
                    }
                });
            } else if (payload.ice) {
                if (this._iceQueue[fromId] && !this._iceQueue[fromId].remoteSet) {
                    this._iceQueue[fromId].pending.push(payload.ice);
                } else {
                    pc.addIceCandidate(new RTCIceCandidate(payload.ice)).catch(function(err) {
                        console.warn('ICE candidate add failed:', err);
                    });
                }
            }
        },

        _sendSignal: function(targetId, data) {
            if (!this.mqttClient) return;
            try {
                var PahoMsg = this._getPahoMsg();
                if (!PahoMsg) return;
                var msg = new PahoMsg(JSON.stringify(Object.assign({ type: 'signal', from: this.deviceId, target: targetId }, data)));
                msg.destinationName = 'quiztool/sync/v2/' + this.roomHash + '/signal/' + targetId;
                this.mqttClient.send(msg);
            } catch(e) { console.error('Signal send failed:', e); }
        },

        _sendRelay: function(targetId, data, isResponse) {
            if (!this.mqttClient) return;
            try {
                var PahoMsg = this._getPahoMsg();
                if (!PahoMsg) return;
                if (data.length > SyncProtocol.MQTT_RELAY_MAX) {
                    console.error('Relay payload too large for MQTT:', data.length);
                    SyncEngine.ui.setStatus('Data too large for Relay. Use QR or File sync instead.', false);
                    if (window.showToast) window.showToast('Data too large for Relay sync. Please use QR or File sync instead.');
                    return;
                }
                if (data.length > 65536) {
                    console.warn('Relay payload large:', data.length);
                    SyncEngine.ui.setStatus('Large data: Relay may be slow...');
                }
                var msg = new PahoMsg(JSON.stringify({
                    type: 'relay', sender: this.deviceId, target: targetId, data: data, isResponse: !!isResponse
                }));
                msg.destinationName = 'quiztool/sync/v2/' + this.roomHash + '/relay/' + targetId;
                this.mqttClient.send(msg);
                if (!isResponse) SyncEngine.ui.setStatus('Sync sent via Relay!', true);
            } catch(e) { console.error('Relay failed:', e); }
        },

        _clearReassembly: function(peerId) {
            if (this._reassembly[peerId]) {
                if (this._reassembly[peerId].timeout) clearTimeout(this._reassembly[peerId].timeout);
                delete this._reassembly[peerId];
            }
        },

        _startReassemblyTimeout: function(peerId) {
            var self = this;
            this._reassembly[peerId].timeout = setTimeout(function() {
                console.warn('Reassembly timeout for', peerId);
                var ra = self._reassembly[peerId];
                if (ra && ra.chunks) {
                    var receivedChunks = 0;
                    for (var i = 1; i <= ra.total; i++) { if (ra.chunks[i]) receivedChunks++; }
                    console.error('Discarding incomplete reassembly: got', receivedChunks, 'of', ra.total, 'chunks from', peerId);
                    delete self._reassembly[peerId];
                    SyncEngine.ui.setStatus('Transfer timed out. Please try again.', false);
                    if (window.showToast) window.showToast('Sync failed: transfer timed out.');
                }
            }, 30000);
        },

        _handleReassembledFrame: function(peerId, frame) {
            var parsed = SyncProtocol.parseP2PFrame(frame);
            if (parsed === 'END') {
                var ra = this._reassembly[peerId];
                if (!ra || !ra.chunks) { this._clearReassembly(peerId); return; }
                var full = '';
                var missing = false;
                for (var i = 1; i <= ra.total; i++) {
                    if (!ra.chunks[i]) { missing = true; console.warn('Missing chunk', i, 'from', peerId); }
                    else full += ra.chunks[i];
                }
                this._clearReassembly(peerId);
                if (missing) {
                    console.error('Cannot reassemble: missing chunks from', peerId);
                    SyncEngine.ui.setStatus('Transfer incomplete — some data was lost.', false);
                    if (window.showToast) window.showToast('Sync failed: data incomplete. Try again.');
                    return;
                }
                if (full.length > 0) {
                    console.log('Reassembled', full.length, 'bytes from', ra.total, 'chunks');
                    this._processIncomingP2PData(peerId, full);
                }
                return;
            }
            if (!parsed) {
                console.warn('Discarding invalid P2P frame from', peerId);
                return;
            }
            var ra2 = this._reassembly[peerId];
            if (!ra2 || ra2.total !== parsed.total) {
                this._clearReassembly(peerId);
                ra2 = { chunks: {}, total: parsed.total, timeout: null };
                this._reassembly[peerId] = ra2;
                this._startReassemblyTimeout(peerId);
            }
            ra2.chunks[parsed.seq] = parsed.data;
            var gotAll = true;
            for (var j = 1; j <= ra2.total; j++) { if (!ra2.chunks[j]) { gotAll = false; break; } }
        },

        _setupChannel: function(channel, targetId) {
            var sentData = false;
            var self = this;
            var sendData = function() {
                if (sentData) return;
                sentData = true;
                if (self.pullOnly) {
                    SyncEngine.ui.setStatus('Pull-Only: Receiving only.', true);
                    return;
                }
                if (self._relayUsedFor[targetId]) {
                    console.log('Relay already used for', targetId, '— skipping P2P send');
                    return;
                }
                SyncEngine.ui.setStatus('Connected! Transferring data...', true);
                var opts = SyncEngine.ui._getOptions();
                var wire = SyncEngine.exportData(opts);
                var totalBytes = wire.length;
                var frames = SyncProtocol.frameForP2P(wire);
                var fi = 0;
                var sendNext = function() {
                    if (fi >= frames.length) {
                        SyncEngine.ui.updateTransferProgress(totalBytes, totalBytes);
                        SyncEngine.ui.setStatus('Data sent successfully!', true);
                        return;
                    }
                    channel.send(frames[fi]);
                    fi++;
                    var progress = Math.min(totalBytes, Math.round((fi / frames.length) * totalBytes));
                    SyncEngine.ui.updateTransferProgress(progress, totalBytes);
                    if (channel.bufferedAmount > 1048576) setTimeout(sendNext, 50);
                    else setTimeout(sendNext, 0);
                };
                sendNext();
            };
            if (channel.readyState === 'open') sendData();
            else channel.onopen = sendData;
            channel.onmessage = function(e) {
                var raw = e.data;
                if (typeof raw !== 'string') { console.warn('Non-string DataChannel message received'); return; }
                if (raw.startsWith(SyncProtocol.P2P_PREFIX) || raw === SyncProtocol.P2P_END) {
                    self._handleReassembledFrame(targetId, raw);
                    return;
                }
                console.warn('Discarding unframed P2P message from', targetId, '(length:', raw.length, ')');
            };
        },

        _processIncomingP2PData: function(fromId, wireData) {
            this._clearReassembly(fromId);
            this._cleanExpiredPendingSyncs();
            var isTrusted = fromId ? SyncEngine._isTrustedDevice(fromId) : false;
            if (!isTrusted && fromId && !this._pendingSyncs[fromId]) {
                var preview = SyncProtocol.preview(wireData);
                this._pendingSyncs[fromId] = { type: 'p2p-data', data: wireData, createdAt: Date.now() };
                SyncEngine.ui.showConfirmToast(fromId, this.devices[fromId] ? this.devices[fromId].name : 'Unknown', preview);
                return;
            }
            SyncEngine.ui.setStatus('Receiving data...', true);
            var success = SyncEngine.importData(wireData, 'merge');
            if (success) {
                SyncEngine.ui.setStatus('Data received and merged successfully!', true);
                if (window.showToast) window.showToast('P2P Sync complete!');
                if (window.renderQuizzes) window.renderQuizzes();
            } else {
                SyncEngine.ui.setStatus('Failed to import received data.', false);
            }
            delete this._relayUsedFor[fromId];
        }
    },

    // --- UI Implementation ---
    ui: {
        modalEl: null,
        scanner: null,
        _qrTimer: null,
        _qrInstance: null,
        _cameras: [],
        _currentCameraIndex: 0,
        _useFront: false,
        _scanChunks: {},
        _scopeModalEl: null,

        _createModalHTML: function() {
            return `
            <div class="dash-overlay" id="sync-dashboard">
                <div class="dash-modal" style="max-width: 580px;">
                    <div class="dash-header">
                        <h2>🔄 Sync Progress</h2>
                        <button class="dash-close-btn" onclick="SyncEngine.ui.closeModal()">✕</button>
                    </div>
                    <div class="dash-scope-bar" style="display:flex; overflow-x:auto;">
                        <button class="dash-scope-tab active" id="sync-tab-btn-webrtc" onclick="SyncEngine.ui.switchTab('webrtc')">📡 Nearby Devices</button>
                        <button class="dash-scope-tab" id="sync-tab-btn-qr" onclick="SyncEngine.ui.switchTab('qr')">📷 QR Sync</button>
                        <button class="dash-scope-tab" id="sync-tab-btn-file" onclick="SyncEngine.ui.switchTab('file')">📁 File</button>
                    </div>
                    <div class="dash-body" style="min-height: 280px; position: relative;">
                        <div id="sync-tab-webrtc" style="display: block; overflow: hidden;">
                            <div style="text-align: center; margin-bottom: 1.5rem;">
                                <div id="sync-webrtc-radar-container" style="display: inline-block; padding: 10px; overflow: visible;">
                                    <div id="sync-webrtc-radar" style="font-size: 2.5rem; animation: pulse 2s infinite; transform-origin: center;">📡</div>
                                </div>
                                <p style="color: var(--text-muted); font-size: 0.95rem; margin-top: 0.5rem;">Looking for devices on the same network...</p>
                            <div style="display: flex; align-items: center; justify-content: center; gap: 1.5rem; margin-bottom: 0.75rem; padding: 0.4rem 1rem;">
                                <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-size: 0.9rem; color: var(--text);"><span>🔒</span> Pull Only <input type="checkbox" id="sync-pull-only-toggle" ${SyncEngine.webrtc.pullOnly ? 'checked' : ''} onchange="SyncEngine.webrtc.setPullOnly(this.checked)" style="accent-color: var(--accent); transform: scale(1.1);"></label>
                                <button class="btn-dash-action" onclick="SyncEngine.ui.openScopeModal()" style="font-size: 0.85rem; padding: 0.4rem 0.8rem;">⚙ Configure Scope</button>
                            </div>
                                <div style="display: flex; justify-content: center; gap: 15px; margin-top: 4px;">
                                    <div id="sync-room-id" style="font-size: 0.7rem; color: var(--text-muted); opacity: 0.6;">Room ID: Identifying...</div>
                                    <div id="sync-local-name" style="font-size: 0.7rem; color: var(--accent); font-weight: 600; opacity: 0.8;">My Name: ...</div>
                                </div>
                            </div>
                            <div id="sync-webrtc-device-list" style="display: flex; flex-direction: column; gap: 0.6rem; max-height: 200px; overflow-y: auto;"></div>
                            <div id="sync-webrtc-status" style="margin-top: 1rem; text-align: center; font-size: 0.8rem; font-weight: 600; min-height: 1.2em;"></div>
                            <div id="sync-confirm-toast-container" style="position: absolute; bottom: 0; left: 0; right: 0; z-index: 10;"></div>
                            <div id="sync-transfer-progress" style="display: none; margin-bottom: 0.75rem; padding: 0 1rem;">
                                <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px;">
                                    <span id="sync-transfer-label">Transferring...</span>
                                    <span id="sync-transfer-percent">0%</span>
                                </div>
                                <div style="width: 100%; height: 8px; background: var(--surface2); border-radius: 4px; overflow: hidden; border: 1px solid var(--border);">
                                    <div id="sync-transfer-bar" style="width: 0%; height: 100%; background: var(--accent); transition: width 0.3s ease; border-radius: 3px;"></div>
                                </div>
                            </div>
                            <style>
                                @keyframes pulse { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.15); opacity: 0.7; } 100% { transform: scale(1); opacity: 1; } }
                                @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                                .device-item { display: flex; align-items: center; justify-content: space-between; padding: 0.85rem 1.25rem; background: var(--surface2); border: 1px solid var(--border); border-radius: 12px; transition: border-color 0.2s; }
                                .device-item:hover { border-color: var(--accent); }
                                .device-name { font-weight: 600; font-size: 1rem; color: var(--text); }
                            </style>
                        </div>
                        <div id="sync-tab-qr" style="display: none; text-align: center;">
                            <div id="sync-qr-export-section">
                                <p style="margin-bottom: 1rem; color: var(--text-muted); font-size: 0.95rem;">Scan this code from another device.</p>
                                <div id="sync-qr-container" style="display: inline-block; padding: 1.25rem; background: #fff; border-radius: 12px; margin-bottom: 1rem;"></div>
                                <div id="sync-qr-pagination" style="margin-top: 10px; font-size: 0.85rem; display: none; margin-bottom: 15px;">
                                    <button class="btn-dash-action" onclick="SyncEngine.ui.prevQR()" style="padding: 0.3rem 0.6rem;"><</button>
                                    <span id="sync-qr-page-info" style="margin: 0 10px; font-weight: 600;">1 / 1</span>
                                    <button class="btn-dash-action" onclick="SyncEngine.ui.nextQR()" style="padding: 0.3rem 0.6rem;">></button>
                                </div>
                                <div style="margin-top: 1rem; border-top: 1px solid var(--border); padding-top: 1.5rem;">
                                    <button class="btn-dash-action" onclick="SyncEngine.ui.toggleQRScanner(true)">📷 Scan Another Device</button>
                                </div>
                            </div>
                            <div id="sync-qr-scan-section" style="display: none;">
                                <p style="margin-bottom: 1rem; color: var(--text-muted); font-size: 0.95rem;">Point your camera at a QR code.</p>
                                <div id="sync-reader" style="width: 100%; max-width: 320px; margin: 0 auto; border-radius: 12px; overflow: hidden; border: 1px solid var(--border); position: relative;"></div>
                                <div id="sync-camera-controls" style="margin-top: 10px; display: none;">
                                    <button class="btn-dash-action" id="sync-switch-camera-btn" onclick="SyncEngine.ui.switchCamera()" style="font-size: 0.8rem; padding: 0.4rem 0.8rem;">🔄 Switch Camera</button>
                                </div>
                                <div id="sync-scan-progress" style="margin-top: 1.25rem; font-weight: 600; font-size: 0.9rem; color: var(--accent); display: none;">
                                    Scanning: <span id="sync-scan-count">0</span> / <span id="sync-scan-total">?</span> parts
                                    <div style="width: 100%; height: 6px; background: var(--surface2); border-radius: 3px; margin-top: 8px; overflow: hidden; border: 1px solid var(--border);">
                                        <div id="sync-scan-bar" style="width: 0%; height: 100%; background: var(--accent); transition: width 0.3s ease;"></div>
                                    </div>
                                </div>
                                <div style="margin-top: 1.5rem;">
                                    <button class="btn-dash-action" onclick="SyncEngine.ui.toggleQRScanner(false)">🔙 Show My Code</button>
                                </div>
                            </div>
                        </div>
                        <div id="sync-tab-file" style="display: none; text-align: center;">
                            <div style="padding: 1.5rem; background: var(--surface2); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 1rem;">
                                <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📥</div>
                                <p style="font-weight: 600; margin-bottom: 0.25rem; color: var(--text);">Backup Progress</p>
                                <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1rem;">Save your current progress offline to a secure file.</p>
                                <button class="btn-dash-action" onclick="SyncEngine.ui.downloadBackup()">Download Backup</button>
                            </div>
                            <div style="padding: 1.5rem; background: var(--surface2); border: 1px dashed var(--border); border-radius: 12px;">
                                <div style="font-size: 2.2rem; margin-bottom: 0.5rem;">📁</div>
                                <p style="font-weight: 600; margin-bottom: 0.25rem; color: var(--text);">Restore Progress</p>
                                <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1rem;">Select a backup file to securely load your progress.</p>
                                <input type="file" id="sync-file-input" accept=".quizbackup,.txt,.json" style="display: none;" onchange="SyncEngine.ui.handleFileUpload(event)">
                                <button class="btn-dash-action" onclick="document.getElementById('sync-file-input').click()">Select File</button>
                                <div id="sync-file-restore-options" style="display: none; margin-top: 1.25rem; gap: 0.75rem; justify-content: center;">
                                    <button class="btn-dash-action" onclick="SyncEngine.ui.confirmFileRestore('merge')">Merge File</button>
                                    <button class="btn-dash-action btn-dash-danger" onclick="SyncEngine.ui.confirmFileRestore('replace')">Replace All</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
        },

        openModal: function() {
            if (!this.modalEl) {
                var wrap = document.createElement('div');
                wrap.innerHTML = this._createModalHTML();
                this.modalEl = wrap.firstElementChild;
                document.body.appendChild(this.modalEl);
            }
            this.modalEl.classList.add('open');
            this.switchTab('webrtc');
        },

        closeModal: function() {
            if (this.modalEl) {
                this.modalEl.classList.remove('open');
                this.stopScanner();
                this.stopQRAnimation();
                this._scanChunks = {};
            }
            this.closeScopeModal();
            if (SyncEngine.webrtc.heartbeatInterval) {
                clearInterval(SyncEngine.webrtc.heartbeatInterval);
                SyncEngine.webrtc.heartbeatInterval = null;
            }
            if (SyncEngine.webrtc.mqttClient) {
                if (SyncEngine.webrtc.disconnectTimeout) clearTimeout(SyncEngine.webrtc.disconnectTimeout);
                SyncEngine.webrtc.disconnectTimeout = setTimeout(function() {
                    if (SyncEngine.webrtc.mqttClient) {
                        try { SyncEngine.webrtc.mqttClient.disconnect(); } catch(e) {}
                        SyncEngine.webrtc.mqttClient = null;
                        SyncEngine.webrtc._discovering = false;
                        SyncEngine.webrtc.devices = {};
                    }
                    SyncEngine.webrtc.disconnectTimeout = null;
                }, 60000);
            }
        },

        switchTab: function(tabId) {
            this.stopScanner();
            this.stopQRAnimation();
            ['webrtc', 'qr', 'file'].forEach(function(id) {
                var btn = document.getElementById('sync-tab-btn-' + id);
                var content = document.getElementById('sync-tab-' + id);
                if (btn) { if (id === tabId) btn.classList.add('active'); else btn.classList.remove('active'); }
                if (content) content.style.display = (id === tabId) ? 'block' : 'none';
            });
            if (tabId === 'qr') {
                this._scanChunks = {};
                this.toggleQRScanner(false);
                SyncEngine._ensureQRCode().then(() => {
                    this.renderQR();
                    this.startQRAnimation();
                }).catch(function() {
                    var el = document.getElementById('sync-qr-container');
                    if (el) el.innerHTML = '<span style="color:var(--wrong)">Failed to load QR library. Check your internet connection.</span>';
                });
            }
            if (tabId === 'webrtc') {
                SyncEngine.webrtc.initDiscovery();
                if (SyncEngine.webrtc.mqttClient) { SyncEngine.webrtc.broadcastPresence(); SyncEngine.webrtc._startHeartbeat(); }
                this.updateDeviceList();
            }
            if (tabId === 'file') {
                var restoreOpts = document.getElementById('sync-file-restore-options');
                if (restoreOpts) restoreOpts.style.display = 'none';
            }
        },

        toggleQRScanner: function(show) {
            var exportSec = document.getElementById('sync-qr-export-section');
            var scanSec = document.getElementById('sync-qr-scan-section');
            if (show) {
                exportSec.style.display = 'none';
                scanSec.style.display = 'block';
                SyncEngine._ensureHtml5Qrcode().then(() => { this.startScanner(); }).catch(function() {
                    var el = document.getElementById('sync-reader');
                    if (el) el.innerHTML = '<div style="padding: 1rem; color: var(--wrong);">Failed to load QR scanner. Check your internet connection.</div>';
                });
            } else {
                this.stopScanner();
                exportSec.style.display = 'block';
                scanSec.style.display = 'none';
            }
        },

        updateDeviceList: function() {
            var listEl = document.getElementById('sync-webrtc-device-list');
            if (!listEl) return;
            var now = Date.now();
            var html = '';
            var count = 0;
            for (var id in SyncEngine.webrtc.devices) {
                if (!SyncEngine.webrtc.devices.hasOwnProperty(id)) continue;
                var dev = SyncEngine.webrtc.devices[id];
                if (now - dev.lastSeen > 15000) { delete SyncEngine.webrtc.devices[id]; continue; }
                count++;
                var isTrusted = SyncEngine._isTrustedDevice(id);
                var trustedBadge = isTrusted ? '<span style="font-size:0.7rem;padding:2px 6px;border-radius:6px;font-weight:600;margin-left:6px;background:rgba(255,193,7,0.15);color:#ffc107;">⭐ Trusted</span>' : '';
                var pullOnlyBadge = dev.pullOnly ? '<span style="font-size:0.7rem;padding:2px 6px;border-radius:6px;font-weight:600;margin-left:6px;background:rgba(33,150,243,0.15);color:#2196f3;">🔒 Pull Only</span>' : '';
                html += '<div class="device-item"><div class="device-info"><div class="device-name">📱 ' + dev.name + trustedBadge + pullOnlyBadge + '</div><div style="font-size: 0.75rem; color: var(--text-muted);">Local Network Device</div></div><button class="btn-dash-action" onclick="SyncEngine.webrtc.connectToDevice(\'' + id + '\')">Sync</button></div>';
            }
            if (count === 0) html = '<p style="text-align: center; color: var(--text-muted); font-size: 0.9rem; padding: 1.5rem 1rem;">No devices found. Ensure other devices have the Sync modal open and are connected to the internet on the same WiFi network.</p>';
            listEl.innerHTML = html;
        },

        showConfirmToast: function(fromId, fromName, preview) {
            var container = document.getElementById('sync-confirm-toast-container');
            if (!container) return;
            var existing = document.getElementById('sync-confirm-' + fromId);
            if (existing) existing.remove();
            var previewHTML = '';
            if (preview) {
                previewHTML = '<div style="margin:0.5rem 0;padding:0.5rem;background:var(--surface1);border-radius:8px;font-size:0.8rem;color:var(--text-muted);">'
                    + '<div style="font-weight:600;margin-bottom:4px;color:var(--text);">Import Preview:</div>'
                    + (preview.trackerCount > 0 ? '<div>📊 ' + preview.trackerCount + ' tracker(s)</div>' : '')
                    + (preview.progressCount > 0 ? '<div>📈 ' + preview.progressCount + ' progress record(s)</div>' : '')
                    + (preview.subjects.length > 0 ? '<div style="margin-top:4px;">Subjects: ' + preview.subjects.map(function(s){return s.name;}).join(', ') + '</div>' : '')
                    + '</div>';
            }
            var el = document.createElement('div');
            el.id = 'sync-confirm-' + fromId;
            el.style.cssText = 'background:var(--surface2);border:1px solid var(--border);border-radius:12px;padding:1rem;margin:0.5rem;box-shadow:0 -2px 12px rgba(0,0,0,0.2);animation:slideUp 0.3s ease;';
            el.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;"><div style="font-weight:600;color:var(--text);font-size:0.95rem;">📱 Incoming Sync</div><div style="font-size:0.8rem;color:var(--accent);">from <strong>' + fromName + '</strong></div></div>'
                + previewHTML
                + '<label style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;color:var(--text-muted);margin:0.5rem 0;cursor:pointer;"><input type="checkbox" id="sync-trust-' + fromId + '" style="accent-color:var(--accent);"> Always trust this device</label>'
                + '<div style="display:flex;gap:0.5rem;justify-content:flex-end;">'
                + '<button class="btn-dash-action btn-dash-danger" onclick="SyncEngine.webrtc.declineSync(\'' + fromId + '\')" style="font-size:0.85rem;padding:0.4rem 1rem;">Decline</button>'
                + '<button class="btn-dash-action" onclick="SyncEngine.webrtc.acceptSync(\'' + fromId + '\', document.getElementById(\'sync-trust-' + fromId + '\').checked)" style="font-size:0.85rem;padding:0.4rem 1rem;background:var(--correct);color:#fff;">Accept</button>'
                + '</div>';
            container.appendChild(el);
        },

        updateTransferProgress: function(bytesTransferred, totalBytes) {
            var container = document.getElementById('sync-transfer-progress');
            var bar = document.getElementById('sync-transfer-bar');
            var label = document.getElementById('sync-transfer-label');
            var percent = document.getElementById('sync-transfer-percent');
            if (!container || !bar) return;
            container.style.display = 'block';
            var pct = totalBytes > 0 ? Math.round((bytesTransferred / totalBytes) * 100) : 0;
            bar.style.width = pct + '%';
            if (percent) percent.textContent = pct + '%';
            var fmt = function(b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(1) + ' KB' : (b/1048576).toFixed(1) + ' MB'; };
            if (label) label.textContent = fmt(bytesTransferred) + ' / ' + fmt(totalBytes);
            if (bytesTransferred >= totalBytes) setTimeout(function(){ container.style.display = 'none'; }, 2000);
        },

        hideConfirmToast: function(fromId) {
            var el = document.getElementById('sync-confirm-' + fromId);
            if (el) el.remove();
        },

        setStatus: function(msg, isSuccess) {
            var el = document.getElementById('sync-webrtc-status');
            if (!el) return;
            el.innerText = msg;
            if (isSuccess === true) el.style.color = 'var(--correct)';
            else if (isSuccess === false) el.style.color = 'var(--wrong)';
            else el.style.color = 'var(--accent)';
        },

        setRoomId: function(id) {
            var el = document.getElementById('sync-room-id');
            if (el) el.innerText = 'Room ID: ' + id;
            var nameEl = document.getElementById('sync-local-name');
            if (nameEl) nameEl.innerText = 'My Name: ' + SyncEngine.webrtc.deviceName;
        },

        _getSubjectList: function() {
            var subjects = [];
            try {
                var keys = JSON.parse(localStorage.getItem('quiz_tracker_keys') || '[]');
                for (var i = 0; i < keys.length; i++) {
                    var uid = keys[i];
                    var raw = localStorage.getItem('quiz_tracker_v2_' + uid);
                    if (!raw) continue;
                    try {
                        var d = JSON.parse(raw);
                        subjects.push({ uid: uid, name: d.title || d.name || uid, trackedCount: (d.wrong||[]).length + (d.flagged||[]).length });
                    } catch(e) { subjects.push({ uid: uid, name: uid, trackedCount: 0 }); }
                }
            } catch(e) {}
            return subjects;
        },
        _getSavedScope: function() {
            try { return JSON.parse(localStorage.getItem('quiztool_sync_scope') || '{}'); } catch(e) { return {}; }
        },
        _saveScope: function(scope) {
            try { localStorage.setItem('quiztool_sync_scope', JSON.stringify(scope)); } catch(e) {}
        },

        openScopeModal: function() {
            this.closeScopeModal();
            var subjects = this._getSubjectList();
            var saved = this._getSavedScope();
            var savedSubjects = saved.subjects || [];
            var html = '<div class="dash-overlay open" style="z-index:2200;" onclick="if(event.target===this)SyncEngine.ui.closeScopeModal()">'
                + '<div class="dash-modal" style="max-width:380px;">'
                + '<div class="dash-header"><h2>⚙ Sync Scope</h2><button class="dash-close-btn" onclick="SyncEngine.ui.closeScopeModal()">✕</button></div>'
                + '<div class="dash-body" style="padding:0.75rem 1.25rem;">';
            for (var i = 0; i < subjects.length; i++) {
                var s = subjects[i];
                var chk = savedSubjects.length === 0 || savedSubjects.indexOf(s.uid) !== -1 ? 'checked' : '';
                html += '<label style="display:flex;align-items:center;gap:0.5rem;padding:0.6rem 0;cursor:pointer;font-size:0.9rem;color:var(--text);border-bottom:1px solid var(--border);"><input type="checkbox" class="sync-scope-subject-cb" data-uid="' + s.uid + '" ' + chk + ' style="accent-color:var(--accent);"> <span style="flex:1;">' + s.name + '</span><span style="font-size:0.75rem;color:var(--text-muted);">' + s.trackedCount + ' tracked</span></label>';
            }
            if (subjects.length === 0) html += '<p style="color:var(--text-muted);font-size:0.85rem;padding:1rem 0;text-align:center;">No subjects with tracker data found.</p>';
            var progChk = saved.progress !== false ? 'checked' : '';
            html += '<div style="border-top:2px solid var(--border);margin-top:0.5rem;padding-top:0.5rem;">'
                + '<label style="display:flex;align-items:center;gap:0.5rem;padding:0.6rem 0;cursor:pointer;font-size:0.9rem;color:var(--text);"><input type="checkbox" id="sync-scope-progress-cb" ' + progChk + ' style="accent-color:var(--accent);"> Active Progress</label></div>'
                + '</div>'
                + '<div style="display:flex;gap:0.5rem;padding:0.75rem 1.25rem;border-top:1px solid var(--border);justify-content:space-between;">'
                + '<button class="btn-dash-action" onclick="SyncEngine.ui.toggleAllSubjects()">Select All</button>'
                + '<button class="btn-dash-action" onclick="SyncEngine.ui.applyScopeAndClose()">Done</button></div>'
                + '</div></div>';
            var wrap = document.createElement('div');
            wrap.innerHTML = html;
            this._scopeModalEl = wrap.firstElementChild;
            document.body.appendChild(this._scopeModalEl);
        },

        closeScopeModal: function() {
            if (this._scopeModalEl) { this._scopeModalEl.remove(); this._scopeModalEl = null; }
        },

        toggleAllSubjects: function() {
            var cbs = document.querySelectorAll('.sync-scope-subject-cb');
            var allChecked = Array.from(cbs).every(function(cb){return cb.checked;});
            cbs.forEach(function(cb){cb.checked = !allChecked;});
        },

        applyScopeAndClose: function() {
            var subjects = [];
            var cbs = document.querySelectorAll('.sync-scope-subject-cb');
            cbs.forEach(function(cb){ if (cb.checked) subjects.push(cb.dataset.uid); });
            var progressEl = document.getElementById('sync-scope-progress-cb');
            var allSubjects = this._getSubjectList();
            var scopeSubjects = subjects.length === allSubjects.length ? [] : subjects;
            this._saveScope({ subjects: scopeSubjects, progress: progressEl ? progressEl.checked : true });
            this.closeScopeModal();
            if (window.showToast) window.showToast('Sync scope updated!');
        },

        _getOptions: function() {
            var scope = this._getSavedScope();
            return { tracker: true, progress: scope.progress !== false, subjects: scope.subjects || [] };
        },

        downloadBackup: function() {
            var data = SyncEngine.exportData(this._getOptions());
            var blob = new Blob([data], { type: 'text/plain' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            var date = new Date().toISOString().split('T')[0];
            a.href = url;
            a.download = 'QuizProgress_Backup_' + date + '.quizbackup';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        },

        _pendingFileContent: null,

        handleFileUpload: function(event) {
            var file = event.target.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = (function(e) {
                this._pendingFileContent = e.target.result;
                var restoreOpts = document.getElementById('sync-file-restore-options');
                if (restoreOpts) restoreOpts.style.display = 'flex';
                if (window.showToast) window.showToast('File loaded. Choose restore method.');
            }).bind(this);
            reader.readAsText(file);
            event.target.value = '';
        },

        confirmFileRestore: function(mode) {
            if (!this._pendingFileContent) return;
            if (SyncEngine.importData(this._pendingFileContent, mode)) {
                if (window.showToast) window.showToast('File Sync successful!');
                this.closeModal();
                if (window.renderQuizzes) window.renderQuizzes();
            } else {
                if (window.showToast) window.showToast('Import failed: File may be corrupted or invalid.');
            }
            this._pendingFileContent = null;
            var restoreOpts = document.getElementById('sync-file-restore-options');
            if (restoreOpts) restoreOpts.style.display = 'none';
        },

        qrChunks: [],
        qrPage: 0,

        renderQR: function() {
            var container = document.getElementById('sync-qr-container');
            var pagination = document.getElementById('sync-qr-pagination');
            if (!container) return;
            container.innerHTML = '';
            var fullData = SyncEngine.exportData(this._getOptions());
            this._qrInstance = null;
            this.qrChunks = SyncProtocol.frameForQR(fullData);
            if (pagination) pagination.style.display = this.qrChunks.length > 1 ? 'block' : 'none';
            this.qrPage = 0;
            this._drawCurrentQR();
        },

        startQRAnimation: function() {
            this.stopQRAnimation();
            if (this.qrChunks.length <= 1) return;
            this._qrTimer = setInterval(() => {
                this.qrPage = (this.qrPage + 1) % this.qrChunks.length;
                this._drawCurrentQR();
            }, 3000);
        },

        stopQRAnimation: function() {
            if (this._qrTimer) { clearInterval(this._qrTimer); this._qrTimer = null; }
        },

        _drawCurrentQR: function() {
            var container = document.getElementById('sync-qr-container');
            var pageInfo = document.getElementById('sync-qr-page-info');
            if (!container) return;
            var data = this.qrChunks[this.qrPage];
            if (pageInfo) pageInfo.innerText = (this.qrPage + 1) + ' / ' + this.qrChunks.length;
            try {
                if (!this._qrInstance) {
                    container.innerHTML = '';
                    this._qrInstance = new QRCode(container, {
                        text: data, width: 256, height: 256,
                        colorDark: '#000000', colorLight: '#ffffff',
                        correctLevel: QRCode.CorrectLevel.L
                    });
                } else { this._qrInstance.makeCode(data); }
            } catch(e) { container.innerHTML = '<span style="color:red">QR Generation failed.</span>'; }
        },

        nextQR: function(fromSignal) {
            if (this.qrChunks.length <= 1) return;
            this.qrPage = (this.qrPage + 1) % this.qrChunks.length;
            this._drawCurrentQR();
        },

        prevQR: function() {
            if (this.qrPage > 0) { this.qrPage--; this._drawCurrentQR(); }
        },

        _updateScanProgress: function(current, total) {
            var progSec = document.getElementById('sync-scan-progress');
            var countEl = document.getElementById('sync-scan-count');
            var totalEl = document.getElementById('sync-scan-total');
            var barEl = document.getElementById('sync-scan-bar');
            if (progSec) progSec.style.display = 'block';
            if (countEl) countEl.innerText = current;
            if (totalEl) totalEl.innerText = total;
            if (barEl) barEl.style.width = (current / total * 100) + '%';
        },

        switchCamera: function() {
            if (this._cameras && this._cameras.length > 1) {
                this._currentCameraIndex = (this._currentCameraIndex + 1) % this._cameras.length;
                this._useFront = false;
            } else { this._useFront = !this._useFront; }
            this.stopScanner();
            this.startScanner();
        },

        startScanner: function() {
            if (this.scanner) return;
            var readerEl = document.getElementById('sync-reader');
            var switchBtn = document.getElementById('sync-camera-controls');
            if (!readerEl) return;
            if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
                readerEl.innerHTML = '<div style="padding: 2rem 1rem; color: var(--wrong);">⚠️ Camera requires HTTPS. Use File sync instead.</div>';
                return;
            }
            var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
            if (switchBtn && isMobile) switchBtn.style.display = 'block';
            var self = this;
            var startWithCamera = function(cameraIdOrConfig) {
                if (self.scanner) {
                    self.scanner.stop().then(function() { self.scanner = null; self.startScanner(); }).catch(function() {});
                    return;
                }
                self.scanner = new Html5Qrcode('sync-reader');
                self.scanner.start(
                    cameraIdOrConfig,
                    { fps: 15, qrbox: { width: 250, height: 250 } },
                    function(decodedText) {
                        var parsed = SyncProtocol.parseQRChunk(decodedText);
                        if (!parsed) return;
                        if (parsed.total === 1) {
                            self.stopScanner();
                            if (SyncEngine.importData(parsed.data, 'merge')) {
                                if (window.showToast) window.showToast('QR Scan Sync successful!');
                                self.closeModal();
                            }
                            return;
                        }
                        var firstData = parsed.seq === 1 ? parsed.data.substring(0, 20) : '';
                        var key = String(parsed.total) + '_' + (self._scanChunks._transferHash || firstData);
                        if (parsed.seq === 1 && firstData) self._scanChunks._transferHash = firstData;
                        if (!self._scanChunks[key]) self._scanChunks[key] = {};
                        self._scanChunks[key][String(parsed.seq)] = parsed.data;
                        var currentCount = Object.keys(self._scanChunks[key]).length;
                        self._updateScanProgress(currentCount, parsed.total);
                        if (SyncEngine.webrtc.mqttClient && SyncEngine.webrtc.roomHash) {
                            try {
                                var PahoMsg = SyncEngine.webrtc._getPahoMsg();
                                if (PahoMsg) {
                                    var ack = new PahoMsg(JSON.stringify({ type: 'qtp-ack', idx: String(parsed.seq), total: String(parsed.total), target: 'all' }));
                                    ack.destinationName = 'quiztool/sync/v2/' + SyncEngine.webrtc.roomHash + '/signal/all';
                                    SyncEngine.webrtc.mqttClient.send(ack);
                                }
                            } catch(e) {}
                        }
                        if (currentCount >= parsed.total) {
                            var full = '';
                            for (var i = 1; i <= parsed.total; i++) full += (self._scanChunks[key][String(i)] || '');
                            delete self._scanChunks[key];
                            self.stopScanner();
                            if (SyncEngine.importData(full, 'merge')) {
                                if (window.showToast) window.showToast('Multi-part QR Sync complete!');
                                self.closeModal();
                            }
                        }
                    },
                    function(errorMessage) {}
                ).then(function() {
                    Html5Qrcode.getCameras().then(function(cameras) {
                        self._cameras = cameras || [];
                        if (switchBtn && (isMobile || self._cameras.length > 1)) switchBtn.style.display = 'block';
                    }).catch(function() {});
                }).catch(function(err) {
                    console.error('Scanner start error:', err);
                    readerEl.innerHTML = '<div style="padding: 1rem; color: var(--wrong);">Scanner error: ' + err + '</div>';
                });
            };
            if (this._useFront) { startWithCamera({ facingMode: 'user' }); return; }
            if (this._cameras && this._cameras.length > 0) {
                if (this._currentCameraIndex >= this._cameras.length) this._currentCameraIndex = 0;
                startWithCamera(this._cameras[this._currentCameraIndex].id);
                return;
            }
            Html5Qrcode.getCameras().then(function(cameras) {
                self._cameras = cameras || [];
                if (switchBtn && (isMobile || self._cameras.length > 1)) switchBtn.style.display = 'block';
                if (self._cameras.length > 0) {
                    var bestIdx = -1;
                    if (self._cameras.length > 1 && self._currentCameraIndex === 0) {
                        bestIdx = self._cameras.findIndex(function(c) {
                            var l = c.label.toLowerCase();
                            return (l.includes('back') || l.includes('rear') || l.includes('environment')) && !l.includes('wide') && !l.includes('ultra');
                        });
                        if (bestIdx === -1) bestIdx = self._cameras.findIndex(function(c) {
                            var l = c.label.toLowerCase(); return l.includes('back') || l.includes('rear') || l.includes('environment');
                        });
                        if (bestIdx !== -1) self._currentCameraIndex = bestIdx;
                    }
                    startWithCamera(self._cameras[self._currentCameraIndex].id);
                } else { startWithCamera({ facingMode: 'environment' }); }
            }).catch(function(err) {
                console.warn('getCameras failed, using facingMode fallback', err);
                startWithCamera({ facingMode: 'environment' });
            });
        },

        stopScanner: function() {
            if (this.scanner) {
                var scannerRef = this.scanner;
                this.scanner = null;
                try {
                    scannerRef.stop().then(function() {
                        try { scannerRef.clear(); } catch(e) {}
                    }).catch(function() {
                        try { scannerRef.clear(); } catch(e) {}
                    });
                } catch(e) {
                    try { scannerRef.clear(); } catch(e2) {}
                }
            }
        }
    }
};

// [v3.3] Ensure SyncEngine and SyncProtocol are on window for dynamic script loading
// (const/let at top level of a <script> tag do NOT create window properties in spec-compliant browsers)
window.SyncProtocol = SyncProtocol;
window.SyncEngine = SyncEngine;

// [v3.3] Startup: clean any corrupted localStorage keys (empty strings) left from prior versions
(function() {
    try {
        var cleaned = 0;
        for (var i = localStorage.length - 1; i >= 0; i--) {
            var key = localStorage.key(i);
            if (!key) continue;
            var val = localStorage.getItem(key);
            if (val === '' && (
                key.startsWith('quiz_tracker_v2_') ||
                key.startsWith('quiz_progress_') ||
                key.startsWith('bank_progress_') ||
                key === 'quiz_tracker_keys'
            )) {
                localStorage.removeItem(key);
                cleaned++;
            }
        }
        if (cleaned > 0) console.log('[SyncEngine] Startup cleanup: removed', cleaned, 'corrupted empty-string keys from localStorage');
    } catch(e) { /* ignore */ }
})();
