/** SQLite-friendly UTC timestamps (YYYY-MM-DD HH:MM:SS). */
function toSqliteDatetime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function addMinutes(minutes, from = new Date()) {
  const d = new Date(from);
  d.setMinutes(d.getMinutes() + minutes);
  return toSqliteDatetime(d);
}

function addDays(days, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return toSqliteDatetime(d);
}

module.exports = { toSqliteDatetime, addMinutes, addDays };
