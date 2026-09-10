extends RefCounted

# Вид «три четверти»: земля — уходящая вдаль плоскость.
# depth 0.0 — дальний край земли, 1.0 — ближний к камере.
# Экранная Y и масштаб фигуры считаются отсюда, чтобы всё сходилось.

const FAR_Y := 600.0
const NEAR_Y := 720.0
const FAR_SCALE := 0.86
const NEAR_SCALE := 1.12
const HORIZON_Y := 560.0

static func y_at(depth: float) -> float:
	return lerpf(FAR_Y, NEAR_Y, clampf(depth, 0.0, 1.0))

static func scale_at(depth: float) -> float:
	return lerpf(FAR_SCALE, NEAR_SCALE, clampf(depth, 0.0, 1.0))

# Дальние объекты немного сдвинуты к центру — сходимость перспективы
static func x_shift(depth: float, x: float) -> float:
	var k: float = 1.0 - lerpf(0.16, 0.0, clampf(depth, 0.0, 1.0))
	return 640.0 + (x - 640.0) * k

static func z_at(depth: float) -> int:
	return 5 + int(clampf(depth, 0.0, 1.0) * 90.0)
