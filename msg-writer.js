/*
 * msg-writer.js — Outlook .msg (OLE2 / CFB) file writer
 * ----------------------------------------------------------------------------
 * Builds a standalone Outlook message file (.msg) entirely in the browser,
 * using the SheetJS CFB library (global `CFB`, loaded via CDN before this file).
 *
 * Reference: [MS-OXMSG] .msg file format, [MS-OXPROPS] properties,
 *            [MS-OXRTFCP] RTF compression, [MS-OXRTFEX] HTML-in-RTF.
 *
 * Public API:
 *   MsgWriter.buildMsg(subject, htmlBodyStr, toAddrs, ccAddrs) -> Uint8Array
 *
 * WHY THIS FILE IS THE WAY IT IS (hard-won, verified against real Outlook):
 *   Outlook's MAPI reader rejects ("Cannot read the item") any .msg that is
 *   missing the message structure it expects. A minimal HTML-only message is
 *   NOT enough. To open, a .msg must contain ALL of:
 *     1. The named-property mapping storage __nameid_version1.0 (3 streams,
 *        may be empty).
 *     2. A valid compressed RTF body (PidTagRtfCompressed, 0x10090102). Outlook
 *        requires it even when HTML is present. We synthesise it by wrapping the
 *        HTML as encapsulated RTF (\fromhtml1) and LZFu-compressing it.
 *     3. A set of system properties: creation/modification time, search key,
 *        message flags, codepage, locale id, display to/cc/bcc, importance,
 *        sensitivity, subject + normalized subject + conversation topic, body.
 *     4. CORRECT STRING SIZES: for string properties the size recorded in
 *        __properties_version1.0 MUST count the terminating null (size =
 *        byte_length + 1 for PT_STRING8), even though the substream itself does
 *        NOT store the null. Recording the raw length makes Outlook reject it.
 *   Strings are written as PT_STRING8 (ANSI / Windows-1252) to match what
 *   Outlook itself emits with the olMSG format.
 *
 *   A stray 4-byte "\x01Sh33tJ5" stream appears at the root: SheetJS stamps it
 *   on every CFB it writes and it cannot be removed (CFB.write re-emits it). It
 *   is harmless — readers ignore unrecognised streams.
 */
(function (global) {
  'use strict';

  // ── Property type tags (PtypXxx) ──────────────────────────────────────────
  var PT_LONG = 0x0003, PT_BOOL = 0x000B, PT_TIME = 0x0040,
      PT_STRING8 = 0x001E, PT_BINARY = 0x0102;

  // ── Windows-1252 / Latin-1 encode (NO null terminator) ────────────────────
  function ansiBytes(str) {
    str = str || '';
    var b = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      b[i] = c <= 0xFF ? c : 0x3F; // '?' for chars outside Latin-1
    }
    return b;
  }

  function hex4(n) { return ('0000' + n.toString(16)).slice(-4).toUpperCase(); }
  function substgName(id, type) { return '__substg1.0_' + hex4(id) + hex4(type); }

  // ── Current time as a Windows FILETIME (100-ns ticks since 1601), 8 bytes LE
  function fileTimeNow() {
    var ft = (BigInt(Date.now()) + 11644473600000n) * 10000n;
    var b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, ft, true);
    return b;
  }

  // ── PidTagConversationIndex (0x0071): 1 header byte + 5-byte time + 16 GUID ─
  function conversationIndex() {
    var b = new Uint8Array(22);
    b[0] = 0x01;
    var ft = (BigInt(Date.now()) + 11644473600000n) * 10000n;
    var hi = Number((ft >> 16n) & 0xFFFFFFFFFFn);
    for (var i = 0; i < 5; i++) b[5 - i] = (hi >> (8 * i)) & 0xFF;
    crypto.getRandomValues(b.subarray(6));
    return b;
  }

  function randomBytes(n) { var b = new Uint8Array(n); crypto.getRandomValues(b); return b; }

  // ── HTML → plain text (for PidTagBody) ─────────────────────────────────────
  function htmlToText(html) {
    var t = html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return t.replace(/\n/g, '\r\n') + '\r\n';
  }

  // ── HTML → encapsulated RTF string (\fromhtml1) ────────────────────────────
  // The whole HTML is placed in a single \*\htmltag destination; Outlook
  // de-encapsulates it back to HTML for display.
  function htmlToRtf(html) {
    var esc = '';
    for (var i = 0; i < html.length; i++) {
      var ch = html[i], c = html.charCodeAt(i);
      if (ch === '\\') esc += '\\\\';
      else if (ch === '{') esc += '\\{';
      else if (ch === '}') esc += '\\}';
      else if (ch === '\r' || ch === '\n') esc += ' ';
      else if (c >= 0x20 && c < 0x80) esc += ch;
      else if (c <= 0xFF) esc += "\\'" + ('0' + c.toString(16)).slice(-2);
      else esc += '\\u' + (c > 0x7FFF ? c - 0x10000 : c) + '?';
    }
    return '{\\rtf1\\ansi\\ansicpg1252\\fromhtml1\\deff0' +
           '{\\fonttbl{\\f0\\fswiss Arial;}}\r\n' +
           '{\\*\\htmltag1 ' + esc + '}}';
  }

  // ── LZFu compression (MS-OXRTFCP), all-literal + end token ─────────────────
  // CRC-32 used by MS-OXRTFCP: standard poly 0xEDB88320, init 0, NO final XOR.
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function rtfCrc(buf) {
    var crc = 0;
    for (var i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
    return crc >>> 0;
  }
  var DICT_START = 207; // length of the MS-OXRTFCP preload dictionary
  function compressRtf(rtfStr) {
    var enc = new TextEncoder();
    var raw = enc.encode(rtfStr);
    var n = raw.length;
    var body = [];
    var i = 0;
    while (n - i >= 8) {            // groups of 8 literals, control byte 0x00
      body.push(0x00);
      for (var j = 0; j < 8; j++) body.push(raw[i + j]);
      i += 8;
    }
    var rem = n - i;                // final partial group + end token
    var writeOff = (DICT_START + n) & 0xFFF;
    body.push((1 << rem) & 0xFF);   // rem literal flags (0) then a dict-ref flag
    for (var k = 0; k < rem; k++) body.push(raw[i + k]);
    var token = (writeOff << 4) | 0; // offset == current write pos ⇒ END marker
    body.push((token >> 8) & 0xFF);
    body.push(token & 0xFF);

    var bodyArr = new Uint8Array(body);
    var out = new Uint8Array(16 + bodyArr.length);
    var dv = new DataView(out.buffer);
    dv.setUint32(0, bodyArr.length + 12, true); // COMPSIZE (everything after this field)
    dv.setUint32(4, n, true);                   // RAWSIZE
    out[8] = 0x4C; out[9] = 0x5A; out[10] = 0x46; out[11] = 0x75; // 'LZFu'
    dv.setUint32(12, rtfCrc(bodyArr), true);    // CRC of compressed body
    out.set(bodyArr, 16);
    return out;
  }

  // ── Convert <img src="data:..."> into CID inline attachments ───────────────
  function extractInlineImages(html) {
    var attachments = [];
    var idx = 0;
    var processed = html.replace(
      /(<img\b[^>]*?src=")data:([^;]+);base64,([^"]+)(")/gi,
      function (match, pre, mimeType, b64, post) {
        var cid = 'img' + (idx++) + '@ops';
        try {
          var raw = atob(b64);
          var bytes = new Uint8Array(raw.length);
          for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          var ext = { 'image/jpeg': '.jpg', 'image/gif': '.gif',
                      'image/svg+xml': '.svg', 'image/webp': '.webp' }[mimeType] || '.png';
          attachments.push({ cid: cid, mimeType: mimeType, bytes: bytes, ext: ext });
          return pre + 'cid:' + cid + post;
        } catch (_) { return match; }
      }
    );
    return { html: processed, attachments: attachments };
  }

  // ── Build a property stream + collect its substreams ───────────────────────
  // props: array of [id, type, value]
  //   PT_LONG  -> value is a number
  //   PT_BOOL  -> value is 0/1
  //   PT_TIME  -> value is Uint8Array(8)
  //   PT_STRING8 -> value is a string  (substream is ANSI w/o null; size = len+1)
  //   PT_BINARY  -> value is Uint8Array (substream as-is; size = len)
  function buildPropStream(headerLen, props, fillHeader) {
    var stream = new Uint8Array(headerLen + props.length * 16);
    var dv = new DataView(stream.buffer);
    if (fillHeader) fillHeader(dv);
    var subs = [];
    var off = headerLen;
    for (var p = 0; p < props.length; p++) {
      var id = props[p][0], type = props[p][1], value = props[p][2];
      dv.setUint16(off, type, true);
      dv.setUint16(off + 2, id, true);
      dv.setUint32(off + 4, 0x06, true); // PROPATTR_READABLE | PROPATTR_WRITABLE
      if (type === PT_LONG) {
        dv.setUint32(off + 8, value >>> 0, true);
      } else if (type === PT_BOOL) {
        dv.setUint16(off + 8, value ? 1 : 0, true);
      } else if (type === PT_TIME) {
        stream.set(value, off + 8);
      } else if (type === PT_STRING8) {
        var sb = ansiBytes(value);
        dv.setUint32(off + 8, sb.length + 1, true); // size COUNTS the null
        subs.push([substgName(id, type), sb]);       // stream EXCLUDES the null
      } else if (type === PT_BINARY) {
        dv.setUint32(off + 8, value.length, true);
        subs.push([substgName(id, type), value]);
      }
      off += 16;
    }
    return { stream: stream, subs: subs };
  }

  // ── Build the full .msg ────────────────────────────────────────────────────
  function buildMsg(subject, htmlBodyStr, toAddrs, ccAddrs) {
    if (typeof CFB === 'undefined') {
      throw new Error('CFB library not loaded — check internet connection');
    }
    subject = subject || '';

    var inline = extractInlineImages(htmlBodyStr);
    var cidHtml = inline.html;
    var attachments = inline.attachments;

    var recips = []
      .concat((toAddrs || []).map(function (e) { return { email: (e || '').trim(), type: 1 }; }))
      .concat((ccAddrs || []).map(function (e) { return { email: (e || '').trim(), type: 2 }; }))
      .filter(function (r) { return r.email; });
    var recipCount = recips.length;
    var attachCount = attachments.length;

    var displayTo = (toAddrs || []).filter(Boolean).join('; ');
    var displayCc = (ccAddrs || []).filter(Boolean).join('; ');

    var now = fileTimeNow();
    var bodyText = htmlToText(cidHtml);
    var rtf = compressRtf(htmlToRtf(cidHtml));
    var msgFlags = 0x0008 | (attachCount > 0 ? 0x0010 : 0); // UNSENT | HASATTACH

    // Top-level property set (matches what Outlook emits, minus named props).
    var topProps = [
      [0x3007, PT_TIME, now],          // PidTagCreationTime
      [0x3008, PT_TIME, now],          // PidTagLastModificationTime
      [0x0017, PT_LONG, 1],            // PidTagImportance = normal
      [0x0036, PT_LONG, 0],            // PidTagSensitivity = none
      [0x0026, PT_LONG, 0],            // PidTagPriority = normal
      [0x0E07, PT_LONG, msgFlags],     // PidTagMessageFlags
      [0x0E1F, PT_BOOL, 1],            // PidTagRtfInSync
      [0x3016, PT_BOOL, 1],            // PidTagConversationIndexTracking
      [0x3FDE, PT_LONG, 1252],         // PidTagInternetCodepage
      [0x3FF1, PT_LONG, 0x0409],       // PidTagMessageLocaleId = en-US
      [0x1016, PT_LONG, 3],            // PidTagNativeBodyInfo = HTML
      [0x001A, PT_STRING8, 'IPM.Note'],
      [0x0037, PT_STRING8, subject],   // PidTagSubject
      [0x0070, PT_STRING8, subject],   // PidTagConversationTopic
      [0x0E1D, PT_STRING8, subject],   // PidTagNormalizedSubject
      [0x003D, PT_STRING8, ''],        // PidTagSubjectPrefix
      [0x1000, PT_STRING8, bodyText],  // PidTagBody
      [0x0E04, PT_STRING8, displayTo], // PidTagDisplayTo
      [0x0E03, PT_STRING8, displayCc], // PidTagDisplayCc
      [0x0E02, PT_STRING8, ''],        // PidTagDisplayBcc
      [0x300B, PT_BINARY, randomBytes(16)],   // PidTagSearchKey
      [0x0071, PT_BINARY, conversationIndex()],// PidTagConversationIndex
      [0x1009, PT_BINARY, rtf],        // PidTagRtfCompressed
    ];

    var top = buildPropStream(32, topProps, function (dv) {
      dv.setUint32(8, recipCount, true);   // Next Recipient ID
      dv.setUint32(12, attachCount, true); // Next Attachment ID
      dv.setUint32(16, recipCount, true);  // Recipient Count
      dv.setUint32(20, attachCount, true); // Attachment Count
    });

    var cfb = CFB.utils.cfb_new({ root: 'Root Entry' });
    function add(path, data) {
      CFB.utils.cfb_add(cfb, path, data instanceof Uint8Array ? data : new Uint8Array(data));
    }

    add('/__properties_version1.0', top.stream);
    top.subs.forEach(function (s) { add('/' + s[0], s[1]); });

    // Required named-property mapping storage (empty — no named properties).
    add('/__nameid_version1.0/__substg1.0_00020102', new Uint8Array(0));
    add('/__nameid_version1.0/__substg1.0_00030102', new Uint8Array(0));
    add('/__nameid_version1.0/__substg1.0_00040102', new Uint8Array(0));

    // Recipients
    recips.forEach(function (r, i) {
      var base = '/__recip_version1.0_#' + ('0000000' + i.toString(16)).slice(-8);
      var rp = buildPropStream(8, [
        [0x0FFE, PT_LONG, 6],            // PidTagObjectType = MAPI_MAILUSER
        [0x0C15, PT_LONG, r.type],       // PidTagRecipientType (1=To, 2=Cc)
        [0x3000, PT_LONG, i],            // PidTagRowid
        [0x3001, PT_STRING8, r.email],   // PidTagDisplayName
        [0x3002, PT_STRING8, 'SMTP'],    // PidTagAddressType
        [0x3003, PT_STRING8, r.email],   // PidTagEmailAddress
        [0x5FF6, PT_STRING8, r.email],   // PidTagRecipientDisplayName
        [0x5FDF, PT_LONG, 1],            // PidTagRecipientOrder
        [0x5FFD, PT_LONG, 1],            // PidTagRecipientFlags
      ]);
      add(base + '/__properties_version1.0', rp.stream);
      rp.subs.forEach(function (s) { add(base + '/' + s[0], s[1]); });
    });

    // Inline image attachments (referenced from the HTML by cid:)
    attachments.forEach(function (att, i) {
      var base = '/__attach_version1.0_#' + ('0000000' + i.toString(16)).slice(-8);
      var ap = buildPropStream(8, [
        [0x0E21, PT_LONG, i],            // PidTagAttachNumber
        [0x3705, PT_LONG, 1],            // PidTagAttachMethod = ATTACH_BY_VALUE
        [0x370B, PT_LONG, 0xFFFFFFFF],   // PidTagRenderingPosition = -1 (inline)
        [0x3714, PT_LONG, 4],            // PidTagAttachFlags = ATT_MHTML_REF
        [0x3701, PT_BINARY, att.bytes],  // PidTagAttachDataBinary
        [0x3703, PT_STRING8, att.ext],   // PidTagAttachExtension
        [0x3704, PT_STRING8, 'image' + i + att.ext], // PidTagAttachFilename
        [0x3707, PT_STRING8, 'image' + i + att.ext], // PidTagAttachLongFilename
        [0x370E, PT_STRING8, att.mimeType],          // PidTagAttachMimeTag
        [0x3712, PT_STRING8, att.cid],   // PidTagAttachContentId
      ]);
      add(base + '/__properties_version1.0', ap.stream);
      ap.subs.forEach(function (s) { add(base + '/' + s[0], s[1]); });
    });

    try { CFB.utils.cfb_gc(cfb); } catch (_) {}
    var rootEntry = cfb.FileIndex[0];
    if (rootEntry) rootEntry.clsid = '0B0D020000000000C000000000000046';

    return new Uint8Array(CFB.write(cfb, { type: 'array' }));
  }

  global.MsgWriter = { buildMsg: buildMsg, extractInlineImages: extractInlineImages };
})(typeof window !== 'undefined' ? window : this);
