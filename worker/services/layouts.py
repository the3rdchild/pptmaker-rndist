"""
Layout templates — map AI semantic slide output to PPTist's pixel-based element model.

Canvas: 1000 x 562.5 (16:9). All coords in logical px, origin top-left.

Each layout function takes:
  slide_data = { title, bullets[], layout, theme }
  → returns { elements: [...] }   (PPTElement list, minus slide id)

Element IDs are generated with a prefix + counter; the deck_service assigns final ids.
"""
import uuid

# Canvas constants
CANVAS_W = 1000
CANVAS_H = 562.5

# Theme defaults
DEFAULT_THEME = {
	"backgroundColor": "#0f0f1e",
	"themeColors": ["#6c5ce7", "#a29bfe", "#0ea5e9", "#10b981", "#f97316", "#a855f7"],
	"fontColor": "#ffffff",
	"fontName": "",
}


def _gen_id() -> str:
	return uuid.uuid4().hex[:10]


def _theme_get(theme: dict, key: str, default=None):
	if not theme:
		return default
	return theme.get(key, default)


def _accent(theme: dict, i: int = 0) -> str:
	colors = _theme_get(theme, "themeColors", DEFAULT_THEME["themeColors"])
	return colors[i % len(colors)]


def _text_el(
	content: str,
	left: float,
	top: float,
	width: float,
	height: float,
	*,
	font_size: int = 20,
	color: str | None = None,
	font_name: str = "",
	bold: bool = False,
	line_height: float = 1.4,
	rotate: float = 0,
	text_type: str = "content",
) -> dict:
	"""Helper to build a PPTTextElement."""
	style = f"font-size:{font_size}px;"
	if bold:
		style += "font-weight:700;"
	if color:
		style += f"color:{color};"
	if font_name:
		style += f"font-family:{font_name};"
	html = f'<p style="{style}">{content}</p>'
	return {
		"type": "text",
		"id": _gen_id(),
		"left": left,
		"top": top,
		"width": width,
		"height": height,
		"rotate": rotate,
		"content": html,
		"defaultFontName": font_name,
		"defaultColor": color or "#ffffff",
		"lineHeight": line_height,
		"paragraphSpace": 8,
		"inset": [10, 10, 10, 10],
		"textType": text_type,
		"vertical": False,
		"fill": "transparent",
	}


def _shape_rect(
	left: float,
	top: float,
	width: float,
	height: float,
	fill: str,
	*,
	opacity: float = 1.0,
) -> dict:
	"""Build a rectangle shape element (SVG rect path)."""
	return {
		"type": "shape",
		"id": _gen_id(),
		"left": left,
		"top": top,
		"width": width,
		"height": height,
		"rotate": 0,
		"viewBox": [100, 100],
		"path": "M0,0 L100,0 L100,100 L0,100 Z",
		"fixedRatio": False,
		"fill": fill,
		"opacity": opacity,
	}


# ── Layout: cover (title slide) ──

def layout_cover(slide_data: dict, theme: dict) -> list:
	title = slide_data.get("title", "Untitled")
	subtitle = slide_data.get("subtitle") or ""
	accent = _accent(theme)
	bg = _theme_get(theme, "backgroundColor", DEFAULT_THEME["backgroundColor"])

	elements = []
	# Accent bar
	elements.append(_shape_rect(80, 200, 6, 60, accent))
	# Title
	elements.append(_text_el(
		title, 110, 180, 780, 100,
		font_size=44, color=_theme_get(theme, "fontColor", "#ffffff"),
		bold=True, text_type="title",
	))
	# Subtitle
	if subtitle:
		elements.append(_text_el(
			subtitle, 112, 290, 700, 50,
			font_size=20, color=_accent(theme, 1), text_type="subtitle",
		))
	return elements


# ── Layout: section (big title divider) ──

def layout_section(slide_data: dict, theme: dict) -> list:
	title = slide_data.get("title", "")
	accent = _accent(theme)
	elements = [
		_shape_rect(0, 250, CANVAS_W, 2, accent, opacity=0.3),
		_text_el(title, 80, 220, 840, 120,
			font_size=36, color=_theme_get(theme, "fontColor", "#ffffff"),
			bold=True, text_type="title"),
	]
	return elements


# ── Layout: bullets (title + bullet list) ──

def layout_bullets(slide_data: dict, theme: dict) -> list:
	title = slide_data.get("title", "")
	bullets = slide_data.get("bullets", [])
	accent = _accent(theme)
	text_color = _theme_get(theme, "fontColor", "#ffffff")

	elements = []
	# Title
	elements.append(_text_el(
		title, 60, 40, 880, 60,
		font_size=28, color=text_color, bold=True, text_type="title",
	))
	# Accent underline
	elements.append(_shape_rect(60, 100, 60, 3, accent))

	# Bullets
	if bullets:
		items_html = "".join(f"<li>{b}</li>" for b in bullets)
		style = f"font-size:18px;color:{text_color};"
		html = f'<ul style="{style}list-style-type:disc;padding-left:24px;line-height:1.8;">{items_html}</ul>'
		elements.append({
			"type": "text",
			"id": _gen_id(),
			"left": 60,
			"top": 130,
			"width": 880,
			"height": 380,
			"rotate": 0,
			"content": html,
			"defaultFontName": "",
			"defaultColor": text_color,
			"lineHeight": 1.8,
			"paragraphSpace": 12,
			"inset": [10, 10, 10, 10],
			"textType": "content",
			"vertical": False,
			"fill": "transparent",
		})

	return elements


# ── Layout: two-column ──

def layout_two_column(slide_data: dict, theme: dict) -> list:
	title = slide_data.get("title", "")
	bullets = slide_data.get("bullets", [])
	accent = _accent(theme)
	text_color = _theme_get(theme, "fontColor", "#ffffff")

	elements = []
	elements.append(_text_el(title, 60, 40, 880, 60,
		font_size=28, color=text_color, bold=True, text_type="title"))
	elements.append(_shape_rect(60, 100, 60, 3, accent))

	mid = (len(bullets) + 1) // 2
	left_bullets = bullets[:mid]
	right_bullets = bullets[mid:]

	for col, (col_bullets, x) in enumerate([(left_bullets, 60), (right_bullets, 520)]):
		if not col_bullets:
			continue
		# accent dot for column header
		elements.append(_shape_rect(x, 140, 8, 8, _accent(theme, col + 1)))
		items_html = "".join(f"<li>{b}</li>" for b in col_bullets)
		style = f"font-size:16px;color:{text_color};"
		html = f'<ul style="{style}list-style-type:disc;padding-left:20px;line-height:1.7;">{items_html}</ul>'
		elements.append({
			"type": "text",
			"id": _gen_id(),
			"left": x,
			"top": 160,
			"width": 420,
			"height": 360,
			"rotate": 0,
			"content": html,
			"defaultFontName": "",
			"defaultColor": text_color,
			"lineHeight": 1.7,
			"paragraphSpace": 10,
			"inset": [10, 10, 10, 10],
			"textType": "content",
			"vertical": False,
			"fill": "transparent",
		})

	return elements


# ── Layout: image-text (placeholder image + text) ──

def layout_image_text(slide_data: dict, theme: dict) -> list:
	title = slide_data.get("title", "")
	bullets = slide_data.get("bullets", [])
	accent = _accent(theme)
	text_color = _theme_get(theme, "fontColor", "#ffffff")

	elements = []
	# Title
	elements.append(_text_el(title, 60, 40, 880, 60,
		font_size=28, color=text_color, bold=True, text_type="title"))

	# Image placeholder (left)
	elements.append(_shape_rect(60, 130, 400, 380, _accent(theme, 2), opacity=0.15))
	elements.append(_text_el("📷 Image", 180, 290, 160, 40,
		font_size=16, color=_accent(theme, 2)))

	# Text (right)
	if bullets:
		items_html = "".join(f"<li>{b}</li>" for b in bullets)
		style = f"font-size:16px;color:{text_color};"
		html = f'<ul style="{style}list-style-type:disc;padding-left:20px;line-height:1.7;">{items_html}</ul>'
		elements.append({
			"type": "text",
			"id": _gen_id(),
			"left": 500,
			"top": 130,
			"width": 440,
			"height": 380,
			"rotate": 0,
			"content": html,
			"defaultFontName": "",
			"defaultColor": text_color,
			"lineHeight": 1.7,
			"paragraphSpace": 10,
			"inset": [10, 10, 10, 10],
			"textType": "content",
			"vertical": False,
			"fill": "transparent",
		})

	return elements


# ── Dispatch ──

LAYOUTS = {
	"cover": layout_cover,
	"section": layout_section,
	"bullets": layout_bullets,
	"two-column": layout_two_column,
	"image-text": layout_image_text,
}


def build_slide(slide_data: dict, theme: dict | None = None) -> dict:
	"""
	Convert AI semantic slide data → PPTist Slide object.
	Returns { id, elements, background }.
	"""
	t = theme or DEFAULT_THEME
	layout_key = slide_data.get("layout", "bullets")
	builder = LAYOUTS.get(layout_key, layout_bullets)
	elements = builder(slide_data, t)

	bg_color = _theme_get(t, "backgroundColor", DEFAULT_THEME["backgroundColor"])
	return {
		"id": _gen_id(),
		"elements": elements,
		"background": {"type": "solid", "color": bg_color},
	}
