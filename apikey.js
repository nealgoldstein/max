// apikey.js — Anthropic API-key management (BYOK).
// Extracted verbatim from index.html (PD.449, bloat reduction). Plain
// classic script: every symbol stays GLOBAL exactly as when inline, so
// call sites elsewhere (callMax, onclick="saveApiKey()", boot's
// loadApiKey at index.html ~41631) are unaffected. Loaded right after
// sync.js so MaxSync exists when renderApiKeyUI runs at boot. Contains:
// _apiKey state, _isWellFormedApiKey (the one validity gate, PD.445),
// load/save/clear, the ?key= URL handoff, and the validate-at-every-
// boundary rules (PD.444/445).

var _apiKey = null;
var _apiKeyPrompted = false; // only show banner after first failure

// Round CV: URL-parameter key handoff. The owner can share a one-time URL
// like ?reviewKey=sk-ant-... so a reviewer doesn't have to set up their
// own Anthropic key. The key gets saved to their localStorage, and the
// URL is rewritten without the parameter so the key isn't visible in
// browser history after the first load. Pair with a $20 budget cap on
// the owner's Anthropic account and rotate the key after review.
function _consumeReviewKeyFromUrl(){
  try {
    var params = new URLSearchParams(window.location.search);
    var rk = params.get("reviewKey") || params.get("key");
    if (!rk) return false;
    rk = String(rk).trim();
    // PD.445: validate, don't sanitize-and-hope. URLSearchParams turns
    // "+" into a space, so a handoff URL like ?key=sk-ant-…+token+<uuid>/
    // arrives here as "sk-ant-… token <uuid>/" — a key with a session
    // token concatenated on. That is exactly how Neal's stored key got
    // corrupted. Refuse anything that isn't a single clean sk-ant token
    // rather than guessing which part is the key and persisting the rest.
    if (!_isWellFormedApiKey(rk)) {
      console.warn("[Max] ?key= URL handoff value is not a well-formed API key — ignoring");
      return false;
    }
    try { localStorage.setItem("max-api-key", rk); } catch(_){}
    _apiKey = rk;
    // Strip the parameter so it's not visible after first load
    params.delete("reviewKey");
    params.delete("key");
    var qs = params.toString();
    var clean = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
    try { history.replaceState({}, document.title, clean); } catch(_){}
    // Show a transient toast so the user knows the key was loaded
    setTimeout(function(){
      var t = document.createElement("div");
      t.style.cssText = "position:fixed;top:14px;right:14px;background:var(--c-primary);color:var(--c-on-dark);font-size:12px;font-weight:600;padding:10px 14px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,0.18);z-index:99999;font-family:inherit;max-width:300px;line-height:1.5;";
      t.innerHTML = "✓ Shared review key loaded.<br><span style='font-size:10.5px;font-weight:400;opacity:0.85;'>Don\'t share this URL — it had a key in it. The key is now in your browser only.</span>";
      document.body && document.body.appendChild(t);
      setTimeout(function(){ try { t.remove(); } catch(_){} }, 8000);
    }, 100);
    return true;
  } catch(_){ return false; }
}

// PD.445: ONE well-formedness check for an Anthropic API key, applied at
// every boundary the key can enter through (the save form, the ?key= URL
// handoff, and the load path). A real key is a SINGLE unbroken token:
// "sk-ant-" + url-safe chars, ~108 long. Anything else — interior
// whitespace, a concatenated session token, surrounding prose — is not a
// key and must be refused at the door, not stored and later guessed back
// out. Neal's bug: a session token ("token <uuid>-<uuid>/") had been
// concatenated onto his key via an input path that never validated it, so
// every model call 401'd. The key store and the token store are separate;
// nothing in the code mixes them — the gap was the missing check here.
function _isWellFormedApiKey(k){
  return typeof k === "string"
      && /^sk-ant-[A-Za-z0-9_-]+$/.test(k)   // single token, no whitespace/punctuation
      && k.length >= 95 && k.length <= 130;   // real keys are ~108
}

function loadApiKey(){
  // Round CV: URL handoff first — overrides whatever's in localStorage so
  // a reviewer with a fresh URL always gets the latest key.
  if (_consumeReviewKeyFromUrl()) {
    renderApiKeyUI();
    return;
  }
  var _stored = null;
  try { _stored = localStorage.getItem("max-api-key") || null; } catch(e) { _stored = null; }
  // PD.445: validate on read. A malformed stored value (e.g. a token got
  // concatenated in) is NOT used — using it only produces silent 401s —
  // and we don't silently guess a key out of it either. We leave the bad
  // value in storage (non-destructive) but treat the app as keyless so
  // the user is cleanly prompted to re-enter a valid key, which overwrites
  // it. PD.421 kept us from deleting a VALID key on a transient 401; this
  // is the opposite case — a value that was never a valid key at all.
  if (_stored && !_isWellFormedApiKey(_stored)) {
    console.warn("[Max] stored API key is malformed (not a single sk-ant token) — not using it; prompting re-entry");
    _apiKey = null;
  } else {
    _apiKey = _stored;
  }
  // Only update UI to show "key set" confirmation — never show warning banner on load
  renderApiKeyUI();
}
function renderApiKeyUI(){
  var btn=document.getElementById('api-key-btn');
  // v345.1: signed in via MaxSync → server proxy handles LLM.
  // The 🔑 button shows as muted (clickable to override but not
  // flagged as missing).
  var signedIntoSync = (typeof MaxSync !== "undefined" &&
                        typeof MaxSync.isSignedIn === "function" &&
                        MaxSync.isSignedIn());
  if(btn){
    if(_apiKey){
      btn.style.opacity='1';
      btn.title='API key set \u2714 — click to change';
      btn.style.color='#2a7a4e';
    } else if (signedIntoSync) {
      btn.style.opacity='0.5';
      btn.title='Signed in — server proxies LLM calls. Click to override.';
      btn.style.color='#888';
    } else {
      btn.style.opacity='1';
      btn.title='No API key — click to add';
      btn.style.color='#e05050';
    }
  }
}
function showApiKeyForm(){
  var w=g("apikey-inp-wrap");if(w)w.style.display="block";
  setTimeout(function(){var i=g("apikey-inp");if(i)i.focus();},50);
}
function hideApiKeyForm(){
  var w=g("apikey-inp-wrap");if(w)w.style.display="none";
}
function saveApiKey(val){
  var v=val;
  if(!v){var i=g("apikey-inp");if(!i)return;v=i.value.trim();}
  if(!v)return;
  // v324: defensive cleanup. Anthropic's "invalid x-api-key" error
  // usually traces to one of three paste-time hazards:
  //   1. surrounding quotes (the user copied "sk-ant-..." with quotes
  //      from a docs example)
  //   2. invisible characters — non-breaking space, zero-width space,
  //      BOM, smart quotes — that look like nothing but byte-differ
  //   3. only the first half of the key (clipped paste)
  // We strip 1+2 silently and validate 3 with a clear error.
  // Strip surrounding ASCII + curly quotes and surrounding whitespace.
  v = v.replace(/^[\s"'\u201c\u201d\u2018\u2019]+|[\s"'\u201c\u201d\u2018\u2019]+$/g, '');
  // Strip invisible characters anywhere in the string: NBSP, zero-width
  // space/non-joiner/joiner, LTR/RTL marks, BOM. They survive .trim() but
  // cause Anthropic to see a byte sequence different from what was pasted.
  v = v.replace(/[\u00a0\u200b-\u200f\ufeff]/g, '');
  // PD.444: strip ALL internal whitespace too (spaces, tabs, newlines).
  // A valid key is one unbroken token; interior whitespace only ever comes
  // from a bad paste (a line-wrapped copy, or two values run together) and
  // yields a malformed Authorization header \u2192 a silent Anthropic 401 on
  // every call. Neal hit exactly this: a 187-char key with interior spaces
  // saved cleanly and nothing would build. The previous strip above only
  // covered INVISIBLE chars, not ordinary ASCII space/tab/newline.
  v = v.replace(/\s+/g, '');
  // Anthropic API keys start with "sk-ant-" (api03 prefix on current
  // gen) and are typically ~100 chars. We don't hard-fail on a wrong
  // prefix because Anthropic could change it, but we warn loudly so
  // the user catches paste mistakes before a network round-trip.
  if (!/^sk-ant-/.test(v)) {
    if (typeof maxAlert === "function") {
      maxAlert("That doesn't look like an Anthropic API key — they start with <code>sk-ant-</code>. Double-check what you copied (it may be an OAuth token or admin key instead).");
    }
    return;
  }
  if (v.length < 60) {
    if (typeof maxAlert === "function") {
      maxAlert("That key looks truncated — Anthropic keys are about 100 characters. Try copying again and make sure you got the whole string.");
    }
    return;
  }
  // PD.444: implausibly long = extra content rode along on the paste (a
  // label, a second token, surrounding prose). Current keys are ~108
  // chars; flag well above that rather than silently saving a key that
  // will only ever 401. This is the other half of Neal's 187-char key.
  if (v.length > 130) {
    if (typeof maxAlert === "function") {
      maxAlert("That key looks too long (" + v.length + " characters; Anthropic keys are ~108). Some extra text may have been copied with it — recopy just the key, starting at <code>sk-ant-</code> with nothing after the end of the string.");
    }
    return;
  }
  // PD.445: authoritative gate. Everything above is friendly, specific
  // triage; this is the single source of truth for "is this a real key?"
  // — the SAME predicate the loader and the URL handoff use, so a value
  // that wouldn't survive on read can never be written here either.
  if (!_isWellFormedApiKey(v)) {
    if (typeof maxAlert === "function") {
      maxAlert("That doesn't look like a valid API key — it should be a single <code>sk-ant-…</code> token with no spaces or extra text. Recopy just the key.");
    }
    return;
  }
  _apiKey=v;
  try{localStorage.setItem("max-api-key",v);}catch(e){}
  if(!val){var i=g("apikey-inp");if(i)i.value=""; hideApiKeyForm(); showSaveStatus("API key saved ✓",3000);}
}
function clearApiKey(){
  _apiKey=null;
  try{localStorage.removeItem("max-api-key");}catch(e){}
}
