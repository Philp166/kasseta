/**
 * «Кассета» — одиночный экшен. Бой идёт на клиенте (60 fps, без задержек сети),
 * а комната хранит прогресс игрока: пройденные уровни, лучшие результаты.
 * Шесть функций контракта платформы; никакой случайности и таймеров здесь нет.
 */

export const meta = {
  game: "Кассета",
  minPlayers: 1,
  maxPlayers: 1,
};

const MAX_LEVEL = 20;

export function setup(players) {
  return {
    players: [...players],
    unlocked: 1,          // самый дальний открытый уровень
    stars: {},            // "1": 3
    kills: 0,
    bestCombo: 0,
    runs: 0,
  };
}

export function validateAction(state, playerId, action) {
  if (!state.players.includes(playerId)) return { ok: false, error: "not seated" };
  if (!action || action.type !== "level_result") return { ok: false, error: "unknown action" };
  const { level, stars, kills, combo } = action;
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return { ok: false, error: "bad level" };
  if (level > state.unlocked) return { ok: false, error: "level locked" };
  if (!Number.isInteger(stars) || stars < 0 || stars > 3) return { ok: false, error: "bad stars" };
  if (!Number.isInteger(kills) || kills < 0 || kills > 200) return { ok: false, error: "bad kills" };
  if (!Number.isInteger(combo) || combo < 0 || combo > 500) return { ok: false, error: "bad combo" };
  return { ok: true };
}

export function applyAction(state, playerId, action) {
  const key = String(action.level);
  const prev = state.stars[key] || 0;
  const stars = { ...state.stars, [key]: Math.max(prev, action.stars) };
  const won = action.stars > 0;
  return {
    ...state,
    stars,
    unlocked: won ? Math.max(state.unlocked, Math.min(MAX_LEVEL, action.level + 1)) : state.unlocked,
    kills: state.kills + action.kills,
    bestCombo: Math.max(state.bestCombo, action.combo),
    runs: state.runs + 1,
  };
}

/** Кампания не заканчивается: игрок всегда может переигрывать уровни. */
export function isGameOver(state) {
  return { over: false };
}

export function viewFor(state, playerId) {
  return {
    unlocked: state.unlocked,
    stars: state.stars,
    kills: state.kills,
    bestCombo: state.bestCombo,
    maxLevel: MAX_LEVEL,
  };
}
