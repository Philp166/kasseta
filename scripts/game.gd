extends Node2D

# Каркас «Кассеты». Явные preload вместо class_name — проект запускается
# и напрямую (godot --path ...), без импорта в редакторе.
const Player = preload("res://scripts/player.gd")
const Enemy = preload("res://scripts/enemy.gd")
const LevelGen = preload("res://scripts/levelgen.gd")
const Weapons = preload("res://scripts/weapons.gd")
const Persp = preload("res://scripts/persp.gd")
const Items = preload("res://scripts/items.gd")
const Shell = preload("res://scripts/ui.gd")
const Fonts = preload("res://scripts/fonts.gd")

const GROUND_Y := 540.0
const PLAYER_X := 640.0            # дед по центру: толпа приходит с двух сторон
const SPAWN_RIGHT := 1500.0
const SPAWN_LEFT := -220.0
const SCROLL_SPEED := 175.0
const APPROACH_SPEED := 120.0
const CELL_DISTANCE := 900.0
const ROAD_TOP := 510.0    # верх дороги на экране: по этой линии ходят персонажи

enum S {MENU, WALK, FIGHT, OBSTACLE, WIN, LOSE}

var state: int = S.MENU
var level: int = 1
var cells: Array = []
var cell_index: int = 0
var walk_left: float = 0.0

var enemies: Array = []
var projectiles: Array = []
var spawn_queue: Array = []
var wave_time: float = 0.0

var obstacle_left: float = 0.0
var obstacle_window: float = 1.5
var obstacle_passed: bool = false

var coins_run: int = 0
var kills_run: int = 0
var exec_run: int = 0
var parries_run: int = 0
var best_combo: int = 0

var world: Node2D
var player: Player
var hud: CanvasLayer
var camera: Camera2D
var bg_layers: Array = []

var test_mode: bool = false     # автотест: без хитстопа, чтобы прогон шёл быстро
var shake: float = 0.0
var hitstop_until: float = 0.0     # реальное время (мс), не зависит от time_scale

var lbl_top: Label
var lbl_combo: Label
var hp_bar: ColorRect
var rage_bar: ColorRect
var exec_bar: ColorRect
var btn_exec: Button
var btn_rage: Button
var btn_obstacle: Button
var shell: CanvasLayer
var combat_hud: Control
var lbl_hint: Label
var progress_bar: ColorRect
var weapon_buttons: Array = []

var _touch_start := Vector2.ZERO
var _touch_time := 0.0
var _holding := false
var _hold_dir := 1
var _revived := false

func _ready() -> void:
	world = Node2D.new()
	add_child(world)
	_build_background()

	camera = Camera2D.new()
	camera.position = Vector2(640, 360)
	camera.enabled = true
	add_child(camera)

	player = Player.new()
	player.position = Vector2(PLAYER_X, Persp.y_at(0.5))
	player.died.connect(_on_player_died)
	add_child(player)

	_build_hud()
	shell = Shell.new()
	add_child(shell)
	shell.play_requested.connect(_on_play_requested)
	_show_menu()

# ------------------------------------------------------------- фон

func _build_background() -> void:
	# Дальний фон — прежняя панорама, но обрезанная по чистому небу с обоих
	# краёв: на стыке копий встречается пустое небо, поэтому шов не читается.
	var bd = Fonts.texture("res://art/bg/backdrop.png")
	if bd != null:
		var back := BgLayer.new()
		back.setup(bd, 0.0, ROAD_TOP + 6.0, 0.30, -20, 1.0)
		add_child(back)
		bg_layers.append(back)

	var rd = Fonts.texture("res://art/bg/road.png")
	if rd != null:
		var road := BgLayer.new()
		road.setup(rd, ROAD_TOP, 760.0 - ROAD_TOP, 1.0, -10, 0.0)
		add_child(road)
		bg_layers.append(road)

	if bg_layers.is_empty():
		var sky := ColorRect.new()
		sky.color = Color(0.80, 0.83, 0.86)
		sky.position = Vector2(-60, -60)
		sky.size = Vector2(1400, ROAD_TOP + 60)
		sky.z_index = -20
		add_child(sky)

# ------------------------------------------------------------- HUD

func _mk_label(text: String, pos: Vector2, size_px: int) -> Label:
	var l := Label.new()
	l.text = text
	l.position = pos
	l.add_theme_font_override("font", Fonts.black())
	l.add_theme_font_size_override("font_size", size_px)
	l.add_theme_color_override("font_color", Color(0.1, 0.1, 0.1))
	return l

func _mk_button(text: String, pos: Vector2, size: Vector2, font_size: int = 26) -> Button:
	var b := Button.new()
	b.text = text
	b.position = pos
	b.size = size
	b.add_theme_font_override("font", Fonts.black())
	b.add_theme_font_size_override("font_size", font_size)
	return b

var _bar_backs: Array = []

func _mk_bar(pos: Vector2, size: Vector2, col: Color) -> ColorRect:
	var bg := ColorRect.new()
	bg.color = Color(0, 0, 0, 0.35)
	bg.position = pos
	bg.size = size
	hud.add_child(bg)
	_bar_backs.append(bg)
	var bar := ColorRect.new()
	bar.color = col
	bar.position = pos
	bar.size = Vector2(0, size.y)
	hud.add_child(bar)
	return bar

func _build_hud() -> void:
	hud = CanvasLayer.new()
	add_child(hud)

	lbl_top = _mk_label("", Vector2(24, 14), 22)
	hud.add_child(lbl_top)

	hp_bar = _mk_bar(Vector2(24, 46), Vector2(360, 24), Color(0.85, 0.25, 0.2))
	rage_bar = _mk_bar(Vector2(24, 74), Vector2(360, 12), Color(0.95, 0.6, 0.15))
	exec_bar = _mk_bar(Vector2(24, 90), Vector2(360, 12), Color(0.9, 0.15, 0.15))

	lbl_combo = _mk_label("", Vector2(430, 46), 34)
	lbl_combo.add_theme_color_override("font_color", Color(0.85, 0.35, 0.1))
	hud.add_child(lbl_combo)

	progress_bar = ColorRect.new()
	progress_bar.color = Color(0.2, 0.5, 0.8)
	progress_bar.size = Vector2(0, 6)
	hud.add_child(progress_bar)

	btn_exec = _mk_button("ДОБИТЬ", Vector2(950, 470), Vector2(300, 90), 34)
	btn_exec.visible = false
	btn_exec.pressed.connect(_do_execute)
	hud.add_child(btn_exec)

	btn_rage = _mk_button("ЯРОСТЬ", Vector2(950, 386), Vector2(300, 70))
	btn_rage.visible = false
	btn_rage.pressed.connect(func(): player.activate_rage())
	hud.add_child(btn_rage)

	btn_obstacle = _mk_button("ПЕРЕЛЕЗТЬ ↑", Vector2(490, 220), Vector2(300, 90), 30)
	btn_obstacle.visible = false
	btn_obstacle.pressed.connect(_do_obstacle)
	hud.add_child(btn_obstacle)


	lbl_hint = _mk_label("", Vector2(24, 622), 20)
	hud.add_child(lbl_hint)


func _set_weapon(id: String) -> void:
	player.set_weapon(id)
	_set_hint("Оружие: " + player.weapon_name())

# ------------------------------------------------------------ меню

func _show_menu() -> void:
	state = S.MENU
	Engine.time_scale = 1.0
	btn_exec.visible = false
	btn_rage.visible = false
	btn_obstacle.visible = false
	_clear_field()
	_set_combat_hud(false)
	if shell != null:
		shell.show_screen(shell.SC.HUB)

func _clear_field() -> void:
	for e in enemies:
		if is_instance_valid(e):
			e.queue_free()
	enemies.clear()
	for p in projectiles:
		if is_instance_valid(p):
			p.queue_free()
	projectiles.clear()
	spawn_queue.clear()

func _set_combat_hud(on: bool) -> void:
	for n in [lbl_top, lbl_combo, lbl_hint, progress_bar]:
		if n != null:
			n.visible = on
	for b in [hp_bar, rage_bar, exec_bar]:
		if b != null:
			b.visible = on
	for bgn in _bar_backs:
		if is_instance_valid(bgn):
			bgn.visible = on
	for wb in weapon_buttons:
		wb["btn"].visible = false
	if not on:
		btn_exec.visible = false
		btn_rage.visible = false
		btn_obstacle.visible = false

func _on_play_requested(lvl: int) -> void:
	if not Data.spend_energy(lvl):
		return
	level = lvl
	shell.hide_all()
	_set_combat_hud(true)
	_begin()

# ------------------------------------------------------ старт уровня

func _start_level() -> void:
	if not Data.spend_energy(level):
		return
	shell.hide_all()
	_set_combat_hud(true)
	_begin()

func _retry() -> void:
	shell.hide_all()
	_set_combat_hud(true)
	_begin()

func _revive() -> void:
	shell.hide_all()
	_set_combat_hud(true)
	_revived = true
	player.reset()
	player.hp = player.max_hp * 0.5
	state = S.FIGHT if enemies.size() > 0 else S.WALK
	_update_hud()

func _begin() -> void:
	# снаряжение из профиля: класс оружия, множитель урона, броня
	player.set_weapon(Data.weapon_class())
	player.apply_gear(Data.weapon_mult(), Data.armor_hp(), Data.armor_reduce())
	kills_run = 0
	cells = LevelGen.build(level)
	cell_index = 0
	coins_run = 0
	exec_run = 0
	parries_run = 0
	best_combo = 0
	_revived = false
	_clear_field()
	player.reset()
	player.position = Vector2(PLAYER_X, Persp.y_at(0.5))
	_next_cell()
	_update_hud()

func _next_cell() -> void:
	if cell_index >= cells.size():
		_win()
		return
	var cell: Dictionary = cells[cell_index]
	cell_index += 1
	match String(cell.get("type", "rest")):
		"wave", "boss":
			spawn_queue.clear()
			wave_time = 0.0
			if String(cell["type"]) == "boss":
				spawn_queue.append({"kind": String(cell.get("kind", "boss_ch1")), "delay": 0.4, "side": 1, "lane": 0.5})
			else:
				var last_group := -1
				var group_side := 1
				for e in cell["enemies"]:
					# кучка заходит целиком с одной стороны; каждая вторая — со спины
					var grp := int(e.get("group", 0))
					if grp != last_group:
						last_group = grp
						group_side = -1 if (grp % 2 == 1) else 1
					spawn_queue.append({
						"kind": String(e["kind"]),
						"delay": float(e["delay"]),
						"side": group_side,
						"lane": float(e.get("lane", 0.5)),
					})
			state = S.WALK
			walk_left = CELL_DISTANCE * 0.35
			_set_hint("Впереди зомби")
		"obstacle":
			state = S.WALK
			walk_left = CELL_DISTANCE * 0.5
			obstacle_window = float(cell.get("window", 1.5))
			_set_hint("Впереди препятствие")
		"rest":
			var c := int(cell.get("coins", 3))
			coins_run += c
			state = S.WALK
			walk_left = CELL_DISTANCE * 0.4
			_set_hint("Передышка: +%d монет" % c)
		_:
			state = S.WALK
			walk_left = CELL_DISTANCE * 0.4

# ------------------------------------------------------- игровой цикл

func _process(delta: float) -> void:
	_update_effects(delta)
	if state == S.MENU or state == S.WIN or state == S.LOSE:
		return

	match state:
		S.WALK:
			_scroll(SCROLL_SPEED * delta)
			walk_left -= SCROLL_SPEED * delta
			if walk_left <= 0.0:
				_arrive()
		S.FIGHT:
			_process_fight(delta)
		S.OBSTACLE:
			obstacle_left -= delta
			if obstacle_left <= 0.0 and not obstacle_passed:
				_obstacle_failed()

	_process_projectiles(delta)
	_update_hud()

func _update_effects(delta: float) -> void:
	# хитстоп: возвращаем нормальную скорость по реальным часам
	if hitstop_until > 0.0 and Time.get_ticks_msec() >= hitstop_until:
		hitstop_until = 0.0
		Engine.time_scale = 1.0
	if shake > 0.0:
		shake = maxf(0.0, shake - delta * 60.0)
		camera.offset = Vector2(randf_range(-shake, shake), randf_range(-shake, shake))
	else:
		camera.offset = Vector2.ZERO

func _hitstop(ms: int, shake_px: float) -> void:
	if test_mode:
		shake = maxf(shake, shake_px)
		return
	Engine.time_scale = 0.06
	hitstop_until = Time.get_ticks_msec() + ms
	shake = maxf(shake, shake_px)

func _scroll(px: float) -> void:
	for layer in bg_layers:
		layer.advance(px)

func _arrive() -> void:
	var prev: Dictionary = cells[cell_index - 1]
	match String(prev.get("type", "rest")):
		"wave", "boss":
			state = S.FIGHT
			wave_time = 0.0
		"obstacle":
			state = S.OBSTACLE
			obstacle_left = obstacle_window
			obstacle_passed = false
			btn_obstacle.visible = true
			_set_hint("Свайп вверх / W — перелезть!")
		_:
			_next_cell()

func _process_fight(delta: float) -> void:
	wave_time += delta
	var i := 0
	while i < spawn_queue.size():
		var s: Dictionary = spawn_queue[i]
		if wave_time >= float(s["delay"]):
			_spawn_enemy(String(s["kind"]), int(s.get("side", 1)), float(s.get("lane", 0.5)))
			spawn_queue.remove_at(i)
		else:
			i += 1

	var alive: Array = []
	for e in enemies:
		if is_instance_valid(e) and not e.is_dead():
			alive.append(e)
	enemies = alive

	if enemies.is_empty() and spawn_queue.is_empty():
		btn_exec.visible = false
		_next_cell()
		return

	# каждый враг знает, на какую глубину сводиться
	for e in enemies:
		e.target_depth = player.depth
	# дед доворачивает по глубине к ближайшему врагу
	var closest = null
	var cd := 99999.0
	for e in enemies:
		var d0: float = absf(e.position.x - player.position.x)
		if d0 < cd:
			cd = d0
			closest = e
	if closest != null and cd < 420.0:
		player.target_depth = clampf(closest.depth, 0.12, 0.9)

	# дед наступает, если все враги вне досягаемости
	var nearest := 99999.0
	for e in enemies:
		nearest = minf(nearest, absf(e.position.x - player.position.x))
	# Сближаться надо ДО дистанции своего удара, а не до чужой:
	# бегун бил с 190, мачете достаёт на 165 — дед стоял и не мог ответить.
	if nearest > float(player.wdata["light_range"]) * 0.8:
		var step := APPROACH_SPEED * delta
		for e in enemies:
			e.position.x -= step * float(e.side)
		_scroll(step)

	_separate_enemies()
	btn_exec.visible = player.exec_ready() and _find_executable() != null

# Зомби не должны сливаться в один прямоугольник: расталкиваем по X тех,
# кто стоит на одной глубине слишком близко.
func _separate_enemies() -> void:
	for i in range(enemies.size()):
		var a = enemies[i]
		if not is_instance_valid(a) or a.is_dead():
			continue
		for j in range(i + 1, enemies.size()):
			var b = enemies[j]
			if not is_instance_valid(b) or b.is_dead():
				continue
			if absf(a.depth - b.depth) > 0.10:
				continue
			var dx: float = b.position.x - a.position.x
			var min_gap: float = 62.0
			if absf(dx) < min_gap:
				var push: float = (min_gap - absf(dx)) * 0.5
				var s: float = 1.0 if dx >= 0.0 else -1.0
				a.position.x -= push * s
				b.position.x += push * s

func _spawn_enemy(kind: String, side: int, lane: float = 0.5) -> void:
	var e := Enemy.new()
	e.setup(kind)
	e.side = side
	e.depth = lane
	e.target_depth = lane
	var jitter := randf_range(0.0, 190.0)
	e.position = Vector2((SPAWN_RIGHT + jitter) if side > 0 else (SPAWN_LEFT - jitter), Persp.y_at(lane))
	e.target_x = PLAYER_X
	e.on_hit_player = Callable(self, "_enemy_hits_player")
	e.killed.connect(_on_enemy_killed)
	e.wants_projectile.connect(_spawn_projectile)
	e.wants_explosion.connect(_explode)
	add_child(e)
	enemies.append(e)

func _enemy_hits_player(e, damage: float, unblockable: bool) -> void:
	if state != S.FIGHT:
		return
	# идеальное парирование
	if player.is_parrying() and is_instance_valid(e) and not unblockable and bool(e.data.get("parryable", false)):
		_on_parry(e)
		return
	if player.is_invulnerable():
		_float_text("уклон", player.position, Color(0.4, 0.8, 1.0))
		return
	player.take_damage(damage, unblockable)
	shake = maxf(shake, 6.0)
	_float_text("-%d" % int(damage), player.position + Vector2(0, -170), Color(1, 0.35, 0.3))

func _on_parry(e) -> void:
	e.on_parried()
	player.perfect_parry()
	parries_run += 1
	_hitstop(90, 8.0)
	_float_text("ПАРИРОВАНИЕ", player.position + Vector2(0, -200), Color(0.35, 0.9, 1.0))

func _on_enemy_killed(e) -> void:
	kills_run += 1
	var mult := player.combo_coin_mult()
	var gain := int(round(float(e.coins_value()) * mult))
	coins_run += gain
	_float_text("+%d" % gain, e.position + Vector2(0, -150), Color(0.95, 0.85, 0.3))
	shake = maxf(shake, 3.0)
	var dead = e
	var tw := create_tween()
	tw.tween_interval(1.2)
	tw.tween_callback(func():
		if is_instance_valid(dead):
			dead.queue_free()
	)

func _explode(at_pos: Vector2, damage: float, radius: float) -> void:
	_hitstop(70, 14.0)
	_float_text("ВЗРЫВ", at_pos + Vector2(0, -180), Color(1.0, 0.6, 0.1))
	for e in enemies:
		if not is_instance_valid(e) or e.is_dead():
			continue
		if absf(e.position.x - at_pos.x) <= radius:
			e.take_splash(damage)
	if absf(player.position.x - at_pos.x) <= radius * 0.6:
		player.take_damage(damage * 0.5, true)

# --------------------------------------------------------- снаряды

func _spawn_projectile(from_pos: Vector2, dir: int, damage: float) -> void:
	var p := Projectile.new()
	p.position = from_pos
	p.dir = dir
	p.damage = damage
	p.z_index = 8
	add_child(p)
	projectiles.append(p)

func _process_projectiles(delta: float) -> void:
	var alive: Array = []
	for p in projectiles:
		if not is_instance_valid(p):
			continue
		p.position.x += p.speed * float(p.dir) * delta
		p.queue_redraw()
		var hit := absf(p.position.x - player.position.x) < 45.0
		if hit:
			if player.is_invulnerable():
				_float_text("уклон", player.position, Color(0.4, 0.8, 1.0))
			else:
				player.take_damage(p.damage, false)
				_float_text("-%d" % int(p.damage), player.position + Vector2(0, -170), Color(1, 0.35, 0.3))
			p.queue_free()
			continue
		if p.position.x < -300.0 or p.position.x > 1600.0:
			p.queue_free()
			continue
		alive.append(p)
	projectiles = alive

# ------------------------------------------------------- действия

func _side_of(x: float) -> int:
	return 1 if x >= 640.0 else -1

func _apply_hit(hit: Dictionary) -> void:
	if hit.is_empty():
		return
	var around: bool = bool(hit.get("around", false))
	var targets: int = int(hit["targets"])
	var rng: float = float(hit["range"])
	var candidates: Array = []
	for e in enemies:
		if not is_instance_valid(e) or e.is_dead():
			continue
		var dx: float = e.position.x - player.position.x
		if not around and signf(dx) != signf(float(player.facing)) and absf(dx) > 40.0:
			continue
		if absf(dx) > rng:
			continue
		# по глубине бьём в полосе: тяжёлые и круговые удары шире
		var band: float = 0.34 if not around else 0.55
		if bool(hit.get("heavy", false)):
			band = 0.46
		if absf(e.depth - player.depth) > band:
			continue
		candidates.append(e)
	candidates.sort_custom(func(a, b): return absf(a.position.x - player.position.x) < absf(b.position.x - player.position.x))

	var n := 0
	for e in candidates:
		if n >= targets:
			break
		var power := 0
		if bool(hit.get("heavy", false)):
			power = 2
		elif bool(hit.get("finisher", false)):
			power = 1
		e.take_hit(float(hit["damage"]), float(hit["stun"]), float(hit["knock"]), power)
		n += 1
	if n > 0:
		player.on_hit_landed()
		best_combo = maxi(best_combo, player.combo)
		if bool(hit.get("heavy", false)):
			_hitstop(60, 9.0)
		elif bool(hit.get("finisher", false)):
			_hitstop(45, 6.0)
		else:
			shake = maxf(shake, 2.0)

func _do_light(dir: int) -> void:
	if state != S.FIGHT:
		return
	_apply_hit(player.do_light(dir))

func _do_heavy_start(dir: int) -> void:
	if state != S.FIGHT:
		return
	player.start_heavy(dir)

func _do_heavy_release() -> void:
	if state != S.FIGHT:
		return
	_apply_hit(player.release_heavy())

func _do_parry(dir: int) -> void:
	if state != S.FIGHT:
		return
	player.do_parry(dir)

func _find_executable():
	var best = null
	var best_d := 99999.0
	for e in enemies:
		if not is_instance_valid(e) or e.is_dead():
			continue
		if not e.is_executable():
			continue
		var d: float = absf(e.position.x - player.position.x)
		if d < best_d and d < 260.0:
			best = e
			best_d = d
	return best

func _do_execute() -> void:
	if not player.exec_ready():
		return
	var target = _find_executable()
	if target == null:
		return
	player.face(1 if target.position.x > player.position.x else -1)
	player.do_execute()
	exec_run += 1
	coins_run += target.coins_value() * 4
	_hitstop(320, 18.0)
	_float_text("ДОБИТ", target.position + Vector2(0, -200), Color(1.0, 0.15, 0.15))
	target.die()
	# соседи в ужасе замирают — добивание чистит толпу
	for e in enemies:
		if is_instance_valid(e) and absf(e.position.x - target.position.x) < 320.0:
			e.fear(1.1)
	btn_exec.visible = false

func _do_dash(dir: int) -> void:
	if state != S.FIGHT:
		return
	if not player.do_dash(dir):
		return
	var dist: float = Player.DASH_DISTANCE
	# дед по центру экрана, поэтому "проход сквозь толпу" = сдвиг мира навстречу
	for e in enemies:
		if is_instance_valid(e):
			e.position.x -= dist * float(dir)
			# кого прошли насквозь — расталкиваем и сбиваем с замаха
			if absf(e.position.x - player.position.x) < 120.0:
				e.fear(0.5)
	_scroll(dist * 0.35)
	_float_text("рывок", player.position + Vector2(0, -190), Color(0.6, 0.8, 1.0))
	shake = maxf(shake, 4.0)

func _do_obstacle() -> void:
	if state != S.OBSTACLE or obstacle_passed:
		return
	obstacle_passed = true
	btn_obstacle.visible = false
	player.do_obstacle()
	_set_hint("Перелез")
	var tw := create_tween()
	tw.tween_interval(0.5)
	tw.tween_callback(_next_cell)

func _obstacle_failed() -> void:
	obstacle_passed = true
	btn_obstacle.visible = false
	player.take_damage(12.0, true)
	_set_hint("Не успел — удар о препятствие")
	if player.is_dead():
		return
	var tw := create_tween()
	tw.tween_interval(0.8)
	tw.tween_callback(_next_cell)

# ---------------------------------------------------------- ввод

func _unhandled_input(event: InputEvent) -> void:
	if state == S.MENU or state == S.WIN or state == S.LOSE:
		return

	if event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_RIGHT, KEY_SPACE:
				_do_light(1)
			KEY_LEFT:
				_do_light(-1)
			KEY_F:
				_do_heavy_start(player.facing)
			KEY_S:
				player.do_dodge(player.facing)
			KEY_Q:
				_do_dash(-1)
			KEY_X:
				_do_dash(1)
			KEY_D:
				_do_parry(1)
			KEY_A:
				_do_parry(-1)
			KEY_W:
				_do_obstacle()
			KEY_E:
				_do_execute()
			KEY_R:
				player.activate_rage()
			KEY_1:
				_set_weapon("heavy")
			KEY_2:
				_set_weapon("long")
			KEY_3:
				_set_weapon("fast")
			KEY_4:
				_set_weapon("gun")
	elif event is InputEventKey and not event.pressed and event.keycode == KEY_F:
		_do_heavy_release()

	if event is InputEventScreenTouch or (event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT):
		if event.pressed:
			_touch_start = event.position
			_touch_time = Time.get_ticks_msec() / 1000.0
			_holding = true
			_hold_dir = _side_of(event.position.x)
			_do_heavy_start(_hold_dir)
		else:
			if not _holding:
				return
			_holding = false
			var dv: Vector2 = event.position - _touch_start
			var held: float = Time.get_ticks_msec() / 1000.0 - _touch_time
			player.anim = Player.A.IDLE
			if dv.y > 70.0 and absf(dv.y) > absf(dv.x):
				player.do_dodge(_hold_dir)
			elif dv.y < -70.0 and absf(dv.y) > absf(dv.x):
				_do_obstacle()
			elif absf(dv.x) > 220.0:
				_do_dash(1 if dv.x > 0.0 else -1)
			elif absf(dv.x) > 70.0:
				_do_parry(1 if dv.x > 0.0 else -1)
			elif held >= 0.4:
				player.anim = Player.A.HEAVY_WINDUP
				_do_heavy_release()
			else:
				_do_light(_side_of(event.position.x))

# ---------------------------------------------------- конец уровня

func _run_stats() -> Dictionary:
	return {
		"kills": kills_run, "execs": exec_run, "parries": parries_run,
		"best_combo": best_combo, "damage_taken": int(player.damage_taken),
	}

func _on_player_died() -> void:
	if state == S.LOSE:
		return
	state = S.LOSE
	Engine.time_scale = 1.0
	_set_combat_hud(false)
	Data.add_coins(int(coins_run * 0.5))
	Data.save_game()
	var res := _run_stats()
	res["coins"] = coins_run
	res["reward"] = 0
	res["total"] = int(coins_run * 0.5)
	shell.show_results(false, level, res, not _revived,
		Callable(self, "_retry"), Callable(self, "_next_level"), Callable(self, "_revive"))

func _win() -> void:
	state = S.WIN
	Engine.time_scale = 1.0
	_set_combat_hud(false)
	var reward := LevelGen.level_reward(level)
	var total := coins_run + reward
	# звёзды: пройти + без урона + комбо 30
	var st := 1
	if int(player.damage_taken) == 0:
		st += 1
	if best_combo >= 30:
		st += 1
	Data.level_done(level, total, st, _run_stats())
	var res := _run_stats()
	res["coins"] = coins_run
	res["reward"] = reward
	res["total"] = total
	res["stars"] = st
	shell.show_results(true, level, res, false,
		Callable(self, "_retry"), Callable(self, "_next_level"), Callable(self, "_revive"))

func _next_level() -> void:
	_set_combat_hud(false)
	_clear_field()
	state = S.MENU
	shell.pending_level = mini(Data.level, Items.total_levels())
	shell.show_screen(shell.SC.LOADOUT)

# ---------------------------------------------------------- HUD

func _set_hint(t: String) -> void:
	if lbl_hint != null:
		lbl_hint.text = t

func _float_text(txt: String, pos: Vector2, col: Color) -> void:
	var l := Label.new()
	l.text = txt
	l.position = pos + Vector2(-40, 0)
	l.add_theme_font_override("font", Fonts.black())
	l.add_theme_font_size_override("font_size", 30)
	l.add_theme_color_override("font_color", col)
	l.z_index = 50
	add_child(l)
	var tw := create_tween()
	tw.set_parallel(true)
	tw.tween_property(l, "position", l.position + Vector2(0, -70), 0.8)
	tw.tween_property(l, "modulate:a", 0.0, 0.8)
	tw.chain().tween_callback(l.queue_free)

func _update_hud() -> void:
	hp_bar.size.x = 360.0 * (player.hp / player.max_hp)
	rage_bar.size.x = 360.0 * (player.rage / Player.RAGE_MAX)
	exec_bar.size.x = 360.0 * (player.exec_meter / Player.EXEC_MAX)
	btn_rage.visible = player.rage_ready() and state == S.FIGHT
	progress_bar.size.x = 1280.0 * (float(cell_index) / float(maxi(1, cells.size())))
	lbl_combo.text = ("x%d  (монеты ×%.1f)" % [player.combo, player.combo_coin_mult()]) if player.combo >= 2 else ""
	lbl_top.text = "Ур.%d  %d/%d  монеты %d  убито %d  добив. %d  парир. %d  %s" % [
		level, cell_index, cells.size(), coins_run, kills_run, exec_run, parries_run, player.weapon_name()]

# --------------------------------------------------- вспомогательные

class Projectile extends Node2D:
	var dir: int = -1
	var damage: float = 10.0
	var speed: float = 430.0
	func _draw() -> void:
		draw_rect(Rect2(-14, -10, 28, 20), Color(0.35, 0.85, 0.55))

class BgLayer extends Node2D:
	var tex: Texture2D
	var off: float = 0.0
	var y: float = 0.0
	var h: float = 100.0        # высота полосы на экране
	var factor: float = 1.0
	var anchor: float = 0.0     # 0 — берём верх картинки, 1 — низ

	func setup(t: Texture2D, top: float, height: float, f: float, z: int, anch: float) -> void:
		tex = t
		y = top
		h = height
		factor = f
		z_index = z
		anchor = anch

	func advance(px: float) -> void:
		off = fmod(off + px * factor, float(tex.get_width()))
		queue_redraw()

	func _draw() -> void:
		var tw := float(tex.get_width())
		var th := float(tex.get_height())
		# берём из картинки полосу ровно нужной высоты — без сжатия
		var src_h: float = minf(h, th)
		var src_y: float = (th - src_h) * anchor
		var x := -off - 60.0
		while x < 1400.0:
			draw_texture_rect_region(tex, Rect2(x, y, tw, src_h), Rect2(0, src_y, tw, src_h))
			x += tw


# Слой рассыпанных объектов: бесконечная лента без повторов и стыков
class ScatterLayer extends Node2D:
	var tex: Dictionary = {}
	var heights: Dictionary = {}
	var items: Array = []
	var base_y: float = 0.0
	var factor: float = 0.35
	var gap_min: float = 140.0
	var gap_max: float = 600.0
	var jitter_y: bool = false
	var scroll: float = 0.0
	var next_x: float = 0.0
	var rng := RandomNumberGenerator.new()

	func setup(ground_y: float, f: float, z: int, names: Array, hh: Dictionary,
			gmin: float, gmax: float, floaty: bool) -> void:
		base_y = ground_y
		factor = f
		z_index = z
		heights = hh
		gap_min = gmin
		gap_max = gmax
		jitter_y = floaty
		rng.seed = 20260910 + z
		var fonts = preload("res://scripts/fonts.gd")
		for n in names:
			var t = fonts.texture("res://art/bgobj/%s.png" % n)
			if t != null:
				tex[n] = t
		next_x = -300.0
		while next_x < 1700.0:
			_spawn()

	func _spawn() -> void:
		if tex.is_empty():
			next_x += 400.0
			return
		var keys: Array = tex.keys()
		var n: String = String(keys[rng.randi_range(0, keys.size() - 1)])
		var t = tex[n]
		var h: float = float(heights.get(n, 160.0)) * rng.randf_range(0.88, 1.15)
		var w: float = float(t.get_width()) * h / float(t.get_height())
		var dy: float = rng.randf_range(-90.0, 60.0) if jitter_y else 0.0
		items.append({"x": next_x, "t": t, "w": w, "h": h, "dy": dy})
		next_x += w + rng.randf_range(gap_min, gap_max)

	func advance(px: float) -> void:
		scroll += px * factor
		while next_x - scroll < 1700.0:
			_spawn()
		var alive: Array = []
		for it in items:
			if it["x"] - scroll + it["w"] > -400.0:
				alive.append(it)
		items = alive
		queue_redraw()

	func _draw() -> void:
		for it in items:
			var x: float = it["x"] - scroll
			if x > 1450.0:
				continue
			draw_texture_rect(it["t"], Rect2(x, base_y - it["h"] + it["dy"], it["w"], it["h"]), false)
