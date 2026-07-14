// Stage naming and ordering shared by the client views (event page,
// category page) and the server routes (score editing lock). Pure
// functions only — safe to import from both sides.

const STAGE_LABEL = {
  group: 'Групи',
  play_in: 'Плей-ін (2-3 місця)',
  qf: 'Чвертьфінал',
  sf: 'Півфінал',
  quarterfinal: 'Чвертьфінал',
  semifinal: 'Півфінал',
  final: 'Фінал',
};

// Human label for a placement (leaf) stage 'pX_Y' → "За 3-є місце" / "За 5-6 місця".
function placeLabel(stage) {
  const pl = /^p(\d+)_(\d+)$/.exec(stage);
  if (!pl) return null;
  const hi = Number(pl[1]);
  const lo = Number(pl[2]);
  if (hi === 3) return 'За 3-є місце';
  return `За ${hi}-${lo} місця`;
}

// Two-bracket system encodes bracket as a stage prefix: m_ = main
// (group winners), c_ = consolation (2nd/3rd places).
function bracketOf(stage) {
  if (stage.startsWith('m_')) return 'main';
  if (stage.startsWith('c_')) return 'cons';
  return 'single';
}

function baseStage(stage) {
  return stage.replace(/^m_|^c_/, '');
}

function stageSize(stage) {
  const s = baseStage(stage);
  if (s === 'final') return 2;
  if (s === 'semifinal') return 4;
  if (s === 'quarterfinal') return 8;
  const m = /^ko_(\d+)$/.exec(s);
  return m ? Number(m[1]) : 999;
}

// A single sort key covering both bracket-naming schemes: group stage,
// group-based knockouts (final/semifinal/ko_N, optionally m_/c_), and
// double-elimination (wb#/lb#/gf).
export function stageWeight(stage) {
  if (stage === 'group') return 0;
  const kr = /^kr(\d+)$/.exec(stage);
  if (kr) return Number(kr[1]); // King rounds order first (1,2,3,…)
  const de = /^(wb|lb)(\d+)$/.exec(stage);
  if (de) return (de[1] === 'wb' ? 1000 : 2000) + Number(de[2]);
  if (stage === 'gf') return 3000;
  // Crosses playoff: play-in → qf → sf → final, then placement matches.
  if (stage === 'play_in') return 105;
  if (stage === 'qf') return 110;
  if (stage === 'sf') return 120;
  if (stage === 'final') return 130;
  const pl = /^p(\d+)_(\d+)$/.exec(stage);
  if (pl) return 200 + Number(pl[1]);
  const base = bracketOf(stage) === 'cons' ? 500 : 100;
  return base + (100 - stageSize(stage)); // bigger rounds first
}

export function stageLabel(stage) {
  const kr = /^kr(\d+)$/.exec(stage);
  if (kr) return `Раунд ${kr[1]}`;
  const de = /^(wb|lb)(\d+)$/.exec(stage);
  if (de) return `${de[1] === 'wb' ? 'Верхня' : 'Нижня'} · Раунд ${de[2]}`;
  if (stage === 'gf') return 'Гранд-фінал';
  const place = placeLabel(stage);
  if (place) return place;
  const s = baseStage(stage);
  const br = bracketOf(stage);
  const prefix = br === 'main' ? 'Основна · ' : br === 'cons' ? 'Втішна · ' : '';
  if (STAGE_LABEL[s]) return prefix + STAGE_LABEL[s];
  const m = /^ko_(\d+)$/.exec(s);
  return prefix + (m ? `Плей-офф (${m[1]})` : s);
}

// Groups are lettered А, Б, В, … everywhere (schedule, bracket, event
// page); numbers appear only past the alphabet.
const GROUP_LETTERS = [
  'А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К',
  'Л', 'М', 'Н', 'О', 'П', 'Р', 'С', 'Т', 'У', 'Ф',
];

export function groupTitle(groupIndex) {
  return `Група ${GROUP_LETTERS[groupIndex] || groupIndex + 1}`;
}
