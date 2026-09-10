extends Node

# Глобальный профиль игрока: валюты, энергия, инвентарь, прогресс, ачивки.
# Автозагрузка (Data). Сохранение в user://kasseta_save.json

const Items = preload("res://scripts/items.gd")

signal changed

const SAVE_PATH := "user://kasseta_save.json"
const ENERGY_MAX_BASE := 10
const ENERGY_REGEN_SEC := 480
const LEVEL_COST := 1
const BOSS_COST := 2

var coins: int = 0
var gems: int = 0
var level: int = 1                  # первый непройденный уровень
var energy: int = ENERGY_MAX_BASE
var last_energy_time: int = 0

# инвентарь
var weapons: Dictionary = {"shovel": 1}      # id -> уровень прокачки
var equipped_weapon: String = "shovel"
var armors: Dictionary = {"farmer": true}
var equipped_armor: String = "farmer"
var executions: Dictionary = {"shovel_head": true}
var equipped_execution: String = "shovel_head"
var consumables: Dictionary = {}             # id -> количество

# прогресс
var stars: Dictionary = {}                   # "12" -> 0..3
var claimed: Dictionary = {}                 # ачивки, награда забрана
var stats: Dictionary = {
	"levels": 0, "chapters": 0, "kills": 0, "execs": 0,
	"parries": 0, "best_combo": 0, "flawless": 0, "bosses": 0,
}

var _tick: Timer

func _ready() -> void:
	load_game()
	_tick = Timer.new()
	_tick.wait_time = 1.0
	_tick.autostart = true
	_tick.timeout.connect(refresh_energy)
	add_child(_tick)
	refresh_energy()

# --- энергия ---------------------------------------------------------

func energy_max() -> int:
	# максимум растёт на 1 за каждые две пройденные главы
	return ENERGY_MAX_BASE + mini(4, int(stats.get("chapters", 0)) / 2)

func refresh_energy() -> void:
	var now: int = int(Time.get_unix_time_from_system())
	if energy >= energy_max():
		last_energy_time = now
		return
	var elapsed: int = now - last_energy_time
	if elapsed < 0:
		last_energy_time = now
		return
	if elapsed >= ENERGY_REGEN_SEC:
		var gained: int = int(elapsed / ENERGY_REGEN_SEC)
		energy = mini(energy_max(), energy + gained)
		last_energy_time += gained * ENERGY_REGEN_SEC
		changed.emit()
		save_game()

func seconds_to_next_energy() -> int:
	if energy >= energy_max():
		return 0
	return maxi(0, ENERGY_REGEN_SEC - (int(Time.get_unix_time_from_system()) - last_energy_time))

func is_boss_level(lvl: int) -> bool:
	return lvl % 20 == 0

func level_cost(lvl: int) -> int:
	return BOSS_COST if is_boss_level(lvl) else LEVEL_COST

func can_play(lvl: int) -> bool:
	return energy >= level_cost(lvl) and lvl <= level

func spend_energy(lvl: int) -> bool:
	var cost := level_cost(lvl)
	if energy < cost:
		return false
	if energy >= energy_max():
		last_energy_time = int(Time.get_unix_time_from_system())
	energy -= cost
	changed.emit()
	save_game()
	return true

func refill_energy() -> void:
	energy = energy_max()
	last_energy_time = int(Time.get_unix_time_from_system())
	changed.emit()
	save_game()

func add_energy(n: int) -> void:
	if energy >= energy_max():
		last_energy_time = int(Time.get_unix_time_from_system())
	energy = mini(energy_max(), energy + n)
	changed.emit()
	save_game()

# --- валюты и покупки -------------------------------------------------

func add_coins(n: int) -> void:
	coins += n
	changed.emit()

func can_afford(price: int, cur: String) -> bool:
	return (coins >= price) if cur == "coins" else (gems >= price)

func pay(price: int, cur: String) -> bool:
	if not can_afford(price, cur):
		return false
	if cur == "coins":
		coins -= price
	else:
		gems -= price
	changed.emit()
	save_game()
	return true

func buy_weapon(id: String) -> bool:
	if weapons.has(id):
		return false
	var w: Dictionary = Items.WEAPONS[id]
	if not pay(int(w["price"]), "coins"):
		return false
	weapons[id] = 1
	equipped_weapon = id
	save_game()
	changed.emit()
	return true

func upgrade_weapon(id: String) -> bool:
	if not weapons.has(id):
		return false
	var lvl: int = int(weapons[id])
	if lvl >= Items.UPGRADE_MAX:
		return false
	var price := Items.upgrade_price(int(Items.WEAPONS[id]["price"]), lvl)
	if not pay(price, "coins"):
		return false
	weapons[id] = lvl + 1
	save_game()
	changed.emit()
	return true

func buy_armor(id: String) -> bool:
	if armors.has(id):
		return false
	if not pay(int(Items.ARMOR[id]["price"]), "coins"):
		return false
	armors[id] = true
	equipped_armor = id
	save_game()
	changed.emit()
	return true

func buy_execution(id: String) -> bool:
	if executions.has(id):
		return false
	var e: Dictionary = Items.EXECUTIONS[id]
	if String(e.get("unlock", "buy")) != "buy":
		return false
	if not pay(int(e["price"]), String(e["cur"])):
		return false
	executions[id] = true
	equipped_execution = id
	save_game()
	changed.emit()
	return true

func grant_execution(id: String) -> void:
	if not executions.has(id):
		executions[id] = true
		changed.emit()

func buy_consumable(id: String) -> bool:
	var c: Dictionary = Items.CONSUMABLES[id]
	if not pay(int(c["price"]), String(c["cur"])):
		return false
	consumables[id] = int(consumables.get(id, 0)) + 1
	save_game()
	changed.emit()
	return true

func use_consumable(id: String) -> bool:
	var n := int(consumables.get(id, 0))
	if n <= 0:
		return false
	consumables[id] = n - 1
	changed.emit()
	return true

# --- боевые бонусы ----------------------------------------------------

func weapon_mult() -> float:
	return Items.weapon_damage_mult(equipped_weapon, int(weapons.get(equipped_weapon, 1)))

func weapon_class() -> String:
	return String(Items.WEAPONS[equipped_weapon]["class"])

func armor_hp() -> float:
	return float(Items.ARMOR[equipped_armor]["hp"])

func armor_reduce() -> float:
	return float(Items.ARMOR[equipped_armor]["reduce"])

# --- прогресс ---------------------------------------------------------

func stars_of(lvl: int) -> int:
	return int(stars.get(str(lvl), 0))

func total_stars() -> int:
	var n := 0
	for k in stars.keys():
		n += int(stars[k])
	return n

func level_done(lvl: int, earned: int, got_stars: int, run_stats: Dictionary) -> void:
	coins += earned
	stars[str(lvl)] = maxi(stars_of(lvl), got_stars)
	if lvl >= level:
		level = lvl + 1
	stats["levels"] = int(stats.get("levels", 0)) + 1
	stats["kills"] = int(stats.get("kills", 0)) + int(run_stats.get("kills", 0))
	stats["execs"] = int(stats.get("execs", 0)) + int(run_stats.get("execs", 0))
	stats["parries"] = int(stats.get("parries", 0)) + int(run_stats.get("parries", 0))
	stats["best_combo"] = maxi(int(stats.get("best_combo", 0)), int(run_stats.get("best_combo", 0)))
	if int(run_stats.get("damage_taken", 1)) == 0:
		stats["flawless"] = int(stats.get("flawless", 0)) + 1
	if is_boss_level(lvl):
		stats["bosses"] = int(stats.get("bosses", 0)) + 1
		stats["chapters"] = maxi(int(stats.get("chapters", 0)), int(lvl / 20))
		gems += 20
		refill_energy()
	changed.emit()
	save_game()

# --- ачивки -----------------------------------------------------------

func ach_progress(id: String) -> int:
	var a: Dictionary = Items.ACHIEVEMENTS[id]
	return int(stats.get(String(a["stat"]), 0))

func ach_done(id: String) -> bool:
	return ach_progress(id) >= int(Items.ACHIEVEMENTS[id]["target"])

func ach_claimed(id: String) -> bool:
	return bool(claimed.get(id, false))

func claim_ach(id: String) -> bool:
	if not ach_done(id) or ach_claimed(id):
		return false
	var a: Dictionary = Items.ACHIEVEMENTS[id]
	claimed[id] = true
	gems += int(a.get("gems", 0))
	if a.has("gives"):
		grant_execution(String(a["gives"]))
	changed.emit()
	save_game()
	return true

func unclaimed_count() -> int:
	var n := 0
	for id in Items.ACHIEVEMENT_ORDER:
		if ach_done(id) and not ach_claimed(id):
			n += 1
	return n

# --- сохранение -------------------------------------------------------

func save_game() -> void:
	var f := FileAccess.open(SAVE_PATH, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(JSON.stringify({
		"coins": coins, "gems": gems, "level": level, "energy": energy,
		"last_energy_time": last_energy_time,
		"weapons": weapons, "equipped_weapon": equipped_weapon,
		"armors": armors, "equipped_armor": equipped_armor,
		"executions": executions, "equipped_execution": equipped_execution,
		"consumables": consumables, "stars": stars, "claimed": claimed, "stats": stats,
	}))
	f.close()

func load_game() -> void:
	last_energy_time = int(Time.get_unix_time_from_system())
	if not FileAccess.file_exists(SAVE_PATH):
		return
	var f := FileAccess.open(SAVE_PATH, FileAccess.READ)
	if f == null:
		return
	var d = JSON.parse_string(f.get_as_text())
	f.close()
	if typeof(d) != TYPE_DICTIONARY:
		return
	coins = int(d.get("coins", 0))
	gems = int(d.get("gems", 0))
	level = maxi(1, int(d.get("level", 1)))
	energy = int(d.get("energy", ENERGY_MAX_BASE))
	last_energy_time = int(d.get("last_energy_time", last_energy_time))
	weapons = d.get("weapons", {"shovel": 1})
	equipped_weapon = String(d.get("equipped_weapon", "shovel"))
	armors = d.get("armors", {"farmer": true})
	equipped_armor = String(d.get("equipped_armor", "farmer"))
	executions = d.get("executions", {"shovel_head": true})
	equipped_execution = String(d.get("equipped_execution", "shovel_head"))
	consumables = d.get("consumables", {})
	stars = d.get("stars", {})
	claimed = d.get("claimed", {})
	var st = d.get("stats", {})
	if typeof(st) == TYPE_DICTIONARY:
		for k in st.keys():
			stats[k] = int(st[k])
	if not weapons.has(equipped_weapon):
		equipped_weapon = "shovel"
		weapons["shovel"] = 1

func reset_progress() -> void:
	coins = 0
	gems = 0
	level = 1
	weapons = {"shovel": 1}
	equipped_weapon = "shovel"
	armors = {"farmer": true}
	equipped_armor = "farmer"
	executions = {"shovel_head": true}
	equipped_execution = "shovel_head"
	consumables = {}
	stars = {}
	claimed = {}
	for k in stats.keys():
		stats[k] = 0
	refill_energy()
