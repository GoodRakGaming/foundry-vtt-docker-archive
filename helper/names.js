'use strict';

const ADJECTIVES = [
  'Тихий', 'Быстрый', 'Хитрый', 'Смелый', 'Ленивый', 'Рыжий', 'Шустрый',
  'Мудрый', 'Весёлый', 'Спокойный', 'Дерзкий', 'Загадочный', 'Бодрый',
  'Внимательный', 'Скромный', 'Отважный', 'Терпеливый', 'Ворчливый',
];

const NOUNS = [
  'Барсук', 'Дракон', 'Гоблин', 'Волк', 'Сокол', 'Тролль', 'Ворон',
  'Медведь', 'Лис', 'Орк', 'Грифон', 'Ёж', 'Филин', 'Кабан', 'Рысь',
  'Кот', 'Паладин', 'Странник',
];

function getCurrentMonthEpoch() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function randomName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const num = Math.floor(Math.random() * 90) + 10;
  return `${adj}-${noun}-${num}`;
}

// Name is bound to an (ip, actor_type, epoch) tuple, never to a person —
// it's a readability aid, not an identity (spec 3c). DM names rotate
// monthly since IPs get reassigned via DHCP; admin's is a single fixed
// epoch since it's one trusted operator.
function getFriendlyName(db, ip, actorType) {
  const safeIp = ip || 'unknown';
  const epoch = actorType === 'admin' ? 'fixed' : getCurrentMonthEpoch();

  const row = db
    .prepare('SELECT friendly_name FROM ip_names WHERE ip = ? AND actor_type = ? AND epoch = ?')
    .get(safeIp, actorType, epoch);
  if (row) return row.friendly_name;

  const name = randomName();
  db.prepare(
    'INSERT INTO ip_names (ip, actor_type, epoch, friendly_name, assigned_at) VALUES (?, ?, ?, ?, ?)'
  ).run(safeIp, actorType, epoch, name, Date.now());
  return name;
}

module.exports = { getFriendlyName, getCurrentMonthEpoch };
