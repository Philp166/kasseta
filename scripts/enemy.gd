extends Node2D

# Зомби. Плейсхолдер — прямоугольник. Каждый тип решается своим способом:
# обычный — бей, толстяк — уклоняйся (небьётся блоком), бегун — парируй прыжок,
# плевун — сближайся или стреляй, взрывной — подрывай его в толпе.

signal killed(enemy)
signal wants_projectile(from_pos, dir, damage)
signal wants_explosion(at_pos, damage, radius)

const Persp = preload("res://scripts/persp.gd")

enum E {WALK, WINDUP, RECOVER, STUNNED, STAGGER, DEAD}

const STUN_MAX := 100.0

const TYPES := {
	"basic": {
		"hp": 32.0, "speed": 62.0, "damage": 9.0, "range": 100.0, "stun_res": 1.0,
		"w": 58.0, "h": 140.0, "color": Color(0.42, 0.68, 0.28), "coins": 2,
		"windup": 0.6, "parryable": true, "unblockable": false, "ranged": false,
	},
	"runner": {
		"hp": 20.0, "speed": 150.0, "damage": 8.0, "range": 150.0, "stun_res": 1.3,
		"w": 46.0, "h": 118.0, "color": Color(0.72, 0.80, 0.20), "coins": 3,
		"windup": 0.42, "parryable": true, "unblockable": false, "ranged": false,
		"leap": true,
	},
	"fat": {
		"hp": 90.0, "speed": 36.0, "damage": 20.0, "range": 115.0, "stun_res": 0.55,
		"w": 92.0, "h": 158.0, "color": Color(0.25, 0.52, 0.24), "coins": 6,
		"windup": 0.95, "parryable": false, "unblockable": true, "ranged": false,
		"knock_res": 0.25, "interrupt_need": 2,
	},
	"spitter": {
		"hp": 26.0, "speed": 48.0, "damage": 11.0, "range": 380.0, "stun_res": 1.0,
		"w": 54.0, "h": 134.0, "color": Color(0.30, 0.72, 0.58), "coins": 4,
		"windup": 1.0, "parryable": false, "unblockable": false, "ranged": true,
	},
	"bomber": {
		"hp": 24.0, "speed": 74.0, "damage": 34.0, "range": 85.0, "stun_res": 1.1,
		"w": 80.0, "h": 128.0, "color": Color(0.90, 0.60, 0.15), "coins": 5,
		"windup": 0.55, "parryable": false, "unblockable": true, "ranged": false,
		"explodes": true, "explosion_damage": 45.0, "explosion_radius": 230.0,
	},
	"boss_ch1": {
		"hp": 340.0, "speed": 105.0, "damage": 26.0, "range": 130.0, "stun_res": 0.45,
		"w": 120.0, "h": 200.0, "color": Color(0.55, 0.30, 0.30), "coins": 40,
		"windup": 0.55, "parryable": true, "unblockable": false, "ranged": false,
		"knock_res": 0.15, "interrupt_need": 2, "slam_every": 3, "combo_attacks": 2,
	},
	"boss_ch2": {
		"hp": 430.0, "speed": 100.0, "damage": 30.0, "range": 140.0, "stun_res": 0.42,
		"w": 130.0, "h": 210.0, "color": Color(0.60, 0.28, 0.28), "coins": 55,
		"windup": 0.55, "parryable": true, "unblockable": false, "ranged": false,
		"knock_res": 0.15, "interrupt_need": 2, "slam_every": 3, "combo_attacks": 2,
	},
	"boss_ch3": {
		"hp": 530.0, "speed": 96.0, "damage": 34.0, "range": 150.0, "stun_res": 0.40,
		"w": 140.0, "h": 220.0, "color": Color(0.65, 0.25, 0.25), "coins": 70,
		"windup": 0.5, "parryable": true, "unblockable": false, "ranged": false,
		"knock_res": 0.15, "interrupt_need": 2, "slam_every": 2, "combo_attacks": 3,
	},
}

var kind: String = "basic"
var data: Dictionary = {}
var hp: float = 30.0
var max_hp: float = 30.0
var stun: float = 0.0
var stun_res: float = 1.0
var state: int = E.WALK
var state_left: float = 0.0
var target_x: float = 0.0
var is_boss: bool = false
var side: int = 1                     # 1 — подходит справа, -1 — слева (обход)
var depth: float = 0.5                # своя дорожка по глубине
var target_depth: float = 0.5         # куда сводится, когда подходит к деду
var attack_count: int = 0
var combo_step: int = 0
var this_attack_unblockable: bool = false
var flash: float = 0.0

var on_hit_player: Callable = Callable()

func setup(k: String) -> void:
	kind = k
	data = TYPES.get(k, TYPES["basic"])
	max_hp = float(data["hp"])
	hp = max_hp
	stun_res = float(data["stun_res"])
	is_boss = k.begins_with("boss")
	z_index = 5
	queue_redraw()

func _process(delta: float) -> void:
	# сведение по глубине: пока далеко — идёт своей дорожкой,
	# вблизи доворачивает на линию деда, иначе куча не читается
	var dist: float = absf(position.x - target_x)
	if state != E.DEAD and dist < 460.0:
		depth = move_toward(depth, target_depth, 0.8 * delta)
	position.y = Persp.y_at(depth)
	var sc := Persp.scale_at(depth)
	scale = Vector2(sc, sc)
	z_index = Persp.z_at(depth)
	if state == E.DEAD:
		return
	flash = maxf(0.0, flash - delta * 4.0)
	if state != E.STUNNED:
		stun = maxf(0.0, stun - 14.0 * delta)
	if state_left > 0.0:
		state_left -= delta
		if state_left <= 0.0:
			_state_done()
	if state == E.WALK:
		var dx: float = (position.x - target_x) * float(side)
		if dx > float(data["range"]):
			position.x -= float(data["speed"]) * delta * float(side)
		else:
			_begin_attack()
	queue_redraw()

func _begin_attack() -> void:
	attack_count += 1
	this_attack_unblockable = bool(data.get("unblockable", false))
	# у боссов каждый N-й удар — небьющийся блоком слэм
	var every: int = int(data.get("slam_every", 0))
	if every > 0 and attack_count % every == 0:
		this_attack_unblockable = true
	state = E.WINDUP
	state_left = float(data["windup"])

func _state_done() -> void:
	match state:
		E.WINDUP:
			_land_attack()
			var series: int = int(data.get("combo_attacks", 1))
			if series > 1 and combo_step < series - 1:
				# серия: следующий удар идёт почти без паузы — отдыхать некогда
				combo_step += 1
				state = E.WINDUP
				state_left = float(data["windup"]) * 0.7
				this_attack_unblockable = false
				return
			combo_step = 0
			state = E.RECOVER
			state_left = 0.35
		E.RECOVER, E.STAGGER:
			state = E.WALK
			state_left = 0.0
		E.STUNNED:
			stun = 0.0
			state = E.WALK
			state_left = 0.0

func _land_attack() -> void:
	if bool(data.get("ranged", false)):
		wants_projectile.emit(position + Vector2(0, -float(data["h"]) * 0.6), -side, float(data["damage"]))
		return
	if on_hit_player.is_valid():
		on_hit_player.call(self, float(data["damage"]), this_attack_unblockable)

# Парирование возможно только в окне замаха и только у парируемых атак
func can_be_parried() -> bool:
	return state == E.WINDUP and bool(data.get("parryable", false)) and not this_attack_unblockable

func on_parried() -> void:
	state = E.STAGGER
	state_left = 1.3
	combo_step = 0
	stun = minf(STUN_MAX, stun + STUN_MAX * 0.6 * stun_res)
	if stun >= STUN_MAX and not is_boss_immune():
		state = E.STUNNED
		state_left = 1.7
	queue_redraw()

func is_stunned() -> bool:
	return state == E.STUNNED

func is_staggered() -> bool:
	return state == E.STAGGER

func is_dead() -> bool:
	return state == E.DEAD

func is_executable() -> bool:
	return state != E.DEAD and (state == E.STUNNED or hp <= max_hp * 0.35)

func is_boss_immune() -> bool:
	return is_boss and hp > max_hp * 0.3

# can_interrupt: сбить чужой замах можно ТОЛЬКО тяжёлым ударом или завершающим
# ударом серии. Иначе лёгкие удары спамом отменяют любую атаку, и телеграфы,
# парирование и боссы теряют смысл (босс так умирал, ни разу не ударив).
func take_hit(damage: float, stun_factor: float, knock: float, interrupt_power: int = 0) -> void:
	if state == E.DEAD:
		return
	flash = 1.0
	position.x += knock * float(side) * float(data.get("knock_res", 1.0))
	# урон применяется ВСЕГДА: раньше удар, добивающий шкалу оглушения,
	# урона не наносил — из-за этого бой мог длиться бесконечно
	hp -= damage
	if hp <= 0.0:
		die()
		return
	stun += (damage / max_hp) * STUN_MAX * stun_factor * stun_res
	if stun >= STUN_MAX and not is_boss_immune():
		stun = 0.0
		state = E.STUNNED
		state_left = 1.5
		queue_redraw()
		return
	if state == E.WINDUP:
		# крупным врагам замах сбивается ТОЛЬКО тяжёлым ударом (сила 2),
		# иначе босса можно держать в вечном прерывании серией лёгких
		if interrupt_power >= int(data.get("interrupt_need", 1)):
			state = E.STAGGER
			state_left = 0.5
	elif state != E.STUNNED:
		state = E.STAGGER
		state_left = 0.18
	queue_redraw()

func take_splash(damage: float) -> void:
	if state == E.DEAD:
		return
	flash = 1.0
	hp -= damage
	if hp <= 0.0:
		die()
		return
	state = E.STAGGER
	state_left = 0.5
	queue_redraw()

func fear(duration: float) -> void:
	if state == E.DEAD or state == E.STUNNED:
		return
	state = E.STAGGER
	state_left = duration

func die() -> void:
	state = E.DEAD
	state_left = 0.0
	if bool(data.get("explodes", false)):
		wants_explosion.emit(position, float(data.get("explosion_damage", 40.0)), float(data.get("explosion_radius", 220.0)))
	queue_redraw()
	killed.emit(self)

func coins_value() -> int:
	return int(data.get("coins", 2))

func _draw() -> void:
	var w: float = float(data.get("w", 58.0))
	var h: float = float(data.get("h", 140.0))
	var col: Color = data.get("color", Color(0.42, 0.68, 0.28))
	match state:
		E.DEAD:
			col = Color(0.42, 0.10, 0.10)
		E.STUNNED:
			col = Color(0.95, 0.88, 0.25)
		E.STAGGER:
			col = col.darkened(0.25)
	if flash > 0.0:
		col = col.lerp(Color.WHITE, flash * 0.8)

	draw_circle(Vector2(0, -6), w * 0.46, Color(0, 0, 0, 0.20))

	if state == E.DEAD:
		draw_rect(Rect2(-h * 0.5, -w * 0.6, h, w * 0.6), col)
		return

	draw_rect(Rect2(-w * 0.5, -h, w, h), col)

	var bar_w := w + 10.0
	draw_rect(Rect2(-bar_w * 0.5, -h - 18.0, bar_w, 8.0), Color(0, 0, 0, 0.45))
	draw_rect(Rect2(-bar_w * 0.5, -h - 18.0, bar_w * clampf(hp / max_hp, 0.0, 1.0), 8.0), Color(0.85, 0.25, 0.2))
	draw_rect(Rect2(-bar_w * 0.5, -h - 8.0, bar_w, 5.0), Color(0, 0, 0, 0.35))
	draw_rect(Rect2(-bar_w * 0.5, -h - 8.0, bar_w * clampf(stun / STUN_MAX, 0.0, 1.0), 5.0), Color(0.95, 0.8, 0.2))

	# телеграф: голубой — парируемо, красный — только уклон
	if state == E.WINDUP:
		var tcol := Color(0.30, 0.80, 1.0) if can_be_parried() else Color(1.0, 0.25, 0.15)
		var prog: float = 1.0 - state_left / maxf(0.01, float(data["windup"]))
		draw_rect(Rect2(-w * 0.5 - 14.0, -h - 44.0, (w + 28.0), 14.0), Color(0, 0, 0, 0.35))
		draw_rect(Rect2(-w * 0.5 - 14.0, -h - 44.0, (w + 28.0) * prog, 14.0), tcol)
	if state == E.STUNNED:
		draw_rect(Rect2(-w * 0.5, -h - 44.0, w, 16.0), Color(1.0, 0.9, 0.2))
	# готов к добиванию
	if is_executable() and state != E.STUNNED:
		draw_rect(Rect2(-w * 0.5, -h - 30.0, w, 6.0), Color(0.95, 0.2, 0.2))
