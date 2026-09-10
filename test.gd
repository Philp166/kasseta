extends Node
const Items = preload("res://scripts/items.gd")

# Автотест обвязки: бот проходит несколько уровней подряд, копит монеты,
# покупает оружие и броню, забирает ачивки. Проверяем, что петля замкнута.

var game: Node2D
var sh
var t := 0.0
var hb := 0.0
var phase := 0
var runs := 0
var target_runs := 2

func _ready() -> void:
	game = load("res://main.tscn").instantiate()
	add_child(game)
	await get_tree().process_frame
	Data.reset_progress()
	game.test_mode = true
	sh = game.shell
	Engine.time_scale = 6.0
	print("== СТАРТ. монет=", Data.coins, " энергия=", Data.energy)

func _bot() -> void:
	var p = game.player
	if p.is_dead(): return
	var near = null
	var nd := 99999.0
	for e in game.enemies:
		if not is_instance_valid(e) or e.is_dead(): continue
		var d: float = absf(e.position.x - p.position.x)
		if d < nd: nd = d; near = e
	if near == null: return
	var dir: int = 1 if near.position.x > p.position.x else -1
	if near.state == near.E.WINDUP and nd < 280.0:
		if near.can_be_parried() and near.state_left < 0.20:
			game._do_parry(dir); return
		if not near.can_be_parried() and near.state_left < 0.18:
			p.do_dodge(dir); return
	if p.exec_ready() and game._find_executable() != null:
		game._do_execute(); return
	if p.rage_ready(): p.activate_rage()
	game._do_light(dir)

func _process(delta: float) -> void:
	t += delta
	hb += delta
	if game == null: return
	if hb > 25.0:
		hb = 0.0
		print("      ...фаза ", phase, " state=", game.state, " ур=", Data.level, " монет=", Data.coins)

	match phase:
		0:
			if t > 0.4:
				Data.refill_energy()
				game._on_play_requested(Data.level)
				phase = 1; t = 0.0
		1:
			if game.state == game.S.FIGHT: _bot()
			elif game.state == game.S.OBSTACLE: game._do_obstacle()
			elif game.state == game.S.WIN or game.state == game.S.LOSE:
				runs += 1
				print("   уровень ", game.level, ": ", "пройден" if game.state == game.S.WIN else "смерть",
					"  монет всего=", Data.coins, " звёзд=", Data.total_stars(),
					" убито всего=", Data.stats["kills"], " ачивок готово=", Data.unclaimed_count())
				phase = 2; t = 0.0
			elif t > 100.0:
				print("   !!ЗАВИС на уровне ", game.level); phase = 3
		2:
			if t > 0.3:
				if runs >= target_runs: phase = 3; t = 0.0
				else:
					Data.refill_energy()
					game._show_menu()
					game._on_play_requested(Data.level)
					phase = 1; t = 0.0
		3:
			if t > 0.3:
				print("\n== ПОКУПКИ")
				Data.coins += 5000
				var ok1 := Data.buy_weapon("machete")
				var ok2 := Data.upgrade_weapon("machete")
				var ok3 := Data.buy_armor("biker")
				var ok4 := Data.buy_consumable("medkit")
				print("   куплено мачете=", ok1, " улучшено=", ok2, " броня=", ok3, " аптечка=", ok4)
				print("   надето: ", Data.equipped_weapon, " класс=", Data.weapon_class(),
					" урон×", "%.2f" % Data.weapon_mult(), " броня=", Data.equipped_armor,
					" +hp=", Data.armor_hp())
				var claimed := 0
				for id in Items.ACHIEVEMENT_ORDER:
					if Data.claim_ach(id): claimed += 1
				print("   ачивок забрано=", claimed, " кристаллов=", Data.gems)
				phase = 4; t = 0.0
		4:
			if t > 0.3:
				# уровень новым оружием — снаряжение должно примениться
				Data.refill_energy()
				game._show_menu()
				game._on_play_requested(Data.level)
				print("   бой с оружием: ", game.player.weapon_name(), " урон×", "%.2f" % game.player.gear_damage,
					" макс.hp=", game.player.max_hp)
				phase = 5; t = 0.0
		5:
			if game.state == game.S.FIGHT: _bot()
			elif game.state == game.S.OBSTACLE: game._do_obstacle()
			elif game.state == game.S.WIN or game.state == game.S.LOSE:
				print("   итог: ", "пройден" if game.state == game.S.WIN else "смерть",
					" монет=", Data.coins)
				phase = 6; t = 0.0
			elif t > 100.0:
				print("   !!ЗАВИС"); phase = 6
		6:
			if t > 0.3:
				# сохранение
				Data.save_game()
				var before := Data.coins
				Data.load_game()
				print("\n== СОХРАНЕНИЕ: монет ", before, " -> ", Data.coins,
					" ур=", Data.level, " оружий=", Data.weapons.size(), " звёзд=", Data.total_stars())
				print("== КОНЕЦ")
				get_tree().quit()
