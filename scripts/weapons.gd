extends RefCounted

# Четыре класса оружия. Отличаются не цифрами, а ритмом и способом решать толпу.

const CLASSES := {
	"heavy": {
		"name": "Тяжёлое",
		"light_time": 0.36,          # медленные, но весомые удары
		"light_damage": 15.0,
		"light_stun": 2.2,
		"light_knock": 62.0,
		"light_range": 180.0,
		"light_targets": 1,
		"combo_len": 3,
		"combo_bonus": 2.0,
		"dash_cd": 1.1,          # третий удар — размашистый
		"heavy_windup": 0.55,
		"heavy_damage": 34.0,
		"heavy_stun": 3.2,
		"heavy_knock": 130.0,
		"heavy_range": 195.0,
		"heavy_targets": 4,          # выносит всю группу перед собой
		"ammo": 0,
	},
	"long": {
		"name": "Длинное",
		"light_time": 0.30,
		"light_damage": 8.0,
		"light_stun": 1.5,
		"light_knock": 25.0,
		"light_range": 210.0,        # держит дистанцию
		"light_targets": 2,          # протыкает двоих в линию
		"combo_len": 3,
		"combo_bonus": 1.6,
		"dash_cd": 1.4,
		"heavy_windup": 0.42,
		"heavy_damage": 26.0,
		"heavy_stun": 2.4,
		"heavy_knock": 70.0,
		"heavy_range": 290.0,
		"heavy_targets": 3,
		"ammo": 0,
	},
	"fast": {
		"name": "Быстрое",
		"light_time": 0.17,          # частые слабые удары
		"light_damage": 6.5,
		"light_stun": 1.6,
		"light_knock": 14.0,
		"light_range": 165.0,
		"light_targets": 1,
		"combo_len": 5,              # длинная серия
		"combo_bonus": 2.6,
		"heavy_windup": 0.35,
		"heavy_damage": 16.0,
		"heavy_stun": 1.8,
		"heavy_knock": 40.0,
		"heavy_range": 165.0,
		"heavy_targets": 6,          # вертушка бьёт всех вокруг, включая сзади
		"heavy_around": true,
		"ammo": 0,
	},
	"gun": {
		"name": "Огнестрел",
		"light_time": 0.28,
		"light_damage": 15.0,
		"light_stun": 1.3,
		"light_knock": 60.0,
		"light_range": 700.0,        # достаёт плевунов
		"light_targets": 1,
		"combo_len": 2,
		"combo_bonus": 1.0,
		"dash_cd": 1.6,
		"heavy_windup": 0.30,
		"heavy_damage": 42.0,
		"heavy_stun": 3.0,
		"heavy_knock": 220.0,
		"heavy_range": 420.0,
		"heavy_targets": 3,
		"ammo": 2,                   # два патрона, потом перезарядка
		"reload_time": 1.9,
		"heavy_ammo_cost": 2,
	},
}

const ORDER := ["heavy", "long", "fast", "gun"]

static func get_class_data(id: String) -> Dictionary:
	return CLASSES.get(id, CLASSES["heavy"])
