// util-esc.js — ONE canonical HTML escaper (PD.484 / audit T4.1).
//
// Before this, ~18 copies of esc()/_esc() were scattered across index.html
// and the modules, each with a DIFFERENT escape set: quote-only, <-only,
// &<, &<>, &<>", &<>"'. That inconsistency is a real correctness bug — a
// quote-only escaper used in a text context leaves < unescaped; a <-only
// escaper used in an attribute leaves " unescaped. The local copies now
// delegate here so there is one behaviour everywhere.
//
// The set is the full safe five (& < > " '), with & replaced FIRST so an
// entity introduced by an earlier replace isn't double-escaped. Escaping
// the quote/apostrophe in text content is harmless (the browser renders
// &quot;/&#39; as "/'), so this superset is safe in every HTML context
// these callers build — text nodes and attribute values alike.
//
// NOTE: two escapers intentionally do NOT delegate here:
//   • the place-picker popout builds its esc() inside a serialized string
//     for a SEPARATE browser window that can't see this global;
//   • picker-hero-sidebar's `esc` is an Escape-KEY handler, not an escaper.
(function (g) {
  function _escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  g._escHtml = _escHtml;
})(typeof window !== "undefined" ? window : globalThis);
