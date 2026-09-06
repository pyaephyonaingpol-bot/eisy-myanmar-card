/**
 * Resolve a process.env value from the first non-empty alias.
 * Strips accidental "KEY = value" assignment prefixes (common Cursor/Vercel paste mistakes).
 */
function stripAssignmentPrefix(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/^[A-Z][A-Z0-9_]*\s*=\s*(.+)$/s);
  return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : text.replace(/^['"]|['"]$/g, '');
}

function firstEnv(...names) {
  for (const name of names) {
    const raw = process.env[name];
    if (raw == null) continue;
    const value = stripAssignmentPrefix(raw);
    if (value) return value;
  }
  return '';
}

function envIsSet(...names) {
  return Boolean(firstEnv(...names));
}

module.exports = {
  stripAssignmentPrefix,
  firstEnv,
  envIsSet,
};
