extends RefCounted

# Загрузка шрифтов в рантайме. Через preload не работает: .ttf требует
# импорта редактором, а проект запускается и напрямую (godot --path ...).

static var _cache: Dictionary = {}

static func get_font(path: String) -> FontFile:
	if _cache.has(path):
		return _cache[path]
	var f := FontFile.new()
	f.load_dynamic_font(path)
	_cache[path] = f
	return f

static func head() -> FontFile:
	return get_font("res://fonts/RubikWetPaint-Regular.ttf")

static func black() -> FontFile:
	return get_font("res://fonts/Rubik-Black.ttf")

static func bold() -> FontFile:
	return get_font("res://fonts/Rubik-Bold.ttf")

static func body() -> FontFile:
	return get_font("res://fonts/Rubik-Medium.ttf")


# Картинки тоже грузим в рантайме: .png требует импорта редактором,
# а проект должен запускаться и напрямую (godot --path ...)
static var _tex: Dictionary = {}

static func texture(path: String) -> Texture2D:
	if _tex.has(path):
		return _tex[path]
	var img := Image.new()
	var err := img.load(path)
	if err != OK:
		_tex[path] = null
		return null
	var t := ImageTexture.create_from_image(img)
	_tex[path] = t
	return t
