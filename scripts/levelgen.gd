extends RefCounted

# Детерминированный генератор уровня.
# Уровень = последовательность ячеек: волна / препятствие / передышка.
# Зерно = номер уровня, поэтому уровень одинаков у всех игроков.

const CHAPTER_SIZE := 20

# Какие типы врагов открыты к главе
const ENEMY_UNLOCK := {
	1: ["basic", "runner"],
	2: ["basic", "runner", "fat", "spitter"],
	3: ["basic", "runner", "fat", "spitter", "bomber"],
}

static func chapter_of(level: int) -> int:
	return mini(3, int((level - 1) / CHAPTER_SIZE) + 1)

static func is_boss(level: int) -> bool:
	return level % CHAPTER_SIZE == 0

static func pool_for(level: int) -> Array:
	var ch := chapter_of(level)
	return ENEMY_UNLOCK.get(ch, ENEMY_UNLOCK[1]).duplicate()

# Возвращает Array словарей-ячеек:
#   {"type":"wave", "enemies":[{"kind":String,"delay":float}, ...]}
#   {"type":"obstacle", "window":float}
#   {"type":"rest", "coins":int}
#   {"type":"boss", "kind":String}
static func build(level: int) -> Array:
	var rng := RandomNumberGenerator.new()
	rng.seed = 100000 + level

	var ch := chapter_of(level)
	var in_ch: int = ((level - 1) % CHAPTER_SIZE) + 1
	var pool := pool_for(level)
	var cells: Array = []

	# Босс главы — отдельная сборка
	if is_boss(level):
		cells.append({"type": "wave", "enemies": _wave(rng, ["basic"], 3, 0)})
		cells.append({"type": "rest", "coins": 5})
		cells.append({"type": "boss", "kind": "boss_ch%d" % ch})
		return cells

	# Обучающие уровни главы: новый враг по одному, с паузой
	if in_ch <= 3:
		var kinds: Array = pool.slice(0, mini(pool.size(), in_ch + 1))
		cells.append({"type": "rest", "coins": 3})
		for k in kinds:
			cells.append({"type": "wave", "enemies": [{"kind": k, "delay": 0.0}]})
			cells.append({"type": "rest", "coins": 2})
		cells.append({"type": "wave", "enemies": _wave(rng, kinds, 3, 0)})
		return cells

	# «Мясной» уровень — каждый пятый: только волны, без препятствий
	var meaty: bool = (in_ch % 5 == 0)

	var count: int = 6 + int(in_ch / 5)          # 6..9 ячеек
	var difficulty: float = float(in_ch) / float(CHAPTER_SIZE)   # 0..1

	for i in range(count):
		var roll := rng.randf()
		if meaty or roll < 0.62:
			var size: int = 2 + int(round(difficulty * 3.0)) + rng.randi_range(0, 1)
			cells.append({"type": "wave", "enemies": _wave(rng, pool, size, difficulty)})
		elif roll < 0.85:
			cells.append({"type": "obstacle", "window": lerpf(1.6, 1.0, difficulty)})
		else:
			cells.append({"type": "rest", "coins": rng.randi_range(3, 6)})

	return cells

static func _wave(rng: RandomNumberGenerator, pool: Array, size: int, difficulty: float) -> Array:
	# Зомби приходят кучками: 2-4 разом почти без задержки, потом пауза.
	# Поодиночке они не читаются как толпа и бой выглядит вялым.
	var out: Array = []
	var t := 0.0
	var left := size
	var group_id := 0
	while left > 0:
		var pack: int = mini(left, rng.randi_range(2, 4))
		for i in range(pack):
			var kind: String = String(pool[0])
			if pool.size() > 1 and rng.randf() < 0.35 + difficulty * 0.4:
				kind = String(pool[rng.randi_range(1, pool.size() - 1)])
			out.append({
				"kind": kind,
				"delay": t + rng.randf_range(0.0, 0.35),   # почти одновременно
				"group": group_id,
				"lane": rng.randf_range(0.12, 0.88),       # глубина на земле
			})
		left -= pack
		t += rng.randf_range(1.8, 3.0)                     # пауза между кучками
		group_id += 1
	return out

# Сколько монет даёт уровень за прохождение
static func level_reward(level: int) -> int:
	return 20 + chapter_of(level) * 15 + int(level / 2)
