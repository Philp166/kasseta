extends RefCounted

# Каталоги всего покупаемого. Цифры боя берутся из класса оружия,
# конкретный ствол внутри класса добавляет множитель и цену.

const Weapons = preload("res://scripts/weapons.gd")

# --- Оружие: 4 класса по 5 стволов -----------------------------------
const WEAPONS := {
	"shovel":    {"class": "heavy", "name": "Лопата",           "price": 0,     "mult": 1.00, "chapter": 1},
	"sledge":    {"class": "heavy", "name": "Кувалда",          "price": 900,   "mult": 1.25, "chapter": 2},
	"axe":       {"class": "heavy", "name": "Пожарный топор",   "price": 2600,  "mult": 1.55, "chapter": 3},
	"engine":    {"class": "heavy", "name": "Двигатель на цепи","price": 7200,  "mult": 1.95, "chapter": 5},
	"anchor":    {"class": "heavy", "name": "Якорь",            "price": 16000, "mult": 2.45, "chapter": 7},

	"pitchfork": {"class": "long",  "name": "Вилы",             "price": 450,   "mult": 1.00, "chapter": 1},
	"scythe":    {"class": "long",  "name": "Коса",             "price": 1400,  "mult": 1.25, "chapter": 2},
	"rebar":     {"class": "long",  "name": "Копьё из арматуры","price": 3400,  "mult": 1.55, "chapter": 4},
	"stopsign":  {"class": "long",  "name": "Знак «Стоп»",      "price": 8600,  "mult": 1.95, "chapter": 6},
	"harpoon":   {"class": "long",  "name": "Гарпун",           "price": 18000, "mult": 2.45, "chapter": 8},

	"machete":   {"class": "fast",  "name": "Мачете",           "price": 600,   "mult": 1.00, "chapter": 1},
	"cleaver":   {"class": "fast",  "name": "Тесак",            "price": 1700,  "mult": 1.25, "chapter": 3},
	"chainsaw":  {"class": "fast",  "name": "Бензопила",        "price": 4200,  "mult": 1.55, "chapter": 4},
	"twin":      {"class": "fast",  "name": "Двойные мачете",   "price": 9800,  "mult": 1.95, "chapter": 6},
	"circular":  {"class": "fast",  "name": "Циркулярка",       "price": 19500, "mult": 2.45, "chapter": 8},

	"sawnoff":   {"class": "gun",   "name": "Обрез",            "price": 1200,  "mult": 1.00, "chapter": 2},
	"shotgun":   {"class": "gun",   "name": "Дробовик",         "price": 3000,  "mult": 1.25, "chapter": 3},
	"carbine":   {"class": "gun",   "name": "Карабин",          "price": 6500,  "mult": 1.55, "chapter": 5},
	"nailgun":   {"class": "gun",   "name": "Гвоздемёт",        "price": 12500, "mult": 1.95, "chapter": 7},
	"launcher":  {"class": "gun",   "name": "Гранатомёт",       "price": 24000, "mult": 2.45, "chapter": 9},
}

const WEAPON_ORDER := ["shovel", "sledge", "axe", "engine", "anchor",
	"pitchfork", "scythe", "rebar", "stopsign", "harpoon",
	"machete", "cleaver", "chainsaw", "twin", "circular",
	"sawnoff", "shotgun", "carbine", "nailgun", "launcher"]

const UPGRADE_MAX := 5
const UPGRADE_STEP := 0.09        # +9 % урона за уровень

static func upgrade_price(base_price: int, level: int) -> int:
	return int(maxf(120.0, float(base_price) * 0.35) * pow(1.7, float(level - 1)))

static func weapon_damage_mult(id: String, level: int) -> float:
	var w: Dictionary = WEAPONS.get(id, WEAPONS["shovel"])
	return float(w["mult"]) * (1.0 + UPGRADE_STEP * float(level - 1))

# --- Броня: 6 комплектов ---------------------------------------------
const ARMOR := {
	"farmer":  {"name": "Фермер",       "price": 0,     "hp": 0,  "reduce": 0.00, "bonus": "—"},
	"biker":   {"name": "Байкер",       "price": 1800,  "hp": 20, "reduce": 0.05, "bonus": "+50 % ярости за добивание"},
	"guard":   {"name": "Охранник ТЦ",  "price": 4500,  "hp": 35, "reduce": 0.10, "bonus": "Аптечки лечат вдвое"},
	"army":    {"name": "Военный",      "price": 9000,  "hp": 50, "reduce": 0.16, "bonus": "Блок снимает весь урон"},
	"fire":    {"name": "Пожарный",     "price": 15000, "hp": 65, "reduce": 0.20, "bonus": "Иммунитет к взрывам"},
	"hockey":  {"name": "Хоккеист",     "price": 23000, "hp": 80, "reduce": 0.24, "bonus": "Комбо не сбивается уроном"},
}
const ARMOR_ORDER := ["farmer", "biker", "guard", "army", "fire", "hockey"]

# --- Расходники -------------------------------------------------------
const CONSUMABLES := {
	"medkit":  {"name": "Аптечка",        "price": 150, "cur": "coins", "desc": "+40 % здоровья"},
	"moonshine": {"name": "Самогон",      "price": 400, "cur": "coins", "desc": "Полное здоровье, 3 с шатает"},
	"rage":    {"name": "Зелье ярости",   "price": 8,   "cur": "gems",  "desc": "Ярость сразу полная"},
	"second":  {"name": "Второе дыхание", "price": 15,  "cur": "gems",  "desc": "Одно воскрешение на уровне"},
}
const CONSUMABLE_ORDER := ["medkit", "moonshine", "rage", "second"]

# --- Приёмы добивания -------------------------------------------------
const EXECUTIONS := {
	"shovel_head": {"name": "Лопатой по темечку", "price": 0,     "cur": "coins", "unlock": "start"},
	"halves":      {"name": "Пополам",            "price": 700,   "cur": "coins", "unlock": "buy"},
	"guillotine":  {"name": "Гильотина",          "price": 1600,  "cur": "coins", "unlock": "buy"},
	"helicopter":  {"name": "Вертолёт",           "price": 3200,  "cur": "coins", "unlock": "buy"},
	"knee":        {"name": "Коленом",            "price": 5000,  "cur": "coins", "unlock": "buy"},
	"asphalt":     {"name": "Асфальт",            "price": 0,     "cur": "coins", "unlock": "ach_exec_100"},
	"corkscrew":   {"name": "Штопор",             "price": 40,    "cur": "gems",  "unlock": "buy"},
	"boot":        {"name": "Ботинок",            "price": 55,    "cur": "gems",  "unlock": "buy"},
	"shawarma":    {"name": "Шаурма",             "price": 0,     "cur": "coins", "unlock": "ach_chapter_5"},
	"firework":    {"name": "Салют",              "price": 75,    "cur": "gems",  "unlock": "buy"},
}
const EXECUTION_ORDER := ["shovel_head", "halves", "guillotine", "helicopter", "knee",
	"asphalt", "corkscrew", "boot", "shawarma", "firework"]

# --- Ачивки -----------------------------------------------------------
# stat — имя счётчика в Data.stats; target — сколько нужно
const ACHIEVEMENTS := {
	"lvl_10":     {"name": "Десять шагов",       "desc": "Пройти 10 уровней",        "stat": "levels", "target": 10,   "gems": 5},
	"lvl_50":     {"name": "Полсотни",           "desc": "Пройти 50 уровней",        "stat": "levels", "target": 50,   "gems": 15},
	"chapter_1":  {"name": "Ферма позади",       "desc": "Пройти главу 1",           "stat": "chapters", "target": 1,  "gems": 20},
	"chapter_5":  {"name": "До шоссе",           "desc": "Пройти главу 5",           "stat": "chapters", "target": 5,  "gems": 20, "gives": "shawarma"},
	"kills_500":  {"name": "Пятьсот",            "desc": "Убить 500 зомби",          "stat": "kills",  "target": 500,  "gems": 10},
	"exec_100":   {"name": "Сто добиваний",      "desc": "Добить 100 зомби",         "stat": "execs",  "target": 100,  "gems": 15, "gives": "asphalt"},
	"exec_1000":  {"name": "Тысяча добиваний",   "desc": "Добить 1000 зомби",        "stat": "execs",  "target": 1000, "gems": 40},
	"parry_100":  {"name": "Как в кино",         "desc": "100 идеальных парирований","stat": "parries","target": 100,  "gems": 15},
	"combo_50":   {"name": "Серия",              "desc": "Комбо 50 за один бой",     "stat": "best_combo", "target": 50, "gems": 10},
	"combo_150":  {"name": "Мясорубка",          "desc": "Комбо 150 за один бой",    "stat": "best_combo", "target": 150, "gems": 30},
	"noharm_10":  {"name": "Без единой царапины","desc": "10 уровней без урона",     "stat": "flawless", "target": 10, "gems": 25},
	"boss_5":     {"name": "Пять голов",         "desc": "Убить 5 боссов",           "stat": "bosses", "target": 5,    "gems": 25},
}
const ACHIEVEMENT_ORDER := ["lvl_10", "lvl_50", "chapter_1", "chapter_5", "kills_500",
	"exec_100", "exec_1000", "parry_100", "combo_50", "combo_150", "noharm_10", "boss_5"]

# --- Главы ------------------------------------------------------------
const CHAPTERS := [
	{"name": "Ферма",           "levels": 20},
	{"name": "Дорога",          "levels": 25},
	{"name": "Посёлок",         "levels": 25},
	{"name": "Торговый центр",  "levels": 30},
	{"name": "Шоссе",           "levels": 30},
	{"name": "Военная база",    "levels": 30},
	{"name": "Город",           "levels": 30},
	{"name": "Крыши",           "levels": 30},
	{"name": "Убежище ниндзя",  "levels": 10},
]

static func chapter_first_level(ch_index: int) -> int:
	var n := 1
	for i in range(ch_index):
		n += int(CHAPTERS[i]["levels"])
	return n

static func chapter_of_level(level: int) -> int:
	var n := 0
	for i in range(CHAPTERS.size()):
		n += int(CHAPTERS[i]["levels"])
		if level <= n:
			return i
	return CHAPTERS.size() - 1

static func total_levels() -> int:
	var n := 0
	for c in CHAPTERS:
		n += int(c["levels"])
	return n
