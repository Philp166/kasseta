extends Node2D

# Дед. Плейсхолдер — прямоугольник, но боевые состояния полноценные.

const Weapons = preload("res://scripts/weapons.gd")
const Persp = preload("res://scripts/persp.gd")
const Fonts = preload("res://scripts/fonts.gd")

# Кадры ходьбы: нарезаны из сгенерированной полосы, выровнены по ступням
# Кадры ходьбы: вырезаны из видео-клипа (живое движение).
# Рядом лежит art/ded/walk — та же ходьба, нарисованная 4 кадрами.
const WALK_FRAMES := ["res://art/ded/walk_video/00.png","res://art/ded/walk_video/01.png",
	"res://art/ded/walk_video/02.png","res://art/ded/walk_video/03.png",
	"res://art/ded/walk_video/04.png","res://art/ded/walk_video/05.png",
	"res://art/ded/walk_video/06.png","res://art/ded/walk_video/07.png",
	"res://art/ded/walk_video/08.png","res://art/ded/walk_video/09.png",
	"res://art/ded/walk_video/10.png","res://art/ded/walk_video/11.png",
	"res://art/ded/walk_video/12.png"]

signal died
signal changed

const MAX_HP := 100.0
const RAGE_MAX := 100.0
const RAGE_DURATION := 6.0
const EXEC_MAX := 100.0            # шкала добивания

const PARRY_WINDOW := 0.26         # окно идеального парирования
const BLOCK_AFTER_PARRY := 0.45    # дальше — обычный блок
const DODGE_TIME := 0.38
const DASH_TIME := 0.30
const DASH_DISTANCE := 240.0
const DASH_CD := 1.1
const COMBO_RESET := 2.2

const BODY_W := 70.0
const BODY_H := 150.0

enum A {IDLE, ATTACK, HEAVY_WINDUP, HEAVY_HIT, DODGE, PARRY, BLOCK, HURT, EXECUTE, DEAD, OBSTACLE, RELOAD, DASH}

var max_hp: float = MAX_HP        # растёт от брони
var gear_damage: float = 1.0      # множитель от оружия и прокачки
var gear_reduce: float = 0.0      # снижение урона от брони
var hp: float = MAX_HP
var rage: float = 0.0
var rage_active: bool = false
var rage_left: float = 0.0
var exec_meter: float = 0.0

var anim: int = A.IDLE
var anim_left: float = 0.0
var facing: int = 1                # 1 — вправо, -1 — влево
var depth: float = 0.5             # положение на земле в глубину (0 даль, 1 близко)
var target_depth: float = 0.5
const DEPTH_SPEED := 1.6           # дед сам подшагивает к цели по глубине

var weapon_id: String = "heavy"
var wdata: Dictionary = {}
var ammo: int = 0
var reload_left: float = 0.0

var combo: int = 0
var combo_timer: float = 0.0
var no_damage_streak: int = 0      # ударов подряд без полученного урона
var damage_taken: float = 0.0      # за забег, для звезды «без урона»

var parry_left: float = 0.0
var block_left: float = 0.0
var dodge_left: float = 0.0
var dash_left: float = 0.0
var dash_cd: float = 0.0
var dash_dir: int = 1

var sprite: Sprite2D
var walk_tex: Array = []
var frame_t: float = 0.0

func _ready() -> void:
	z_index = 10
	for path in WALK_FRAMES:
		var t = Fonts.texture(path)
		if t != null:
			walk_tex.append(t)
	if walk_tex.size() > 0:
		sprite = Sprite2D.new()
		sprite.texture = walk_tex[0]
		sprite.centered = false
		# ставим так, чтобы ступни были в точке узла
		sprite.offset = Vector2(-walk_tex[0].get_width() * 0.5, -walk_tex[0].get_height() + 12)
		add_child(sprite)
	set_weapon("heavy")

func set_weapon(id: String) -> void:
	weapon_id = id
	wdata = Weapons.get_class_data(id)
	ammo = int(wdata.get("ammo", 0))
	reload_left = 0.0
	changed.emit()

func weapon_name() -> String:
	return String(wdata.get("name", "?"))

func uses_ammo() -> bool:
	return int(wdata.get("ammo", 0)) > 0

func _process(delta: float) -> void:
	# подшагивание по глубине: игрок этим не управляет, дед сам доворачивает
	if absf(target_depth - depth) > 0.005 and not is_busy():
		depth = move_toward(depth, target_depth, DEPTH_SPEED * delta)
	position.y = Persp.y_at(depth)
	var s := Persp.scale_at(depth)
	scale = Vector2(s, s)
	z_index = Persp.z_at(depth) + 5
	# перелистывание кадров ходьбы
	if sprite != null and walk_tex.size() > 0:
		frame_t += delta * (12.0 if anim != A.IDLE else 8.0)
		var idx: int = int(frame_t) % walk_tex.size()
		sprite.texture = walk_tex[idx]
		sprite.flip_h = facing < 0
		sprite.modulate = Color(1, 0.55, 0.45) if anim == A.HURT else (Color(1.25, 0.7, 0.6) if rage_active else Color.WHITE)
		sprite.visible = anim != A.DEAD

	if anim_left > 0.0:
		anim_left -= delta
		if anim_left <= 0.0:
			_finish_anim()
	parry_left = maxf(0.0, parry_left - delta)
	block_left = maxf(0.0, block_left - delta)
	dodge_left = maxf(0.0, dodge_left - delta)
	dash_left = maxf(0.0, dash_left - delta)
	dash_cd = maxf(0.0, dash_cd - delta)
	if combo_timer > 0.0:
		combo_timer -= delta
		if combo_timer <= 0.0:
			combo = 0
			changed.emit()
	if reload_left > 0.0:
		reload_left -= delta
		if reload_left <= 0.0:
			ammo = int(wdata.get("ammo", 0))
			changed.emit()
	if rage_active:
		rage_left -= delta
		rage -= (RAGE_MAX / RAGE_DURATION) * delta
		if rage_left <= 0.0:
			rage_active = false
			rage = 0.0
			changed.emit()
	queue_redraw()

func _finish_anim() -> void:
	if anim == A.DEAD:
		return
	anim = A.IDLE
	anim_left = 0.0
	changed.emit()

func is_busy() -> bool:
	return anim in [A.ATTACK, A.HEAVY_WINDUP, A.HEAVY_HIT, A.HURT, A.EXECUTE, A.DEAD, A.OBSTACLE, A.RELOAD, A.PARRY]

func is_dead() -> bool:
	return anim == A.DEAD

func is_invulnerable() -> bool:
	return dodge_left > 0.0 or dash_left > 0.0 or anim == A.EXECUTE or rage_active

func is_parrying() -> bool:
	return parry_left > 0.0

func is_blocking() -> bool:
	return block_left > 0.0

func damage_mult() -> float:
	return (2.0 if rage_active else 1.0) * gear_damage

func apply_gear(dmg_mult: float, hp_bonus: float, reduce: float) -> void:
	gear_damage = dmg_mult
	gear_reduce = clampf(reduce, 0.0, 0.85)
	max_hp = MAX_HP + hp_bonus
	hp = max_hp

func combo_coin_mult() -> float:
	return clampf(1.0 + float(combo) / 20.0, 1.0, 3.0)

# --- Атаки ----------------------------------------------------------

func face(dir: int) -> void:
	if dir != 0 and not is_busy():
		facing = dir

func do_light(dir: int) -> Dictionary:
	if is_busy() or is_dead():
		return {}
	if uses_ammo():
		if reload_left > 0.0:
			return {}
		if ammo <= 0:
			start_reload()
			return {}
		ammo -= 1
	face(dir)
	combo += 1
	combo_timer = COMBO_RESET
	anim = A.ATTACK
	anim_left = float(wdata["light_time"])
	var mult := 1.0
	var finisher := false
	if combo % int(wdata["combo_len"]) == 0:
		mult = float(wdata["combo_bonus"])
		finisher = true
	changed.emit()
	return {
		"range": float(wdata["light_range"]),
		"damage": float(wdata["light_damage"]) * mult * damage_mult(),
		"stun": float(wdata["light_stun"]) * (1.5 if finisher else 1.0),
		"knock": float(wdata["light_knock"]) * (2.0 if finisher else 1.0),
		"targets": int(wdata["light_targets"]) + (1 if finisher else 0),
		"around": false,
		"finisher": finisher,
	}

func start_heavy(dir: int) -> void:
	if is_busy() or is_dead():
		return
	if uses_ammo() and (reload_left > 0.0 or ammo < int(wdata.get("heavy_ammo_cost", 1))):
		return
	face(dir)
	anim = A.HEAVY_WINDUP
	anim_left = float(wdata["heavy_windup"])
	changed.emit()

func release_heavy() -> Dictionary:
	if anim != A.HEAVY_WINDUP:
		return {}
	if uses_ammo():
		ammo = maxi(0, ammo - int(wdata.get("heavy_ammo_cost", 1)))
	anim = A.HEAVY_HIT
	anim_left = 0.30
	combo += 1
	combo_timer = COMBO_RESET
	changed.emit()
	return {
		"range": float(wdata["heavy_range"]),
		"damage": float(wdata["heavy_damage"]) * damage_mult(),
		"stun": float(wdata["heavy_stun"]),
		"knock": float(wdata["heavy_knock"]),
		"targets": int(wdata["heavy_targets"]),
		"around": bool(wdata.get("heavy_around", false)),
		"heavy": true,
	}

func start_reload() -> void:
	if not uses_ammo() or reload_left > 0.0:
		return
	reload_left = float(wdata.get("reload_time", 1.4))
	anim = A.RELOAD
	anim_left = reload_left
	changed.emit()

func do_dodge(dir: int) -> void:
	if is_busy() or is_dead():
		return
	face(dir)
	anim = A.DODGE
	anim_left = DODGE_TIME
	dodge_left = DODGE_TIME
	changed.emit()

func do_parry(dir: int) -> void:
	if is_busy() or is_dead():
		return
	face(dir)
	anim = A.PARRY
	anim_left = PARRY_WINDOW + BLOCK_AFTER_PARRY
	parry_left = PARRY_WINDOW
	block_left = PARRY_WINDOW + BLOCK_AFTER_PARRY
	changed.emit()

# Рывок: дед проходит СКВОЗЬ зомби и оказывается за спиной толпы.
# Это ответ ближнего боя на окружение — без него короткая дистанция
# просто слабее длинной, а не другая по стилю.
func do_dash(dir: int) -> bool:
	if is_busy() or is_dead() or dash_cd > 0.0:
		return false
	facing = dir
	dash_dir = dir
	anim = A.DASH
	anim_left = DASH_TIME
	dash_left = DASH_TIME
	dash_cd = float(wdata.get("dash_cd", DASH_CD))
	changed.emit()
	return true

func dash_ready() -> bool:
	return dash_cd <= 0.0 and not is_busy() and not is_dead()

func do_obstacle() -> void:
	if is_dead():
		return
	anim = A.OBSTACLE
	anim_left = 0.5
	changed.emit()

func do_execute() -> void:
	if is_dead():
		return
	anim = A.EXECUTE
	anim_left = 0.85
	exec_meter = 0.0
	add_rage(20.0)
	changed.emit()

# --- Ресурсы --------------------------------------------------------

func add_rage(v: float) -> void:
	if rage_active:
		return
	rage = clampf(rage + v, 0.0, RAGE_MAX)
	changed.emit()

func add_exec(v: float) -> void:
	exec_meter = clampf(exec_meter + v, 0.0, EXEC_MAX)
	changed.emit()

func exec_ready() -> bool:
	return exec_meter >= EXEC_MAX

func rage_ready() -> bool:
	return rage >= RAGE_MAX and not rage_active

func activate_rage() -> void:
	if not rage_ready():
		return
	rage_active = true
	rage_left = RAGE_DURATION
	changed.emit()

func on_hit_landed() -> void:
	no_damage_streak += 1
	# каждые 10 чистых ударов — четверть шкалы добивания
	if no_damage_streak % 10 == 0:
		add_exec(25.0)

func perfect_parry() -> void:
	add_exec(30.0)
	add_rage(15.0)
	changed.emit()

func take_damage(v: float, unblockable: bool = false) -> void:
	if is_dead() or is_invulnerable():
		return
	var dmg := v * (1.0 - gear_reduce)
	if is_blocking() and not unblockable:
		dmg *= 0.3
	combo = 0
	combo_timer = 0.0
	no_damage_streak = 0
	hp = maxf(0.0, hp - dmg)
	damage_taken += dmg
	if hp <= 0.0:
		anim = A.DEAD
		anim_left = 0.0
		changed.emit()
		died.emit()
	else:
		if not is_blocking():
			anim = A.HURT
			anim_left = 0.22
		changed.emit()

func heal(v: float) -> void:
	hp = minf(max_hp, hp + v)
	changed.emit()

func reset() -> void:
	hp = max_hp
	damage_taken = 0.0
	rage = 0.0
	rage_active = false
	rage_left = 0.0
	exec_meter = 0.0
	anim = A.IDLE
	anim_left = 0.0
	combo = 0
	combo_timer = 0.0
	no_damage_streak = 0
	parry_left = 0.0
	block_left = 0.0
	dodge_left = 0.0
	dash_left = 0.0
	dash_cd = 0.0
	facing = 1
	depth = 0.5
	target_depth = 0.5
	set_weapon(weapon_id)
	changed.emit()

# --- Отрисовка ------------------------------------------------------

func _draw() -> void:
	if sprite != null:
		_draw_weapon_only()
		return
	var body_color := Color(0.20, 0.24, 0.38)
	if rage_active:
		body_color = Color(0.78, 0.22, 0.14)
	elif anim == A.HURT:
		body_color = Color(0.80, 0.45, 0.35)
	elif dodge_left > 0.0:
		body_color = Color(0.20, 0.24, 0.38, 0.45)
	elif anim == A.DEAD:
		body_color = Color(0.22, 0.22, 0.22)

	# тень на земле — без неё в перспективе не видно, где персонаж стоит
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	draw_circle(Vector2(0, -6), BODY_W * 0.46, Color(0, 0, 0, 0.22))

	var rect := Rect2(-BODY_W * 0.5, -BODY_H, BODY_W, BODY_H)
	if anim == A.DEAD:
		rect = Rect2(-BODY_H * 0.5, -BODY_W, BODY_H, BODY_W)
	elif dodge_left > 0.0:
		rect = Rect2(-BODY_W * 0.5, -BODY_H * 0.6, BODY_W, BODY_H * 0.6)
	draw_rect(rect, body_color)

	if anim == A.DEAD:
		return

	# борода — показывает, куда дед повёрнут
	var beard_x := -BODY_W * 0.5 + (18.0 if facing > 0 else 0.0)
	draw_rect(Rect2(beard_x, -BODY_H + 20.0, BODY_W * 0.72, 16.0), Color(0.88, 0.88, 0.84))

	var f := float(facing)
	var wcol := Color(0.60, 0.60, 0.66)
	match weapon_id:
		"long": wcol = Color(0.72, 0.66, 0.48)
		"fast": wcol = Color(0.85, 0.88, 0.92)
		"gun": wcol = Color(0.40, 0.32, 0.26)

	match anim:
		A.ATTACK:
			var len_px: float = float(wdata["light_range"]) * (0.5 if weapon_id == "gun" else 0.8)
			draw_rect(_dir_rect(len_px, 18.0, -BODY_H * 0.65, f), wcol)
		A.HEAVY_WINDUP:
			draw_rect(Rect2(-14.0, -BODY_H - 55.0, 18.0, 95.0), Color(0.95, 0.82, 0.25))
		A.HEAVY_HIT:
			if bool(wdata.get("heavy_around", false)):
				var r: float = float(wdata["heavy_range"])
				draw_rect(Rect2(-r, -BODY_H * 0.7, r * 2.0, 26.0), Color(0.95, 0.82, 0.25, 0.85))
			else:
				draw_rect(_dir_rect(float(wdata["heavy_range"]) * 0.8, 28.0, -BODY_H * 0.6, f), Color(0.95, 0.82, 0.25))
		A.PARRY:
			var c := Color(0.35, 0.85, 1.0) if parry_left > 0.0 else Color(0.35, 0.55, 0.85)
			draw_rect(_dir_rect(26.0, BODY_H, -BODY_H, f), c)
		A.EXECUTE:
			draw_rect(_dir_rect(180.0, 34.0, -BODY_H * 0.85, f), Color(0.95, 0.12, 0.12))
		A.DASH:
			var d := float(dash_dir)
			draw_rect(_dir_rect(120.0, 40.0, -BODY_H * 0.55, -d), Color(0.55, 0.75, 1.0, 0.55))
		A.OBSTACLE:
			draw_rect(Rect2(-BODY_W * 0.5, -BODY_H - 30.0, BODY_W, 14.0), Color(0.30, 0.85, 0.40))
		A.RELOAD:
			var t: float = 1.0 - reload_left / maxf(0.01, float(wdata.get("reload_time", 1.4)))
			draw_rect(Rect2(-BODY_W * 0.5, -BODY_H - 26.0, BODY_W * t, 10.0), Color(0.95, 0.75, 0.2))
			draw_rect(_dir_rect(60.0, 14.0, -BODY_H * 0.5, f), wcol)
		_:
			draw_rect(_dir_rect(16.0, 92.0, -BODY_H * 0.78, f), wcol)

	# патроны
	if uses_ammo():
		for i in range(int(wdata["ammo"])):
			var filled: bool = i < ammo
			draw_rect(Rect2(-BODY_W * 0.5 + float(i) * 18.0, -BODY_H - 20.0, 14.0, 8.0),
				Color(0.95, 0.8, 0.2) if filled else Color(0.3, 0.3, 0.3))

func _dir_rect(length: float, thick: float, y: float, f: float) -> Rect2:
	if f > 0.0:
		return Rect2(BODY_W * 0.5, y, length, thick)
	return Rect2(-BODY_W * 0.5 - length, y, length, thick)


# Когда есть спрайт деда, из старой отрисовки оставляем только тень и оружие
func _draw_weapon_only() -> void:
	draw_circle(Vector2(0, -10), BODY_W * 0.34, Color(0, 0, 0, 0.20))
	var f := float(facing)
	match anim:
		A.ATTACK:
			draw_rect(_dir_rect(float(wdata["light_range"]) * 0.8, 18.0, -BODY_H * 0.65, f), Color(0.85, 0.85, 0.9, 0.9))
		A.HEAVY_HIT:
			draw_rect(_dir_rect(float(wdata["heavy_range"]) * 0.8, 26.0, -BODY_H * 0.6, f), Color(0.95, 0.82, 0.25))
		A.HEAVY_WINDUP:
			draw_rect(Rect2(-12.0, -BODY_H - 50.0, 16.0, 80.0), Color(0.95, 0.82, 0.25))
		A.PARRY:
			draw_rect(_dir_rect(22.0, BODY_H * 0.8, -BODY_H * 0.8, f), Color(0.35, 0.85, 1.0) if parry_left > 0.0 else Color(0.35, 0.55, 0.85))
		A.EXECUTE:
			draw_rect(_dir_rect(170.0, 30.0, -BODY_H * 0.85, f), Color(0.95, 0.12, 0.12))
