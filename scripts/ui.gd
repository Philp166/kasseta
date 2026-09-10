extends CanvasLayer

# Оболочка игры: хаб, карта уровней, магазин, снаряжение, ачивки, сборы, награды.
# Всё строится кодом — арта пока нет, но структура экранов финальная.

const Items = preload("res://scripts/items.gd")
const Weapons = preload("res://scripts/weapons.gd")

# Шрифты: заголовки — Rubik Wet Paint (потёки краски, мультяшность),
# всё остальное — Rubik Black/Bold. Одна семья, кириллица родная.
const Fonts = preload("res://scripts/fonts.gd")

# Иконки предметов из art/shop. Если картинки нет — рисуется пустая рамка.
func _icon(id: String, size: float) -> Control:
	var holder := Control.new()
	holder.custom_minimum_size = Vector2(size, size)
	holder.size = Vector2(size, size)
	var tex = Fonts.texture("res://art/shop/%s.png" % id)
	if tex != null:
		var tr := TextureRect.new()
		tr.texture = tex
		tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		tr.size = Vector2(size, size)
		holder.add_child(tr)
	return holder

signal play_requested(level)
signal closed()

const BG := Color(0.11, 0.12, 0.15)
const PANEL := Color(0.17, 0.18, 0.22)
const PANEL2 := Color(0.22, 0.23, 0.28)
const ACCENT := Color(0.91, 0.64, 0.24)
const GOOD := Color(0.35, 0.75, 0.45)
const BAD := Color(0.80, 0.30, 0.28)
const TEXT := Color(0.93, 0.93, 0.95)
const DIM := Color(0.62, 0.63, 0.68)

enum SC {HUB, MAP, SHOP, GEAR, ACH, LOADOUT, RESULT}

var root: Control
var screens: Dictionary = {}
var top_bar: Control
var lbl_coins: Label
var lbl_gems: Label
var lbl_energy: Label
var current: int = SC.HUB
var shop_tab: String = "weapons"
var map_chapter: int = 0
var pending_level: int = 1
var _rebuild: Callable = Callable()

func _ready() -> void:
	layer = 10
	root = Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(root)
	var bg := ColorRect.new()
	bg.color = BG
	bg.size = Vector2(1280, 720)
	root.add_child(bg)
	_build_top_bar()
	for s in [SC.HUB, SC.MAP, SC.SHOP, SC.GEAR, SC.ACH, SC.LOADOUT, SC.RESULT]:
		var c := Control.new()
		c.set_anchors_preset(Control.PRESET_FULL_RECT)
		c.visible = false
		root.add_child(c)
		screens[s] = c
	Data.changed.connect(_on_data_changed)
	show_screen(SC.HUB)

func _on_data_changed() -> void:
	_refresh_top()
	if root.visible and current in [SC.HUB, SC.SHOP, SC.GEAR, SC.ACH, SC.LOADOUT, SC.MAP]:
		_build(current)

# ---------------------------------------------------------- примитивы

func _label(text: String, pos: Vector2, size_px: int, col: Color = TEXT, head: bool = false) -> Label:
	var l := Label.new()
	l.text = text
	l.position = pos
	l.add_theme_font_override("font", Fonts.head() if head else (Fonts.black() if size_px >= 24 else Fonts.body()))
	l.add_theme_font_size_override("font_size", size_px)
	l.add_theme_color_override("font_color", col)
	return l

func _panel(pos: Vector2, size: Vector2, col: Color = PANEL) -> Panel:
	var p := Panel.new()
	p.position = pos
	p.size = size
	var sb := StyleBoxFlat.new()
	sb.bg_color = col
	sb.corner_radius_top_left = 10
	sb.corner_radius_top_right = 10
	sb.corner_radius_bottom_left = 10
	sb.corner_radius_bottom_right = 10
	p.add_theme_stylebox_override("panel", sb)
	return p

func _button(text: String, pos: Vector2, size: Vector2, col: Color = PANEL2, font_size: int = 22) -> Button:
	var b := Button.new()
	b.text = text
	b.position = pos
	b.size = size
	b.add_theme_font_override("font", Fonts.black() if font_size >= 24 else Fonts.bold())
	b.add_theme_font_size_override("font_size", font_size)
	b.add_theme_color_override("font_color", TEXT)
	b.add_theme_color_override("font_hover_color", Color.WHITE)
	b.add_theme_color_override("font_disabled_color", DIM)
	for st in ["normal", "hover", "pressed", "disabled"]:
		var sb := StyleBoxFlat.new()
		sb.bg_color = col
		if st == "hover":
			sb.bg_color = col.lightened(0.12)
		if st == "pressed":
			sb.bg_color = col.darkened(0.15)
		if st == "disabled":
			sb.bg_color = col.darkened(0.35)
		sb.corner_radius_top_left = 8
		sb.corner_radius_top_right = 8
		sb.corner_radius_bottom_left = 8
		sb.corner_radius_bottom_right = 8
		sb.content_margin_left = 10
		sb.content_margin_right = 10
		b.add_theme_stylebox_override(st, sb)
	return b

func _bar(parent: Control, pos: Vector2, size: Vector2, ratio: float, col: Color) -> void:
	var bg := ColorRect.new()
	bg.color = Color(0, 0, 0, 0.35)
	bg.position = pos
	bg.size = size
	parent.add_child(bg)
	var fg := ColorRect.new()
	fg.color = col
	fg.position = pos
	fg.size = Vector2(size.x * clampf(ratio, 0.0, 1.0), size.y)
	parent.add_child(fg)

func _clear(c: Control) -> void:
	for ch in c.get_children():
		ch.queue_free()

# ------------------------------------------------------------ верх

func _build_top_bar() -> void:
	top_bar = Control.new()
	top_bar.position = Vector2(0, 0)
	top_bar.size = Vector2(1280, 62)
	root.add_child(top_bar)
	var p := _panel(Vector2(0, 0), Vector2(1280, 62), Color(0.14, 0.15, 0.19))
	top_bar.add_child(p)
	var ic_coin := _icon("coin", 40.0)
	ic_coin.position = Vector2(20, 11)
	top_bar.add_child(ic_coin)
	lbl_coins = _label("", Vector2(68, 16), 26, ACCENT)
	top_bar.add_child(lbl_coins)
	var ic_gem := _icon("gem", 40.0)
	ic_gem.position = Vector2(230, 11)
	top_bar.add_child(ic_gem)
	lbl_gems = _label("", Vector2(278, 16), 26, Color(0.45, 0.75, 0.95))
	top_bar.add_child(lbl_gems)
	lbl_energy = _label("", Vector2(430, 16), 26, GOOD)
	top_bar.add_child(lbl_energy)
	_refresh_top()

func _refresh_top() -> void:
	if lbl_coins == null:
		return
	lbl_coins.text = "%d" % Data.coins
	lbl_gems.text = "%d" % Data.gems
	var e := "Энергия: %d/%d" % [Data.energy, Data.energy_max()]
	if Data.energy < Data.energy_max():
		var s := Data.seconds_to_next_energy()
		e += "   (+1 через %d:%02d)" % [s / 60, s % 60]
	lbl_energy.text = e

# --------------------------------------------------------- переходы

func show_screen(sc: int) -> void:
	if sc == SC.MAP and current != SC.MAP:
		map_chapter = Items.chapter_of_level(Data.level)
	current = sc
	root.visible = true
	for k in screens.keys():
		screens[k].visible = (k == sc)
	top_bar.visible = sc != SC.RESULT
	_build(sc)
	_refresh_top()

func hide_all() -> void:
	root.visible = false

func _build(sc: int) -> void:
	var c: Control = screens[sc]
	_clear(c)
	match sc:
		SC.HUB: _build_hub(c)
		SC.MAP: _build_map(c)
		SC.SHOP: _build_shop(c)
		SC.GEAR: _build_gear(c)
		SC.ACH: _build_ach(c)
		SC.LOADOUT: _build_loadout(c)

func _nav(c: Control) -> void:
	var items := [
		{"t": "ИГРАТЬ", "s": SC.MAP},
		{"t": "МАГАЗИН", "s": SC.SHOP},
		{"t": "СНАРЯЖЕНИЕ", "s": SC.GEAR},
		{"t": "ЗАДАНИЯ", "s": SC.ACH},
	]
	var x := 40.0
	for it in items:
		var label := String(it["t"])
		if it["s"] == SC.ACH and Data.unclaimed_count() > 0:
			label += "  (%d)" % Data.unclaimed_count()
		var b := _button(label, Vector2(x, 632), Vector2(280, 62),
			ACCENT if it["s"] == SC.MAP else PANEL2, 22)
		if it["s"] == SC.MAP:
			b.add_theme_color_override("font_color", Color(0.1, 0.1, 0.12))
		var target: int = it["s"]
		b.pressed.connect(func(): show_screen(target))
		c.add_child(b)
		x += 300.0

# ------------------------------------------------------------- ХАБ

func _build_hub(c: Control) -> void:
	c.add_child(_label("«КАССЕТА»", Vector2(60, 96), 76, TEXT, true))
	c.add_child(_label("Он просто хотел досмотреть фильм", Vector2(64, 196), 24, DIM))

	# карточка прогресса
	var p := _panel(Vector2(60, 250), Vector2(560, 236))
	c.add_child(p)
	var ch := Items.chapter_of_level(Data.level)
	p.add_child(_label("Глава %d — %s" % [ch + 1, Items.CHAPTERS[ch]["name"]], Vector2(24, 22), 30, ACCENT))
	p.add_child(_label("Уровень %d из %d" % [Data.level, Items.total_levels()], Vector2(24, 70), 24))
	p.add_child(_label("Звёзд собрано: %d" % Data.total_stars(), Vector2(24, 106), 24))
	p.add_child(_label("Оружие: %s  (ур. %d)" % [
		Items.WEAPONS[Data.equipped_weapon]["name"], int(Data.weapons.get(Data.equipped_weapon, 1))], Vector2(24, 146), 22, DIM))
	p.add_child(_label("Броня: %s" % Items.ARMOR[Data.equipped_armor]["name"], Vector2(24, 180), 22, DIM))
	p.add_child(_label("Приём: %s" % Items.EXECUTIONS[Data.equipped_execution]["name"], Vector2(24, 214), 22, DIM))

	var big := _button("ПРОДОЛЖИТЬ  —  уровень %d" % Data.level, Vector2(60, 506), Vector2(560, 96), ACCENT, 32)
	big.add_theme_color_override("font_color", Color(0.1, 0.1, 0.12))
	big.disabled = not Data.can_play(Data.level)
	if not Data.can_play(Data.level):
		big.text = "НЕТ ЭНЕРГИИ"
	big.pressed.connect(func():
		pending_level = Data.level
		show_screen(SC.LOADOUT))
	c.add_child(big)

	# правая колонка: статистика
	var p2 := _panel(Vector2(660, 250), Vector2(560, 352))
	c.add_child(p2)
	p2.add_child(_label("СТАТИСТИКА", Vector2(24, 20), 26, ACCENT))
	var rows := [
		["Пройдено уровней", int(Data.stats.get("levels", 0))],
		["Убито зомби", int(Data.stats.get("kills", 0))],
		["Добиваний", int(Data.stats.get("execs", 0))],
		["Парирований", int(Data.stats.get("parries", 0))],
		["Лучшее комбо", int(Data.stats.get("best_combo", 0))],
		["Уровней без урона", int(Data.stats.get("flawless", 0))],
		["Боссов убито", int(Data.stats.get("bosses", 0))],
	]
	var y := 64.0
	for r in rows:
		p2.add_child(_label(String(r[0]), Vector2(24, y), 22, DIM))
		var v := _label(str(r[1]), Vector2(400, y), 22, TEXT)
		p2.add_child(v)
		y += 36.0

	_nav(c)

# ------------------------------------------------------- КАРТА УРОВНЕЙ

func _build_map(c: Control) -> void:
	map_chapter = clampi(map_chapter, 0, Items.CHAPTERS.size() - 1)
	var ch: Dictionary = Items.CHAPTERS[map_chapter]
	var first := Items.chapter_first_level(map_chapter)
	var count := int(ch["levels"])

	c.add_child(_label("Глава %d — %s" % [map_chapter + 1, ch["name"]], Vector2(60, 72), 44, ACCENT, true))
	c.add_child(_label("Уровни %d–%d" % [first, first + count - 1], Vector2(60, 132), 22, DIM))

	var prev := _button("◀", Vector2(1080, 80), Vector2(60, 50))
	prev.disabled = map_chapter == 0
	prev.pressed.connect(func():
		map_chapter -= 1
		_build(SC.MAP))
	c.add_child(prev)
	var nxt := _button("▶", Vector2(1152, 80), Vector2(60, 50))
	nxt.disabled = map_chapter >= Items.CHAPTERS.size() - 1 or first + count > Data.level
	nxt.pressed.connect(func():
		map_chapter += 1
		_build(SC.MAP))
	c.add_child(nxt)

	# сетка уровней
	var cols := 10
	var x0 := 60.0
	var y0 := 180.0
	for i in range(count):
		var lvl := first + i
		var col := i % cols
		var row := int(i / cols)
		var unlocked := lvl <= Data.level
		var boss := Data.is_boss_level(lvl)
		var st := Data.stars_of(lvl)
		var txt := str(lvl)
		if boss:
			txt = "БОСС\n%d" % lvl
		elif st > 0:
			txt = "%d\n%s" % [lvl, "★".repeat(st)]
		var col_bg := PANEL2
		if not unlocked:
			col_bg = Color(0.15, 0.15, 0.17)
		elif lvl == Data.level:
			col_bg = ACCENT
		elif boss:
			col_bg = Color(0.45, 0.24, 0.24)
		var b := _button(txt, Vector2(x0 + float(col) * 112.0, y0 + float(row) * 96.0), Vector2(100, 84), col_bg, 22)
		if lvl == Data.level:
			b.add_theme_color_override("font_color", Color(0.1, 0.1, 0.12))
		b.disabled = not unlocked
		var l := lvl
		b.pressed.connect(func():
			pending_level = l
			show_screen(SC.LOADOUT))
		c.add_child(b)

	var back := _button("НАЗАД", Vector2(40, 632), Vector2(220, 62))
	back.pressed.connect(func(): show_screen(SC.HUB))
	c.add_child(back)

# ---------------------------------------------------------- СБОРЫ

func _build_loadout(c: Control) -> void:
	var lvl := pending_level
	var ch := Items.chapter_of_level(lvl)
	c.add_child(_label("Уровень %d — %s" % [lvl, Items.CHAPTERS[ch]["name"]], Vector2(60, 82), 44, ACCENT, true))
	c.add_child(_label("Стоимость: %d энергии%s" % [
		Data.level_cost(lvl), "   •   БОСС" if Data.is_boss_level(lvl) else ""], Vector2(62, 146), 24, DIM))

	var p := _panel(Vector2(60, 200), Vector2(600, 380))
	c.add_child(p)
	p.add_child(_label("СНАРЯЖЕНИЕ", Vector2(24, 18), 26, ACCENT))
	var wid: String = Data.equipped_weapon
	var wc: Dictionary = Weapons.get_class_data(String(Items.WEAPONS[wid]["class"]))
	p.add_child(_label("%s  ур.%d" % [Items.WEAPONS[wid]["name"], int(Data.weapons.get(wid, 1))], Vector2(24, 64), 26))
	p.add_child(_label("%s   урон ×%.2f" % [wc["name"], Data.weapon_mult()], Vector2(24, 100), 20, DIM))
	p.add_child(_label("Броня: %s   (+%d hp, −%d%% урона)" % [
		Items.ARMOR[Data.equipped_armor]["name"], int(Data.armor_hp()), int(Data.armor_reduce() * 100.0)], Vector2(24, 148), 22))
	p.add_child(_label("Приём: %s" % Items.EXECUTIONS[Data.equipped_execution]["name"], Vector2(24, 190), 22))

	p.add_child(_label("Взять с собой:", Vector2(24, 240), 22, DIM))
	var x := 24.0
	for id in Items.CONSUMABLE_ORDER:
		var n := int(Data.consumables.get(id, 0))
		var b := _button("%s\n×%d" % [Items.CONSUMABLES[id]["name"], n], Vector2(x, 276), Vector2(134, 76),
			PANEL2 if n > 0 else Color(0.15, 0.15, 0.17), 17)
		b.disabled = true
		p.add_child(b)
		x += 142.0

	var change := _button("ПОМЕНЯТЬ СНАРЯЖЕНИЕ", Vector2(700, 200), Vector2(520, 70))
	change.pressed.connect(func(): show_screen(SC.GEAR))
	c.add_child(change)
	var shop := _button("В МАГАЗИН", Vector2(700, 286), Vector2(520, 70))
	shop.pressed.connect(func(): show_screen(SC.SHOP))
	c.add_child(shop)

	var go := _button("В БОЙ", Vector2(700, 430), Vector2(520, 110), ACCENT, 40)
	go.add_theme_color_override("font_color", Color(0.1, 0.1, 0.12))
	go.disabled = not Data.can_play(lvl)
	if not Data.can_play(lvl):
		go.text = "НЕ ХВАТАЕТ ЭНЕРГИИ"
	go.pressed.connect(func():
		play_requested.emit(lvl))
	c.add_child(go)

	var back := _button("НАЗАД", Vector2(40, 632), Vector2(220, 62))
	back.pressed.connect(func(): show_screen(SC.MAP))
	c.add_child(back)

# --------------------------------------------------------- МАГАЗИН

func _build_shop(c: Control) -> void:
	c.add_child(_label("МАГАЗИН", Vector2(60, 70), 44, ACCENT, true))
	var tabs := [["weapons", "Оружие"], ["armor", "Броня"], ["cons", "Расходники"], ["exec", "Приёмы"]]
	var x := 60.0
	for t in tabs:
		var b := _button(String(t[1]), Vector2(x, 130), Vector2(220, 52),
			ACCENT if shop_tab == String(t[0]) else PANEL2, 22)
		if shop_tab == String(t[0]):
			b.add_theme_color_override("font_color", Color(0.1, 0.1, 0.12))
		var id := String(t[0])
		b.pressed.connect(func():
			shop_tab = id
			_build(SC.SHOP))
		c.add_child(b)
		x += 232.0

	var scroll := ScrollContainer.new()
	scroll.position = Vector2(60, 200)
	scroll.size = Vector2(1160, 410)
	c.add_child(scroll)
	var list := VBoxContainer.new()
	list.custom_minimum_size = Vector2(1140, 0)
	list.add_theme_constant_override("separation", 10)
	scroll.add_child(list)

	match shop_tab:
		"weapons": _shop_weapons(list)
		"armor": _shop_armor(list)
		"cons": _shop_cons(list)
		"exec": _shop_exec(list)

	var back := _button("НАЗАД", Vector2(40, 632), Vector2(220, 62))
	back.pressed.connect(func(): show_screen(SC.HUB))
	c.add_child(back)

func _row(list: VBoxContainer) -> Panel:
	var p := _panel(Vector2.ZERO, Vector2(1140, 92), PANEL)
	p.custom_minimum_size = Vector2(1140, 92)
	list.add_child(p)
	return p

func _shop_weapons(list: VBoxContainer) -> void:
	for id in Items.WEAPON_ORDER:
		var w: Dictionary = Items.WEAPONS[id]
		var cls: Dictionary = Weapons.get_class_data(String(w["class"]))
		var owned := Data.weapons.has(id)
		var lvl := int(Data.weapons.get(id, 0))
		var p := _row(list)
		var ic := _icon(id, 76.0)
		ic.position = Vector2(12, 8)
		p.add_child(ic)
		p.add_child(_label(String(w["name"]), Vector2(104, 12), 26, TEXT if owned else DIM))
		p.add_child(_label("%s   урон ×%.2f   открыт с главы %d" % [
			cls["name"], float(w["mult"]), int(w["chapter"])], Vector2(104, 50), 19, DIM))
		if owned:
			p.add_child(_label("ур. %d/%d" % [lvl, Items.UPGRADE_MAX], Vector2(690, 32), 22, ACCENT))
			if lvl < Items.UPGRADE_MAX:
				var price := Items.upgrade_price(int(w["price"]), lvl)
				var b := _button("Улучшить\n%d монет" % price, Vector2(820, 12), Vector2(170, 68),
					PANEL2 if Data.can_afford(price, "coins") else Color(0.15, 0.15, 0.17), 18)
				b.disabled = not Data.can_afford(price, "coins")
				b.pressed.connect(func(): Data.upgrade_weapon(id))
				p.add_child(b)
			else:
				p.add_child(_label("МАКС.", Vector2(860, 32), 20, GOOD))
			var eq := _button("Надето" if Data.equipped_weapon == id else "Надеть",
				Vector2(1000, 12), Vector2(130, 68), GOOD if Data.equipped_weapon == id else PANEL2, 19)
			eq.disabled = Data.equipped_weapon == id
			eq.pressed.connect(func():
				Data.equipped_weapon = id
				Data.save_game()
				Data.changed.emit())
			p.add_child(eq)
		else:
			var price := int(w["price"])
			var b := _button("Купить\n%d монет" % price, Vector2(880, 12), Vector2(250, 68),
				ACCENT if Data.can_afford(price, "coins") else Color(0.15, 0.15, 0.17), 20)
			if Data.can_afford(price, "coins"):
				b.add_theme_color_override("font_color", Color(0.1, 0.1, 0.12))
			b.disabled = not Data.can_afford(price, "coins")
			b.pressed.connect(func(): Data.buy_weapon(id))
			p.add_child(b)

func _shop_armor(list: VBoxContainer) -> void:
	for id in Items.ARMOR_ORDER:
		var a: Dictionary = Items.ARMOR[id]
		var owned := Data.armors.has(id)
		var p := _row(list)
		var ic := _icon(id, 76.0)
		ic.position = Vector2(12, 8)
		p.add_child(ic)
		p.add_child(_label(String(a["name"]), Vector2(104, 12), 26, TEXT if owned else DIM))
		p.add_child(_label("+%d hp   −%d%% урона   %s" % [
			int(a["hp"]), int(float(a["reduce"]) * 100.0), a["bonus"]], Vector2(104, 50), 19, DIM))
		if owned:
			var eq := _button("Надето" if Data.equipped_armor == id else "Выбрать",
				Vector2(950, 12), Vector2(180, 68), GOOD if Data.equipped_armor == id else PANEL2, 20)
			eq.disabled = Data.equipped_armor == id
			eq.pressed.connect(func():
				Data.equipped_armor = id
				Data.save_game()
				Data.changed.emit())
			p.add_child(eq)
		else:
			var price := int(a["price"])
			var b := _button("Купить\n%d монет" % price, Vector2(880, 12), Vector2(250, 68),
				ACCENT if Data.can_afford(price, "coins") else Color(0.15, 0.15, 0.17), 20)
			if Data.can_afford(price, "coins"):
				b.add_theme_color_override("font_color", Color(0.1, 0.1, 0.12))
			b.disabled = not Data.can_afford(price, "coins")
			b.pressed.connect(func(): Data.buy_armor(id))
			p.add_child(b)

func _shop_cons(list: VBoxContainer) -> void:
	for id in Items.CONSUMABLE_ORDER:
		var it: Dictionary = Items.CONSUMABLES[id]
		var p := _row(list)
		var ic := _icon(id, 76.0)
		ic.position = Vector2(12, 8)
		p.add_child(ic)
		p.add_child(_label(String(it["name"]), Vector2(104, 12), 26))
		p.add_child(_label("%s   в запасе: %d" % [it["desc"], int(Data.consumables.get(id, 0))], Vector2(104, 50), 19, DIM))
		var price := int(it["price"])
		var cur := String(it["cur"])
		var b := _button("Купить\n%d %s" % [price, "монет" if cur == "coins" else "крист."],
			Vector2(880, 12), Vector2(250, 68),
			ACCENT if Data.can_afford(price, cur) else Color(0.15, 0.15, 0.17), 20)
		if Data.can_afford(price, cur):
			b.add_theme_color_override("font_color", Color(0.1, 0.1, 0.12))
		b.disabled = not Data.can_afford(price, cur)
		b.pressed.connect(func(): Data.buy_consumable(id))
		p.add_child(b)

func _shop_exec(list: VBoxContainer) -> void:
	for id in Items.EXECUTION_ORDER:
		var e: Dictionary = Items.EXECUTIONS[id]
		var owned := Data.executions.has(id)
		var unlock := String(e.get("unlock", "buy"))
		var p := _row(list)
		p.add_child(_label(String(e["name"]), Vector2(20, 12), 26, TEXT if owned else DIM))
		var sub := "Приём добивания"
		if unlock == "ach_exec_100":
			sub = "Открывается за ачивку «Сто добиваний»"
		elif unlock == "ach_chapter_5":
			sub = "Открывается за прохождение главы 5"
		p.add_child(_label(sub, Vector2(20, 50), 19, DIM))
		if owned:
			var eq := _button("Выбран" if Data.equipped_execution == id else "Выбрать",
				Vector2(950, 12), Vector2(180, 68), GOOD if Data.equipped_execution == id else PANEL2, 20)
			eq.disabled = Data.equipped_execution == id
			eq.pressed.connect(func():
				Data.equipped_execution = id
				Data.save_game()
				Data.changed.emit())
			p.add_child(eq)
		elif unlock == "buy":
			var price := int(e["price"])
			var cur := String(e["cur"])
			var b := _button("Купить\n%d %s" % [price, "монет" if cur == "coins" else "крист."],
				Vector2(880, 12), Vector2(250, 68),
				ACCENT if Data.can_afford(price, cur) else Color(0.15, 0.15, 0.17), 20)
			if Data.can_afford(price, cur):
				b.add_theme_color_override("font_color", Color(0.1, 0.1, 0.12))
			b.disabled = not Data.can_afford(price, cur)
			b.pressed.connect(func(): Data.buy_execution(id))
			p.add_child(b)
		else:
			p.add_child(_label("ЗАКРЫТО", Vector2(980, 32), 22, DIM))

# ------------------------------------------------------ СНАРЯЖЕНИЕ

func _build_gear(c: Control) -> void:
	c.add_child(_label("СНАРЯЖЕНИЕ", Vector2(60, 70), 44, ACCENT, true))
	var scroll := ScrollContainer.new()
	scroll.position = Vector2(60, 140)
	scroll.size = Vector2(1160, 470)
	c.add_child(scroll)
	var list := VBoxContainer.new()
	list.custom_minimum_size = Vector2(1140, 0)
	list.add_theme_constant_override("separation", 10)
	scroll.add_child(list)

	var hdr := _panel(Vector2.ZERO, Vector2(1140, 44), Color(0.14, 0.15, 0.19))
	hdr.custom_minimum_size = Vector2(1140, 44)
	hdr.add_child(_label("ОРУЖИЕ (куплено)", Vector2(16, 8), 22, ACCENT))
	list.add_child(hdr)
	for id in Items.WEAPON_ORDER:
		if not Data.weapons.has(id):
			continue
		var w: Dictionary = Items.WEAPONS[id]
		var cls: Dictionary = Weapons.get_class_data(String(w["class"]))
		var p := _row(list)
		p.add_child(_label("%s  ур.%d" % [w["name"], int(Data.weapons[id])], Vector2(20, 12), 26))
		p.add_child(_label("%s   урон ×%.2f" % [cls["name"],
			Items.weapon_damage_mult(id, int(Data.weapons[id]))], Vector2(20, 50), 19, DIM))
		var eq := _button("Надето" if Data.equipped_weapon == id else "Надеть",
			Vector2(950, 12), Vector2(180, 68), GOOD if Data.equipped_weapon == id else PANEL2, 20)
		eq.disabled = Data.equipped_weapon == id
		eq.pressed.connect(func():
			Data.equipped_weapon = id
			Data.save_game()
			Data.changed.emit())
		p.add_child(eq)

	var hdr2 := _panel(Vector2.ZERO, Vector2(1140, 44), Color(0.14, 0.15, 0.19))
	hdr2.custom_minimum_size = Vector2(1140, 44)
	hdr2.add_child(_label("БРОНЯ И ПРИЁМЫ", Vector2(16, 8), 22, ACCENT))
	list.add_child(hdr2)
	for id in Items.ARMOR_ORDER:
		if not Data.armors.has(id):
			continue
		var a: Dictionary = Items.ARMOR[id]
		var p := _row(list)
		p.add_child(_label(String(a["name"]), Vector2(20, 12), 26))
		p.add_child(_label("+%d hp   −%d%% урона   %s" % [
			int(a["hp"]), int(float(a["reduce"]) * 100.0), a["bonus"]], Vector2(20, 50), 19, DIM))
		var eq := _button("Надето" if Data.equipped_armor == id else "Надеть",
			Vector2(950, 12), Vector2(180, 68), GOOD if Data.equipped_armor == id else PANEL2, 20)
		eq.disabled = Data.equipped_armor == id
		eq.pressed.connect(func():
			Data.equipped_armor = id
			Data.save_game()
			Data.changed.emit())
		p.add_child(eq)
	for id in Items.EXECUTION_ORDER:
		if not Data.executions.has(id):
			continue
		var e: Dictionary = Items.EXECUTIONS[id]
		var p := _row(list)
		p.add_child(_label("Приём: %s" % e["name"], Vector2(20, 12), 26))
		p.add_child(_label("Добивание", Vector2(20, 50), 19, DIM))
		var eq := _button("Выбран" if Data.equipped_execution == id else "Выбрать",
			Vector2(950, 12), Vector2(180, 68), GOOD if Data.equipped_execution == id else PANEL2, 20)
		eq.disabled = Data.equipped_execution == id
		eq.pressed.connect(func():
			Data.equipped_execution = id
			Data.save_game()
			Data.changed.emit())
		p.add_child(eq)

	var back := _button("НАЗАД", Vector2(40, 632), Vector2(220, 62))
	back.pressed.connect(func(): show_screen(SC.HUB))
	c.add_child(back)

# ---------------------------------------------------------- ЗАДАНИЯ

func _build_ach(c: Control) -> void:
	c.add_child(_label("ЗАДАНИЯ И НАГРАДЫ", Vector2(60, 70), 44, ACCENT, true))
	var scroll := ScrollContainer.new()
	scroll.position = Vector2(60, 140)
	scroll.size = Vector2(1160, 470)
	c.add_child(scroll)
	var list := VBoxContainer.new()
	list.custom_minimum_size = Vector2(1140, 0)
	list.add_theme_constant_override("separation", 10)
	scroll.add_child(list)

	for id in Items.ACHIEVEMENT_ORDER:
		var a: Dictionary = Items.ACHIEVEMENTS[id]
		var prog := Data.ach_progress(id)
		var target := int(a["target"])
		var done := Data.ach_done(id)
		var got := Data.ach_claimed(id)
		var p := _row(list)
		p.add_child(_label(String(a["name"]), Vector2(20, 10), 24, GOOD if done else TEXT))
		p.add_child(_label(String(a["desc"]), Vector2(20, 42), 19, DIM))
		_bar(p, Vector2(20, 70), Vector2(600, 12), float(prog) / float(target), ACCENT if not done else GOOD)
		p.add_child(_label("%d / %d" % [mini(prog, target), target], Vector2(640, 60), 20, DIM))
		p.add_child(_label("+%d крист." % int(a.get("gems", 0)), Vector2(790, 32), 20,
			Color(0.45, 0.75, 0.95)))
		if got:
			p.add_child(_label("ПОЛУЧЕНО", Vector2(960, 32), 22, DIM))
		else:
			var b := _button("ЗАБРАТЬ", Vector2(950, 12), Vector2(180, 68),
				ACCENT if done else Color(0.15, 0.15, 0.17), 22)
			if done:
				b.add_theme_color_override("font_color", Color(0.1, 0.1, 0.12))
			b.disabled = not done
			b.pressed.connect(func(): Data.claim_ach(id))
			p.add_child(b)

	var back := _button("НАЗАД", Vector2(40, 632), Vector2(220, 62))
	back.pressed.connect(func(): show_screen(SC.HUB))
	c.add_child(back)

# ---------------------------------------------------------- ИТОГИ

func show_results(win: bool, lvl: int, res: Dictionary, can_revive: bool,
		on_retry: Callable, on_next: Callable, on_revive: Callable) -> void:
	current = SC.RESULT
	root.visible = true
	for k in screens.keys():
		screens[k].visible = (k == SC.RESULT)
	top_bar.visible = false
	var c: Control = screens[SC.RESULT]
	_clear(c)

	var p := _panel(Vector2(240, 90), Vector2(800, 540), PANEL)
	c.add_child(p)
	p.add_child(_label("УРОВЕНЬ ПРОЙДЕН" if win else "ДЕДА ДОЖРАЛИ",
		Vector2(40, 24), 50, GOOD if win else BAD, true))
	p.add_child(_label("Уровень %d" % lvl, Vector2(40, 88), 24, DIM))

	if win:
		var st := int(res.get("stars", 1))
		p.add_child(_label("★".repeat(st) + "☆".repeat(3 - st), Vector2(40, 128), 46, ACCENT))

	var rows := [
		["Монет за бой", int(res.get("coins", 0))],
		["Награда за уровень", int(res.get("reward", 0))],
		["Убито", int(res.get("kills", 0))],
		["Добиваний", int(res.get("execs", 0))],
		["Парирований", int(res.get("parries", 0))],
		["Лучшее комбо", int(res.get("best_combo", 0))],
	]
	var y := 196.0
	for r in rows:
		p.add_child(_label(String(r[0]), Vector2(40, y), 24, DIM))
		p.add_child(_label(str(r[1]), Vector2(560, y), 24, TEXT))
		y += 36.0

	p.add_child(_label("ИТОГО: %d монет" % int(res.get("total", 0)), Vector2(40, y + 8), 32, ACCENT))

	if win:
		var nb := _button("ДАЛЬШЕ", Vector2(430, 450), Vector2(320, 76), ACCENT, 28)
		nb.add_theme_color_override("font_color", Color(0.1, 0.1, 0.12))
		nb.pressed.connect(func():
			on_next.call())
		p.add_child(nb)
	else:
		var rb := _button("ЗАНОВО", Vector2(40, 450), Vector2(220, 76), PANEL2, 24)
		rb.pressed.connect(func(): on_retry.call())
		p.add_child(rb)
		var vb := _button("ВСТАТЬ\n(реклама)", Vector2(280, 450), Vector2(240, 76), ACCENT, 20)
		vb.add_theme_color_override("font_color", Color(0.1, 0.1, 0.12))
		vb.visible = can_revive
		vb.pressed.connect(func(): on_revive.call())
		p.add_child(vb)
		var mb := _button("В МЕНЮ", Vector2(540, 450), Vector2(220, 76), PANEL2, 24)
		mb.pressed.connect(func(): show_screen(SC.HUB))
		p.add_child(mb)
