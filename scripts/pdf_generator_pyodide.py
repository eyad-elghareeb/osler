# PYODIDE-ADAPTED: QuizTool PDF Generator — Premium Impeccable-Grade Design.
# Adapted from pdf_generator.py for browser-side execution via Pyodide.
# Changes from original:
#   - register_fonts() accepts font_dir parameter (virtual FS path in Pyodide)
#   - generate_pdf_bytes(config_dict, font_dir) returns bytes via io.BytesIO
#   - No CLI entry point, no file-based config loading

import json, sys, os, re, io
from reportlab.lib.pagesizes import A3, A4, A5, LETTER, LEGAL, TABLOID, landscape
from reportlab.lib.colors   import HexColor, white
from reportlab.lib.styles   import ParagraphStyle
from reportlab.lib.enums    import TA_LEFT, TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
    Table, TableStyle, PageBreak, KeepTogether, NextPageTemplate, Flowable,
)
from reportlab.pdfbase            import pdfmetrics
from reportlab.pdfbase.ttfonts    import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily


# ─────────────────────────────────────────────────────────────
# § 1  FONTS
# ─────────────────────────────────────────────────────────────

_F = {
    "H":   "Helvetica-Bold",
    "Hn":  "Helvetica",
    "Hl":  "Helvetica",
    "Hli": "Helvetica-Oblique",
    "Hm":  "Helvetica",
    "B":   "Times-Roman",
    "Bb":  "Times-Bold",
    "Bi":  "Times-Italic",
    "Bbi": "Times-BoldItalic",
    "M":   "Courier",
    "Mb":  "Courier-Bold",
}


def register_fonts(font_dir=None):
    """Register Poppins + Lora + LiberationMono with graceful fallback.
    font_dir: path to directory containing TTF font files (e.g. Pyodide virtual FS).
    Falls back to built-in Helvetica/Times/Courier if fonts not found."""
    search_dirs = []
    if font_dir and os.path.isdir(font_dir):
        search_dirs.append(font_dir)
    if font_dir:
        # Also try the local fonts/ subdirectory of font_dir
        sub = os.path.join(font_dir, "fonts")
        if os.path.isdir(sub):
            search_dirs.append(sub)

    def _resolve(fname):
        for d in search_dirs:
            p = os.path.join(d, fname)
            if os.path.exists(p):
                return p
            p_lower = os.path.join(d, fname.lower())
            if os.path.exists(p_lower):
                return p_lower
        return None

    candidates = [
        ("Poppins",             "Poppins-Regular.ttf"),
        ("Poppins-Bold",        "Poppins-Bold.ttf"),
        ("Poppins-Italic",      "Poppins-Italic.ttf"),
        ("Poppins-BoldItalic",  "Poppins-BoldItalic.ttf"),
        ("Poppins-Medium",      "Poppins-Medium.ttf"),
        ("Poppins-Light",       "Poppins-Light.ttf"),
        ("Poppins-LightItalic", "Poppins-LightItalic.ttf"),
        ("Lora",                "Lora[wght].ttf"),
        ("Lora",                "Lora-Variable.ttf"),
        ("Lora-Italic",         "Lora-Italic[wght].ttf"),
        ("Lora-Italic",         "Lora-Italic-Variable.ttf"),
        ("LoraB",               "LiberationSerif-Bold.ttf"),
        ("LoraBI",              "LiberationSerif-BoldItalic.ttf"),
        ("Mono",                "LiberationMono-Regular.ttf"),
        ("Mono-Bold",           "LiberationMono-Bold.ttf"),
    ]
    ok = set()
    registered = set()
    for name, fname in candidates:
        if name in registered:
            continue
        path = _resolve(fname)
        if path:
            try:
                pdfmetrics.registerFont(TTFont(name, path))
                ok.add(name)
                registered.add(name)
            except Exception:
                pass

    if "Poppins" in ok:
        registerFontFamily("Poppins", normal="Poppins", bold="Poppins-Bold",
                           italic="Poppins-Italic", boldItalic="Poppins-BoldItalic")
        _F["H"]   = "Poppins-Bold"
        _F["Hn"]  = "Poppins"
        _F["Hl"]  = "Poppins-Light"       if "Poppins-Light"       in ok else "Poppins"
        _F["Hli"] = "Poppins-LightItalic" if "Poppins-LightItalic" in ok else "Poppins-Italic"
        _F["Hm"]  = "Poppins-Medium"      if "Poppins-Medium"      in ok else "Poppins"

    if "Lora" in ok:
        registerFontFamily("Lora", normal="Lora", bold="LoraB",
                           italic="Lora-Italic", boldItalic="LoraBI")
        _F["B"]   = "Lora"
        _F["Bb"]  = "LoraB"       if "LoraB"  in ok else "Lora"
        _F["Bi"]  = "Lora-Italic" if "Lora-Italic" in ok else "Lora"
        _F["Bbi"] = "LoraBI"      if "LoraBI" in ok else "Lora"

    if "Mono" in ok:
        _F["M"]  = "Mono"
        _F["Mb"] = "Mono-Bold" if "Mono-Bold" in ok else "Mono"


# ─────────────────────────────────────────────────────────────
# § 2  COLOR PALETTE
# ─────────────────────────────────────────────────────────────

NAVY       = HexColor("#0B1E33")
COBALT     = HexColor("#1A3A5C")
ROYAL      = HexColor("#1E5FA8")
PALE_BLUE  = HexColor("#EBF3FA")
GOLD       = HexColor("#C9920A")
GOLD_MID   = HexColor("#E8A912")
EMERALD    = HexColor("#0A5C36")
SAGE       = HexColor("#18855A")
PALE_GREEN = HexColor("#E6F5ED")
MINT_RULE  = HexColor("#A8D8BC")
CHARCOAL   = HexColor("#1A1A2E")
SLATE      = HexColor("#3A4554")
MUTED      = HexColor("#6B7A8D")
RULE_GRAY  = HexColor("#D0D8E4")
PALE_GRAY  = HexColor("#F4F6F9")
LINK       = HexColor("#1565C0")


def _hx(c):
    return f"{int(c.red*255):02x}{int(c.green*255):02x}{int(c.blue*255):02x}"


# ─────────────────────────────────────────────────────────────
# § 3  SPACING GRID — 4pt base
# ─────────────────────────────────────────────────────────────

def sp(n, scale=1.0):
    return round(n * 4 * scale, 1)


# ─────────────────────────────────────────────────────────────
# § 4  PAGE SIZES + LAYOUT CALCULATOR
# ─────────────────────────────────────────────────────────────

PAGE_SIZES = {
    "a3": A3, "a4": A4, "a5": A5,
    "letter": LETTER, "legal": LEGAL, "tabloid": TABLOID,
}


def page_layout(page_size, compact=False):
    pw, ph  = page_size
    scale   = pw / 595.0
    ms      = max(18, int(round(28  * scale)))
    mt      = max(38, int(round(52  * scale)))
    mb      = max(22, int(round(36  * scale)))
    gu      = max(8,  int(round(16  * scale)))
    bh      = max(20, int(round(28  * scale)))
    cw      = (pw - 2 * ms - gu) / 2
    fw      = pw - 2 * ms
    fs      = max(0.80, min(1.22, scale))
    if compact:
        fs *= 0.88
    return dict(pw=pw, ph=ph, ms=ms, mt=mt, mb=mb,
                gu=gu, bh=bh, cw=cw, fw=fw, fs=fs, scale=scale)


# ─────────────────────────────────────────────────────────────
# § 5  CUSTOM FLOWABLES
# ─────────────────────────────────────────────────────────────

class HRule(Flowable):
    def __init__(self, width=400, thickness=0.5, color=RULE_GRAY, before=8, after=8):
        super().__init__()
        self.width     = width
        self.height    = thickness + before + after
        self.thickness = thickness
        self.color     = color
        self.before    = before
        self.after     = after

    def draw(self):
        c = self.canv
        c.saveState()
        c.setStrokeColor(self.color)
        c.setLineWidth(self.thickness)
        y = self.height - self.before - self.thickness
        c.line(0, y, self.width, y)
        c.restoreState()


class DoubleRule(Flowable):
    def __init__(self, width=400, color=GOLD, before=8, after=8):
        super().__init__()
        self.width  = width
        self.color  = color
        self.before = before
        self.after  = after
        self.height = before + after + 8

    def draw(self):
        c = self.canv
        c.saveState()
        c.setStrokeColor(self.color)
        base = self.after
        c.setLineWidth(2.4)
        c.line(0, base + 5, self.width, base + 5)
        c.setLineWidth(0.7)
        c.line(0, base + 1.5, self.width, base + 1.5)
        c.restoreState()


class Anchor(Flowable):
    def __init__(self, name):
        super().__init__()
        self.name   = name
        self.width  = 0
        self.height = 0

    def wrap(self, aw, ah):
        return (0, 0)

    def draw(self):
        self.canv.bookmarkPage(self.name, fit="XYZ", left=0, top=None, zoom=0)


class TrackedLabel(Flowable):
    def __init__(self, text, font_name=None, font_size=10,
                 color=COBALT, tracking=0.9):
        super().__init__()
        self.text      = text
        self.font_name = font_name
        self.font_size = font_size
        self.color     = color
        self.tracking  = tracking
        self.height    = font_size * 1.55

    def wrap(self, aw, ah):
        self.width = aw
        return (aw, self.height)

    def draw(self):
        fn = self.font_name or _F["H"]
        c  = self.canv
        c.saveState()
        t = c.beginText(0, self.height * 0.18)
        t.setFont(fn, self.font_size)
        t.setFillColor(self.color)
        t.setCharSpace(self.tracking)
        t.textLine(self.text)
        c.drawText(t)
        c.restoreState()


class SectionBanner(Flowable):
    def __init__(self, main_text, sub_text="",
                 bg=COBALT, accent=GOLD, fg=white, height=52):
        super().__init__()
        self.main_text = main_text
        self.sub_text  = sub_text
        self.bg        = bg
        self.accent    = accent
        self.fg        = fg
        self.height    = height

    def wrap(self, aw, ah):
        self.width = aw
        return (aw, self.height)

    def draw(self):
        c = self.canv
        c.saveState()
        w, h = self.width, self.height
        c.setFillColor(self.bg)
        c.rect(0, 0, w, h - 4, fill=1, stroke=0)
        c.setFillColor(self.accent)
        c.rect(0, h - 4, w, 4, fill=1, stroke=0)
        c.setStrokeColor(self.accent)
        c.setLineWidth(0.8)
        c.line(0, 0, w, 0)
        if self.sub_text:
            t = c.beginText(12, 30)
            t.setFont(_F["H"], 11)
            t.setFillColor(self.fg)
            t.setCharSpace(0.6)
            t.textLine(self.main_text)
            c.drawText(t)
            sub_color = (HexColor("#A8C4DC") if self.bg == COBALT
                         else HexColor("#A8D8BE"))
            t2 = c.beginText(12, 10)
            t2.setFont(_F["Hl"], 7.5)
            t2.setFillColor(sub_color)
            t2.textLine(self.sub_text)
            c.drawText(t2)
        else:
            t = c.beginText(12, 18)
            t.setFont(_F["H"], 11)
            t.setFillColor(self.fg)
            t.setCharSpace(0.6)
            t.textLine(self.main_text)
            c.drawText(t)
        c.restoreState()


# ─────────────────────────────────────────────────────────────
# § 6  HELPERS
# ─────────────────────────────────────────────────────────────

LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def xesc(text):
    if not text:
        return ""
    return (str(text)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\n", "<br/>")
            .strip())


def _preview(text, n=22):
    words = str(text).split()
    return (" ".join(words[:n]) + "\u2026") if len(words) > n else text


def _md_to_html(text):
    if not text:
        return text
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)', r'<i>\1</i>', text)
    text = re.sub(r'~~(.+?)~~', r'<strike>\1</strike>', text)
    return text


def _detect_pipe_table(lines, start):
    if start >= len(lines) or not lines[start].lstrip().startswith('|'):
        return -1
    if start + 1 >= len(lines):
        return -1
    sep = lines[start + 1].strip()
    if not re.match(r'^\|[-| :]+\|$', sep):
        return -1
    end = start + 2
    while end < len(lines) and lines[end].lstrip().startswith('|'):
        end += 1
    return end


def _parse_table_cells(row):
    parts = row.split('|')
    if parts and parts[0].strip() == '':
        parts = parts[1:]
    if parts and parts[-1].strip() == '':
        parts = parts[:-1]
    return [p.strip() for p in parts]


def _build_table_flowable(table_lines, content_w, fs=1.0):
    header = _parse_table_cells(table_lines[0])
    align_row = table_lines[1] if len(table_lines) > 1 else ''
    aligns = re.findall(r':?-{3,}:?', align_row)
    ncols = max(len(header), len(aligns))
    data = [header[:ncols]]
    for row in table_lines[2:]:
        cells = _parse_table_cells(row)
        cells = (cells + [''] * ncols)[:ncols]
        data.append(cells)

    col_w = content_w / max(ncols, 1)
    from reportlab.lib.styles import ParagraphStyle as _PS
    from reportlab.platypus import Paragraph as RlParagraph

    cell_style = _PS(
        '_tc', fontName=_F["Hn"],
        fontSize=round(8 * fs, 1), leading=round(11 * fs, 1),
        textColor=SLATE,
    )
    head_style = _PS(
        '_th', fontName=_F["H"],
        fontSize=round(8 * fs, 1), leading=round(11 * fs, 1),
        textColor=COBALT,
    )

    styled = []
    for ri, row in enumerate(data):
        sty = head_style if ri == 0 else cell_style
        styled.append([RlParagraph(_md_to_html(xesc(c)), sty) for c in row])

    from reportlab.lib.colors import white as rl_white
    t = Table(styled, colWidths=[col_w] * ncols)
    t.setStyle(TableStyle([
        ("BACKGROUND",     (0, 0), (-1, 0), COBALT),
        ("TEXTCOLOR",      (0, 0), (-1, 0), rl_white),
        ("FONTNAME",       (0, 0), (-1, 0), _F["H"]),
        ("FONTSIZE",       (0, 0), (-1, 0), round(8 * fs, 1)),
        ("BOTTOMPADDING",  (0, 0), (-1, 0), sp(1, fs)),
        ("TOPPADDING",     (0, 0), (-1, 0), sp(1, fs)),
        ("GRID",           (0, 0), (-1, -1), 0.5, RULE_GRAY),
        ("VALIGN",         (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING",    (0, 0), (-1, -1), sp(1, fs)),
        ("RIGHTPADDING",   (0, 0), (-1, -1), sp(1, fs)),
        ("TOPPADDING",     (0, 1), (-1, -1), sp(1, fs)),
        ("BOTTOMPADDING",  (0, 1), (-1, -1), sp(1, fs)),
    ]))
    for ri in range(1, len(styled)):
        if ri % 2 == 0:
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, ri), (-1, ri), PALE_GRAY),
            ]))
    return t


def _build_flowables(text, style, content_w, fs=1.0):
    if not text:
        return []
    raw = text.strip()
    if not raw:
        return []
    lines = raw.split('\n')
    result = []
    i = 0
    while i < len(lines):
        table_end = _detect_pipe_table(lines, i)
        if table_end > 0:
            tbl = _build_table_flowable(lines[i:table_end], content_w, fs)
            result.append(tbl)
            i = table_end
        else:
            chunk = []
            while i < len(lines) and _detect_pipe_table(lines, i) < 0:
                chunk.append(lines[i])
                i += 1
            text_block = '\n'.join(chunk).strip()
            if text_block:
                for para_text in re.split(r'\n[ \t]*\n', text_block):
                    if para_text.strip():
                        html = _md_to_html(xesc(para_text.strip()))
                        result.append(Paragraph(html, style))
    return result


def _correct_badge(letter, opt_text, col_w, fs=1.0):
    inner = ParagraphStyle(
        "_cb", fontName=_F["H"],
        fontSize=round(9.5 * fs, 1), leading=round(14 * fs, 1),
        textColor=white,
    )
    cell = Paragraph(
        f"\u2713\u2003Correct Answer: \u2002{letter}.\u2002{_md_to_html(xesc(opt_text))}", inner
    )
    t = Table([[cell]], colWidths=[col_w])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), EMERALD),
        ("TOPPADDING",    (0, 0), (-1, -1), sp(2)),
        ("BOTTOMPADDING", (0, 0), (-1, -1), sp(2)),
        ("LEFTPADDING",   (0, 0), (-1, -1), sp(3)),
        ("RIGHTPADDING",  (0, 0), (-1, -1), sp(2)),
    ]))
    return t


def _callout_box(label, body_text, col_w, bg, border_color, fs=1.0):
    lbl_sty = ParagraphStyle(
        "_cl", fontName=_F["H"],
        fontSize=round(7 * fs, 1), leading=round(10 * fs, 1),
        textColor=border_color,
    )
    txt_sty = ParagraphStyle(
        "_ct", fontName=_F["Bi"],
        fontSize=round(8.5 * fs, 1), leading=round(12.5 * fs, 1),
        textColor=SLATE,
    )
    pad_total = sp(3, fs) + sp(2, fs)
    inner_w   = max(col_w - pad_total, 10)
    body_flows = _build_flowables(body_text, txt_sty, inner_w, fs)
    if not body_flows:
        return Paragraph(label, lbl_sty)

    rows = [[Paragraph(label, lbl_sty)]] + [[fb] for fb in body_flows]
    t = Table(rows, colWidths=[col_w])
    t.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), bg),
        ("TOPPADDING",    (0, 0), (0, 0),   sp(1)),
        ("BOTTOMPADDING", (0, 0), (0, 0),   sp(1)),
        ("TOPPADDING",    (0, 1), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 1), (-1, -1), sp(2)),
        ("LEFTPADDING",   (0, 0), (-1, -1), sp(3)),
        ("RIGHTPADDING",  (0, 0), (-1, -1), sp(2)),
        ("OUTLINE",       (0, 0), (-1, -1), 0.75, border_color),
    ]))
    return t


# ─────────────────────────────────────────────────────────────
# § 7  PARAGRAPH STYLES
# ─────────────────────────────────────────────────────────────

def make_styles(fs=1.0):
    s = {}
    f = fs

    s["cv_eyebrow"] = ParagraphStyle(
        "cv_eyebrow", fontName=_F["Hl"], fontSize=round(8*f,1), leading=round(12*f,1),
        textColor=HexColor("#6A90B8"), alignment=TA_CENTER,
    )
    s["cv_title"] = ParagraphStyle(
        "cv_title", fontName=_F["H"], fontSize=round(44*f,1), leading=round(50*f,1),
        textColor=white, alignment=TA_CENTER, spaceAfter=sp(2),
    )
    s["cv_subtitle"] = ParagraphStyle(
        "cv_subtitle", fontName=_F["Bi"], fontSize=round(17*f,1), leading=round(24*f,1),
        textColor=HexColor("#C0D8F0"), alignment=TA_CENTER, spaceAfter=sp(2),
    )
    s["cv_meta"] = ParagraphStyle(
        "cv_meta", fontName=_F["Hl"], fontSize=round(10*f,1), leading=round(16*f,1),
        textColor=HexColor("#8CAECE"), alignment=TA_CENTER, spaceAfter=sp(1),
    )
    s["cv_feature"] = ParagraphStyle(
        "cv_feature", fontName=_F["Hn"], fontSize=round(9*f,1), leading=round(14*f,1),
        textColor=HexColor("#C8DFF0"), alignment=TA_CENTER, spaceAfter=sp(1),
    )
    s["cv_footer_txt"] = ParagraphStyle(
        "cv_footer_txt", fontName=_F["Hl"], fontSize=round(7.5*f,1), leading=round(11*f,1),
        textColor=HexColor("#456080"), alignment=TA_CENTER,
    )

    s["toc_heading"] = ParagraphStyle(
        "toc_heading", fontName=_F["H"], fontSize=round(20*f,1), leading=round(26*f,1),
        textColor=CHARCOAL, alignment=TA_LEFT, spaceAfter=sp(2),
    )
    s["toc_entry"] = ParagraphStyle(
        "toc_entry", fontName=_F["B"], fontSize=round(11*f,1), leading=round(16*f,1),
        textColor=CHARCOAL, spaceAfter=sp(1),
    )
    s["toc_desc"] = ParagraphStyle(
        "toc_desc", fontName=_F["Bi"], fontSize=round(8.5*f,1), leading=round(12*f,1),
        textColor=MUTED, leftIndent=sp(4), spaceAfter=sp(2),
    )
    s["toc_ch_num"] = ParagraphStyle(
        "toc_ch_num", fontName=_F["H"], fontSize=round(8*f,1), leading=round(11*f,1),
        textColor=COBALT, leftIndent=0,
    )

    s["q_body"] = ParagraphStyle(
        "q_body", fontName=_F["B"],
        fontSize=round(9.5*f,1), leading=round(14*f,1),
        textColor=CHARCOAL, alignment=TA_JUSTIFY,
        spaceBefore=sp(2), spaceAfter=round(14*f,1),
    )
    s["q_option"] = ParagraphStyle(
        "q_option", fontName=_F["B"],
        fontSize=round(9*f,1), leading=round(13*f,1),
        textColor=SLATE, leftIndent=sp(4),
        spaceAfter=round(4*f,1),
    )
    s["q_option_correct"] = ParagraphStyle(
        "q_option_correct", fontName=_F["Bb"],
        fontSize=round(9*f,1), leading=round(13*f,1),
        textColor=EMERALD, leftIndent=sp(4),
        spaceAfter=round(4*f,1),
    )
    s["q_link"] = ParagraphStyle(
        "q_link", fontName=_F["Hn"], fontSize=round(7.5*f,1), leading=round(10*f,1),
        textColor=LINK, alignment=TA_RIGHT,
        spaceBefore=sp(2), spaceAfter=sp(1),
    )
    s["q_badge"] = ParagraphStyle(
        "q_badge", fontName=_F["Hn"], fontSize=round(7*f,1), leading=round(9*f,1),
        textColor=COBALT,
    )
    s["inline_ans"] = ParagraphStyle(
        "inline_ans", fontName=_F["H"],
        fontSize=round(9*f,1), leading=round(13*f,1),
        textColor=EMERALD, spaceBefore=sp(1), spaceAfter=sp(1),
    )
    s["inline_expl"] = ParagraphStyle(
        "inline_expl", fontName=_F["Bi"],
        fontSize=round(8.5*f,1), leading=round(12.5*f,1),
        textColor=MUTED, spaceAfter=sp(2),
    )

    s["note_q"] = ParagraphStyle(
        "note_q", fontName=_F["Bb"],
        fontSize=round(8.5*f,1), leading=round(12*f,1),
        textColor=CHARCOAL, spaceAfter=sp(1),
    )
    s["note_ans"] = ParagraphStyle(
        "note_ans", fontName=_F["Hn"],
        fontSize=round(8*f,1), leading=round(11*f,1),
        textColor=EMERALD, leftIndent=sp(3), spaceAfter=1,
    )
    s["note_expl"] = ParagraphStyle(
        "note_expl", fontName=_F["Bi"],
        fontSize=round(7.5*f,1), leading=round(10.5*f,1),
        textColor=MUTED, leftIndent=sp(5), spaceAfter=sp(2),
    )

    s["a_preview"] = ParagraphStyle(
        "a_preview", fontName=_F["Bi"],
        fontSize=round(8*f,1), leading=round(12*f,1),
        textColor=MUTED, spaceAfter=sp(3),
    )
    s["a_expl"] = ParagraphStyle(
        "a_expl", fontName=_F["B"],
        fontSize=round(9.5*f,1), leading=round(14*f,1),
        textColor=CHARCOAL, alignment=TA_JUSTIFY,
        spaceBefore=sp(2), spaceAfter=sp(3),
    )
    s["a_back_lnk"] = ParagraphStyle(
        "a_back_lnk", fontName=_F["Hn"], fontSize=round(7*f,1), leading=round(9*f,1),
        textColor=LINK, alignment=TA_RIGHT,
        spaceBefore=sp(2), spaceAfter=sp(1),
    )
    s["a_qref_title"] = ParagraphStyle(
        "a_qref_title", fontName=_F["H"], fontSize=round(7*f,1), leading=round(10*f,1),
        textColor=COBALT, alignment=TA_CENTER, spaceBefore=sp(1), spaceAfter=sp(1),
    )
    s["a_qref"] = ParagraphStyle(
        "a_qref", fontName=_F["Hn"], fontSize=round(7.5*f,1), leading=round(11*f,1),
        textColor=COBALT, alignment=TA_CENTER, spaceAfter=sp(2),
    )

    s["ch_label"] = ParagraphStyle(
        "ch_label", fontName=_F["H"], fontSize=round(8*f,1), leading=round(11*f,1),
        textColor=GOLD, spaceAfter=sp(1),
    )
    s["ch_title"] = ParagraphStyle(
        "ch_title", fontName=_F["H"], fontSize=round(18*f,1), leading=round(24*f,1),
        textColor=CHARCOAL, spaceAfter=sp(1),
    )
    s["ch_desc"] = ParagraphStyle(
        "ch_desc", fontName=_F["Bi"], fontSize=round(9*f,1), leading=round(13*f,1),
        textColor=MUTED, spaceAfter=sp(3),
    )

    return s


# ─────────────────────────────────────────────────────────────
# § 8  PAGE BACKGROUND DRAWING
# ─────────────────────────────────────────────────────────────

def draw_cover_page(canvas, doc):
    canvas.saveState()
    pw, ph = doc.pagesize
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, pw, ph, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#0D2744"))
    canvas.rect(0, ph * 0.74, pw, ph * 0.26, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#0F3060"))
    p = canvas.beginPath()
    p.moveTo(0,          ph * 0.87)
    p.lineTo(pw * 0.62,  ph * 0.87)
    p.lineTo(pw * 0.46,  ph)
    p.lineTo(0,          ph)
    p.close()
    canvas.drawPath(p, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#132D50"))
    p2 = canvas.beginPath()
    p2.moveTo(pw * 0.70, ph)
    p2.lineTo(pw,        ph)
    p2.lineTo(pw,        ph * 0.74)
    p2.lineTo(pw * 0.85, ph * 0.74)
    p2.close()
    canvas.drawPath(p2, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, ph - 5, pw, 5, fill=1, stroke=0)
    canvas.setStrokeColor(GOLD)
    canvas.setLineWidth(0.8)
    canvas.line(pw * 0.06, ph * 0.74 - 2, pw * 0.94, ph * 0.74 - 2)
    canvas.setFillColor(HexColor("#14304E"))
    canvas.rect(pw * 0.965, 0, pw * 0.035, ph, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(pw * 0.965, ph * 0.382, pw * 0.009, ph * 0.236, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#060E18"))
    canvas.rect(0, 0, pw, ph * 0.09, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, ph * 0.09, pw, 2, fill=1, stroke=0)
    canvas.setStrokeColor(HexColor("#18304A"))
    canvas.setLineWidth(0.35)
    grid_step = max(20, int(pw / 28))
    for x in range(0, int(pw * 0.96), grid_step):
        canvas.line(x, 0, x, ph * 0.089)
    canvas.line(0, ph * 0.035, pw * 0.96, ph * 0.035)
    canvas.line(0, ph * 0.065, pw * 0.96, ph * 0.065)
    canvas.setStrokeColor(HexColor("#1C3D60"))
    canvas.setLineWidth(0.6)
    canvas.roundRect(pw * 0.05, ph * 0.10,
                     pw * 0.87, ph * 0.58,
                     3, fill=0, stroke=1)
    for i, shade in enumerate(["#0E2E50", "#163A64", "#1E4878"]):
        canvas.setFillColor(HexColor(shade))
        canvas.circle(pw * 0.10 + i * (13 * pw / 595),
                      ph * 0.70,
                      (5 - i * 0.5) * (pw / 595),
                      fill=1, stroke=0)
    canvas.restoreState()


def _draw_header_band(canvas, doc, bg_color, section_label, label_fg):
    canvas.saveState()
    pw, ph = doc.pagesize
    lm     = doc.leftMargin
    rm     = doc.rightMargin
    bh     = getattr(doc, "_band_h", 28)
    canvas.setFillColor(bg_color)
    canvas.rect(0, ph - bh, pw, bh, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, ph - 5, pw, 5, fill=1, stroke=0)
    title = getattr(doc, "_header_title", "")[:55]
    y_txt = ph - bh + (bh - 8) * 0.4
    canvas.setFillColor(white)
    canvas.setFont(_F["H"], 7.5)
    canvas.drawString(lm, y_txt, title)
    if section_label:
        lbl_w = canvas.stringWidth(section_label, _F["Hl"], 7)
        t = canvas.beginText(pw - rm - lbl_w, y_txt)
        t.setFont(_F["Hl"], 7)
        t.setFillColor(label_fg)
        t.setCharSpace(0.7)
        t.textLine(section_label)
        canvas.drawText(t)
    canvas.setFont(_F["Hl"], 7)
    canvas.setFillColor(MUTED)
    canvas.drawCentredString(pw / 2, 14, f"\u2014\u2002{doc.page}\u2002\u2014")
    canvas.setStrokeColor(RULE_GRAY)
    canvas.setLineWidth(0.35)
    canvas.line(lm, 28, pw - rm, 28)
    canvas.restoreState()


def draw_questions_page(canvas, doc):
    _draw_header_band(canvas, doc, COBALT,  "QUESTIONS",  HexColor("#A8C4DC"))


def draw_answers_page(canvas, doc):
    _draw_header_band(canvas, doc, EMERALD, "ANSWER KEY", HexColor("#A8D8BE"))


def draw_toc_page(canvas, doc):
    _draw_header_band(canvas, doc, NAVY, "CONTENTS", HexColor("#8CAECE"))


# ─────────────────────────────────────────────────────────────
# § 9  COVER PAGE BUILDER
# ─────────────────────────────────────────────────────────────

def build_cover(cfg, styles, layout):
    fw     = layout["fw"]
    fs     = layout["fs"]
    story  = []
    cover  = cfg.get("cover", {})
    quizzes = cfg.get("quizzes", [])
    total_q = sum(len(q.get("questions", [])) for q in quizzes)
    ch_count = len(quizzes)

    story.append(Spacer(1, sp(16, fs)))
    eyebrow_text = cover.get("eyebrow", "Q U I Z &nbsp; C O M P I L A T I O N")
    story.append(Paragraph(eyebrow_text, styles["cv_eyebrow"]))
    story.append(Spacer(1, sp(3, fs)))
    title = cover.get("title", "Quiz Compilation")
    story.append(Paragraph(xesc(title), styles["cv_title"]))
    subtitle = cover.get("subtitle", "")
    if subtitle:
        story.append(Paragraph(xesc(subtitle), styles["cv_subtitle"]))
    story.append(Spacer(1, sp(1, fs)))
    story.append(DoubleRule(fw, color=GOLD, before=sp(2, fs), after=sp(2, fs)))
    story.append(Spacer(1, sp(4, fs)))
    meta_parts = []
    author = cover.get("author", "")
    date   = cover.get("date", "")
    desc   = cover.get("description", "")
    if author:
        meta_parts.append(xesc(author))
    if date:
        meta_parts.append(xesc(str(date)))
    for line in meta_parts:
        story.append(Paragraph(line, styles["cv_meta"]))
    if meta_parts:
        story.append(Spacer(1, sp(2, fs)))
    if desc:
        story.append(Paragraph(_md_to_html(xesc(desc)), styles["cv_meta"]))
        story.append(Spacer(1, sp(3, fs)))
    q_word  = "question"  if total_q  == 1 else "questions"
    ch_word = "chapter"   if ch_count == 1 else "chapters"
    story.append(Paragraph(
        f"{ch_count} {ch_word}  \u00b7  {total_q} {q_word}",
        styles["cv_meta"]
    ))
    story.append(Spacer(1, sp(6, fs)))
    features = cover.get("features", [
        "Hyperlinked Table of Contents",
        "Two-Column Textbook Layout  \u00b7  Premium Typography",
        "Answer Key with Full Explanations",
    ])
    for feat in features:
        story.append(Paragraph(xesc(feat), styles["cv_feature"]))
        story.append(Spacer(1, sp(1, fs)))
    story.append(Spacer(1, sp(9, fs)))
    story.append(HRule(fw, thickness=0.4, color=HexColor("#162E48"),
                       before=0, after=sp(2, fs)))
    footer_note = cover.get("footer_note", "Tap any TOC entry or question number to navigate.")
    story.append(Paragraph(xesc(footer_note), styles["cv_footer_txt"]))
    return story


# ─────────────────────────────────────────────────────────────
# § 10  TOC BUILDER
# ─────────────────────────────────────────────────────────────

def build_toc(cfg, styles, layout):
    fw     = layout["fw"]
    fs     = layout["fs"]
    story  = []
    story.append(Spacer(1, sp(4, fs)))
    story.append(Paragraph("Table of Contents", styles["toc_heading"]))
    story.append(DoubleRule(fw, color=GOLD, before=sp(1, fs), after=sp(3, fs)))
    for i, quiz in enumerate(cfg.get("quizzes", []), 1):
        ch_num  = i
        title   = quiz.get("title",       "Untitled Chapter")
        desc    = quiz.get("description", "")
        icon    = quiz.get("icon",        "")
        qc      = len(quiz.get("questions", []))
        q_word  = "Q" if qc == 1 else "Qs"
        anchor  = f"ch{ch_num}"
        story.append(Paragraph(
            f'<font color="#{_hx(GOLD)}">CH {ch_num:02d}</font>',
            styles["toc_ch_num"]
        ))
        icon_str  = f"{icon}\u2002" if icon else ""
        entry_lnk = (
            f'<a href="#{anchor}" color="#{_hx(LINK)}">'
            f'{icon_str}{xesc(title)}</a>'
        )
        entry_html = (
            f'<font name="{_F["H"]}">{entry_lnk}</font>'
            f'&nbsp;&nbsp;'
            f'<font color="#{_hx(MUTED)}">{qc} {q_word}</font>'
        )
        story.append(Paragraph(entry_html, styles["toc_entry"]))
        if desc:
            story.append(Paragraph(xesc(desc), styles["toc_desc"]))
        story.append(HRule(fw, thickness=0.3, color=RULE_GRAY,
                           before=sp(1, fs), after=sp(2, fs)))
    return story


# ─────────────────────────────────────────────────────────────
# § 11  CHAPTER HEADER
# ─────────────────────────────────────────────────────────────

def build_chapter_header(quiz, styles, layout, ch_num, is_single=False, content_w=400):
    fs     = layout["fs"]
    story  = []
    anchor = f"ch{ch_num}"
    story.append(Anchor(anchor))
    if is_single:
        icon = quiz.get("icon", "")
        if icon:
            story.append(Paragraph(
                icon,
                ParagraphStyle("_icon", fontSize=round(36*fs,1), alignment=TA_CENTER)
            ))
            story.append(Spacer(1, sp(2, fs)))
        story.append(Paragraph(
            xesc(quiz.get("title", "")),
            ParagraphStyle(
                "_sgl", fontName=_F["H"],
                fontSize=round(22*fs,1), leading=round(28*fs,1),
                textColor=CHARCOAL, alignment=TA_CENTER,
            )
        ))
        if quiz.get("description"):
            story.append(Paragraph(
                xesc(quiz["description"]),
                ParagraphStyle(
                    "_sgld", fontName=_F["Bi"],
                    fontSize=round(10*fs,1), leading=round(14*fs,1),
                    textColor=MUTED, alignment=TA_CENTER,
                )
            ))
        story.append(Spacer(1, sp(3, fs)))
    else:
        icon  = quiz.get("icon", "")
        title = quiz.get("title", "Untitled")
        sub   = quiz.get("description", "")
        story.append(Paragraph(
            f'CHAPTER\u2002{ch_num:02d}', styles["ch_label"]
        ))
        icon_str = f"{icon}\u2002" if icon else ""
        story.append(Paragraph(
            f"{icon_str}{xesc(title)}", styles["ch_title"]
        ))
        if sub:
            story.append(Paragraph(_md_to_html(xesc(sub)), styles["ch_desc"]))
        story.append(HRule(content_w, thickness=1.5, color=GOLD,
                           before=sp(1, fs), after=sp(3, fs)))
    return story


# ─────────────────────────────────────────────────────────────
# § 12  QUESTION FLOWABLES
# ─────────────────────────────────────────────────────────────

def build_question(q_data, q_num, styles, layout, answers_mode,
                   show_expl, content_w, style_mode="standard",
                   endbook_anchor=True, anchor_id=None):
    fs    = layout["fs"]
    elems = []
    aid        = anchor_id if anchor_id is not None else q_num
    q_anchor   = f"q{aid}"
    ans_anchor = f"a{aid}"
    elems.append(Anchor(q_anchor))

    if style_mode == "styled":
        elems.append(Paragraph(
            f'<font name="{_F["H"]}" color="#{_hx(GOLD)}" size="8">'
            f'Q U E S T I O N  {q_num}</font>',
            ParagraphStyle("_qbadge",
                fontName=_F["H"],
                fontSize=round(7.5 * fs, 1), leading=round(10 * fs, 1),
                textColor=GOLD, spaceBefore=sp(1, fs), spaceAfter=sp(1, fs),
            )
        ))
        elems.append(HRule(content_w, thickness=0.8, color=GOLD,
                           before=sp(1, fs), after=sp(2, fs)))
    else:
        elems.append(TrackedLabel(
            f"QUESTION {q_num}",
            font_size=round(10.5 * fs, 1), color=COBALT, tracking=0.9,
        ))
        elems.append(HRule(content_w, thickness=1.5, color=ROYAL,
                           before=sp(1, fs), after=sp(2, fs)))

    q_text = q_data.get("question", "")
    q_flowables = _build_flowables(q_text, styles["q_body"], content_w, fs)
    elems.extend(q_flowables)

    opts    = q_data.get("options", [])
    correct = q_data.get("correct", -1)
    show_inline_correct = (answers_mode == "inline")

    for i, opt in enumerate(opts):
        ltr = LETTERS[i] if i < len(LETTERS) else str(i + 1)
        is_correct = (i == correct)
        if style_mode == "styled":
            opt_color = EMERALD if (show_inline_correct and is_correct) else ROYAL
            opt_html = (
                f'<font name="{_F["H"]}" color="#{_hx(opt_color)}">'
                f'{ltr})</font>\u2002{_md_to_html(xesc(opt))}'
            )
            elems.append(Paragraph(opt_html, styles["q_option"]))
        elif show_inline_correct and is_correct:
            opt_html = (
                f'<font name="{_F["H"]}" color="#{_hx(EMERALD)}">'
                f'\u2713\u2002{ltr})</font>'
                f'\u2002{_md_to_html(xesc(opt))}'
            )
            elems.append(Paragraph(opt_html, styles["q_option_correct"]))
        else:
            opt_html = (
                f'<font name="{_F["H"]}" color="#{_hx(ROYAL)}">{ltr})</font>'
                f'\u2002{_md_to_html(xesc(opt))}'
            )
            elems.append(Paragraph(opt_html, styles["q_option"]))

    if answers_mode == "inline":
        expl = q_data.get("explanation", "")
        if show_expl and 0 <= correct < len(opts):
            elems.append(Spacer(1, sp(2, fs)))
            elems.append(_correct_badge(
                LETTERS[correct], opts[correct], content_w, fs
            ))
        if expl and show_expl:
            elems.append(Spacer(1, sp(1, fs)))
            elems.append(_callout_box(
                "EXPLANATION", expl, content_w,
                bg=PALE_GREEN, border_color=SAGE, fs=fs,
            ))
    elif answers_mode in ("endchapter", "endbook"):
        link_html = (
            f'<a href="#{ans_anchor}" color="#{_hx(LINK)}">'
            f'See Answer &amp; Explanation \u25ba</a>'
        )
        elems.append(Paragraph(link_html, styles["q_link"]))

    if style_mode == "styled":
        elems.append(HRule(content_w, thickness=0.5, color=GOLD,
                           before=sp(2, fs), after=sp(3, fs)))
    elif style_mode == "detailed":
        elems.append(HRule(content_w, thickness=0.6, color=RULE_GRAY,
                           before=sp(3, fs), after=sp(4, fs)))
    else:
        elems.append(HRule(content_w, thickness=0.4, color=RULE_GRAY,
                           before=sp(2, fs), after=sp(3, fs)))
    return elems


def build_written_question(q_data, q_num, styles, layout, content_w):
    fs    = layout["fs"]
    elems = []
    aid      = q_num
    q_anchor = f"q{aid}"
    elems.append(Anchor(q_anchor))
    elems.append(TrackedLabel(
        f"QUESTION {q_num}",
        font_size=round(10.5 * fs, 1), color=COBALT, tracking=0.9,
    ))
    elems.append(HRule(content_w, thickness=1.5, color=ROYAL,
                       before=sp(1, fs), after=sp(2, fs)))
    q_text = q_data.get("question", "")
    for fb in _build_flowables(q_text, styles["q_body"], content_w, fs):
        elems.append(fb)

    children = q_data.get("children", [])
    child_has_own_model = [
        bool(child.get("modelAnswer", "") or child.get("model_answer", ""))
        for child in children
    ]
    any_child_has_own = any(child_has_own_model)

    for idx, child in enumerate(children):
        if idx > 0:
            elems.append(Spacer(1, sp(0.5, fs)))
        c_label = child.get("label", "").rstrip(")")
        c_label_text = f"{c_label}." if c_label else f"{idx+1}."
        c_text = child.get("question", "")
        if c_text:
            esc_ = _md_to_html(xesc(c_text))
            combined = f'<font name="{_F["H"]}" color="#{_hx(COBALT)}">{c_label_text}</font>  {esc_}'
            elems.append(Paragraph(combined, styles["q_body"]))
        if child_has_own_model[idx]:
            c_model = child.get("modelAnswer", "") or child.get("model_answer", "")
            elems.append(Spacer(1, sp(0.5, fs)))
            elems.append(_callout_box(
                f"MODEL ANSWER \u2014 {c_label_text.strip()}",
                c_model, content_w,
                bg=PALE_BLUE, border_color=ROYAL, fs=fs,
            ))

    model_answer = q_data.get("modelAnswer", "") or q_data.get("model_answer", "")
    if model_answer and not any_child_has_own:
        elems.append(Spacer(1, sp(1, fs)))
        elems.append(_callout_box(
            "MODEL ANSWER", model_answer, content_w,
            bg=PALE_BLUE, border_color=ROYAL, fs=fs,
        ))

    elems.append(HRule(content_w, thickness=0.4, color=RULE_GRAY,
                       before=sp(2, fs), after=sp(3, fs)))
    return elems


def build_mcqnotes_question(q_data, q_num, styles, layout, show_expl, content_w):
    fs    = layout["fs"]
    elems = []
    opts    = q_data.get("options", [])
    correct = q_data.get("correct", -1)
    ans_letter = LETTERS[correct] if 0 <= correct < len(LETTERS) else "?"
    ans_text   = opts[correct] if 0 <= correct < len(opts) else ""
    for fb in _build_flowables(q_data.get("question", ""), styles["note_q"], content_w, fs):
        elems.append(fb)
    elems.append(Paragraph(
        f'\u2713\u2002<font name="{_F["H"]}">{ans_letter}.</font>\u2002{_md_to_html(xesc(ans_text))}',
        styles["note_ans"]
    ))
    expl = q_data.get("explanation", "")
    if expl and show_expl:
        elems.append(Paragraph(_md_to_html(xesc(expl)), styles["note_expl"]))
    elems.append(HRule(content_w, thickness=0.3, color=RULE_GRAY,
                       before=2, after=sp(2, fs)))
    return elems


# ─────────────────────────────────────────────────────────────
# § 13  ANSWER KEY FLOWABLES
# ─────────────────────────────────────────────────────────────

def build_answer_block(q_data, q_num, styles, layout, content_w, show_expl=True, anchor_id=None):
    fs    = layout["fs"]
    elems = []
    aid        = anchor_id if anchor_id is not None else q_num
    ans_anchor = f"a{aid}"
    q_anchor   = f"q{aid}"
    elems.append(Anchor(ans_anchor))
    elems.append(TrackedLabel(
        f"ANSWER {q_num}",
        font_size=round(10.5 * fs, 1), color=EMERALD, tracking=0.9,
    ))
    elems.append(HRule(content_w, thickness=1.5, color=SAGE,
                       before=sp(1, fs), after=sp(2, fs)))
    preview_text = _preview(q_data.get("question", ""), 18)
    elems.append(Paragraph(
        f'\u201c{_md_to_html(xesc(preview_text))}\u201d', styles["a_preview"]
    ))
    opts    = q_data.get("options", [])
    correct = q_data.get("correct", -1)
    if 0 <= correct < len(opts):
        ltr = LETTERS[correct]
        elems.append(_correct_badge(ltr, opts[correct], content_w, fs))
        elems.append(Spacer(1, sp(3, fs)))
    expl = q_data.get("explanation", "")
    if expl and show_expl:
        for fb in _build_flowables(expl, styles["a_expl"], content_w, fs):
            elems.append(fb)
    back_html = (
        f'<a href="#{q_anchor}" color="#{_hx(LINK)}">'
        f'\u25c4 Back to Question {q_num}</a>'
    )
    elems.append(Paragraph(back_html, styles["a_back_lnk"]))
    elems.append(HRule(content_w, thickness=0.4, color=MINT_RULE,
                       before=sp(2, fs), after=sp(3, fs)))
    return elems


def build_answer_key_section(answers_data, styles, layout, content_w,
                              section_title="ANSWER KEY", show_expl=True):
    fs    = layout["fs"]
    story = []
    story.append(SectionBanner(
        section_title,
        bg=EMERALD, accent=GOLD, height=max(36, int(52 * layout["scale"])),
    ))
    story.append(Spacer(1, sp(2, fs)))
    story.append(Paragraph("Quick Reference", styles["a_qref_title"]))
    parts = []
    for entry in answers_data:
        q_num = entry[0]
        q_data = entry[1]
        anchor_id = entry[2] if len(entry) > 2 else q_num
        correct = q_data.get("correct", -1)
        if 0 <= correct < len(LETTERS):
            ltr = LETTERS[correct]
            parts.append(
                f'<a href="#a{anchor_id}" color="#{_hx(LINK)}">Q{q_num}={ltr}</a>'
            )
    story.append(Paragraph(
        "\u2002\u00b7\u2002".join(parts), styles["a_qref"]
    ))
    story.append(HRule(content_w, thickness=0.4, color=MINT_RULE,
                       before=sp(1, fs), after=sp(2, fs)))
    for entry in answers_data:
        q_num = entry[0]
        q_data = entry[1]
        anchor_id = entry[2] if len(entry) > 2 else q_num
        for elem in build_answer_block(q_data, q_num, styles, layout,
                                        content_w, show_expl=show_expl,
                                        anchor_id=anchor_id):
            story.append(elem)
    return story


# ─────────────────────────────────────────────────────────────
# § 14  DOCUMENT TEMPLATE
# ─────────────────────────────────────────────────────────────

class QuizDocTemplate(BaseDocTemplate):
    def __init__(self, *args, **kwargs):
        self._header_title = kwargs.pop("doc_title", "")
        self._band_h       = kwargs.pop("band_h", 28)
        BaseDocTemplate.__init__(self, *args, **kwargs)


def _make_templates(layout, layout_mode, doc):
    pw, ph = layout["pw"], layout["ph"]
    ms     = layout["ms"]
    mt     = layout["mt"]
    mb     = layout["mb"]
    gu     = layout["gu"]
    cw     = layout["cw"]
    fw     = layout["fw"]
    bh     = layout["bh"]

    cover_f = Frame(ms, mb, fw, ph - mt - mb, id="cover",
                    leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    toc_f   = Frame(ms, mb, fw, ph - mt - mb, id="toc")
    main_f  = Frame(ms, mb, fw, ph - mt - mb, id="main")
    left_f  = Frame(ms,          mb, cw, ph - mt - mb, id="L",
                    leftPadding=0, rightPadding=sp(2))
    right_f = Frame(ms + cw + gu, mb, cw, ph - mt - mb, id="R",
                    leftPadding=sp(2), rightPadding=0)

    is_2col = (layout_mode == "twocol")
    q_frames  = [left_f, right_f] if is_2col else [main_f]
    a_frames  = [left_f, right_f] if is_2col else [main_f]

    templates = [
        PageTemplate(id="cover",     frames=[cover_f],  onPage=draw_cover_page),
        PageTemplate(id="toc",       frames=[toc_f],    onPage=draw_toc_page),
        PageTemplate(id="questions", frames=q_frames,   onPage=draw_questions_page),
        PageTemplate(id="answers",   frames=a_frames,   onPage=draw_answers_page),
    ]
    return templates


# ─────────────────────────────────────────────────────────────
# § 15  MAIN PDF GENERATOR
# ─────────────────────────────────────────────────────────────

def generate_pdf_bytes(config_dict, font_dir=None):
    """Generate a premium PDF from a config dict.
    
    Args:
        config_dict: Dict with keys: cover, toc, style, quizzes
        font_dir: Optional path to directory with TTF font files
    
    Returns:
        bytes: The generated PDF content
    """
    register_fonts(font_dir)

    style_cfg  = config_dict.get("style", {})
    cover_cfg  = config_dict.get("cover", {})
    toc_cfg    = config_dict.get("toc",   {})

    ps_name    = style_cfg.get("pageSize",        "a4").lower()
    page_size  = PAGE_SIZES.get(ps_name, A4)
    if style_cfg.get("orientation") == "landscape":
        page_size = landscape(page_size)

    style_mode    = style_cfg.get("mode",           "standard")
    layout_mode   = style_cfg.get("layout",         "twocol")
    numbering     = style_cfg.get("numbering",      "global")
    answers_mode  = style_cfg.get("answers",        "endbook")
    show_expl     = style_cfg.get("showExplanations", True)
    is_compact    = (style_mode == "compact")
    is_mcqnotes   = (style_mode == "mcqnotes")
    is_detailed   = (style_mode == "detailed")

    include_cover = cover_cfg.get("include", True)
    include_toc   = toc_cfg.get("include",   True)

    quizzes       = config_dict.get("quizzes", [])
    multi_chapter = len(quizzes) > 1

    title         = cover_cfg.get("title", "Quiz Compilation")

    layout   = page_layout(page_size, compact=is_compact)
    if is_detailed:
        layout = dict(layout, fs=layout["fs"] * 1.15)
    styles   = make_styles(fs=layout["fs"])
    content_w = layout["cw"] if layout_mode == "twocol" else layout["fw"]

    buf = io.BytesIO()
    doc = QuizDocTemplate(
        buf,
        pagesize  = page_size,
        doc_title = title,
        band_h    = layout["bh"],
        leftMargin   = layout["ms"],
        rightMargin  = layout["ms"],
        topMargin    = layout["mt"],
        bottomMargin = layout["mb"],
        title    = title,
        author   = cover_cfg.get("author", "QuizTool"),
        subject  = cover_cfg.get("subtitle", "Quiz PDF"),
    )
    doc._header_title = title[:55]

    doc.addPageTemplates(_make_templates(layout, layout_mode, doc))

    story        = []
    global_qnum  = [0]
    all_answers  = []

    if include_cover:
        story.append(NextPageTemplate("cover"))
        story.extend(build_cover(config_dict, styles, layout))
        story.append(NextPageTemplate("toc" if (include_toc and multi_chapter) else "questions"))
        story.append(PageBreak())

    if include_toc and multi_chapter:
        story.extend(build_toc(config_dict, styles, layout))
        story.append(NextPageTemplate("questions"))
        story.append(PageBreak())
    elif not include_cover:
        story.append(NextPageTemplate("questions"))

    for ci, quiz in enumerate(quizzes):
        ch_num       = ci + 1
        is_first     = (ci == 0)
        chapter_ans  = []

        if not is_first:
            story.append(PageBreak())

        story.extend(
            build_chapter_header(
                quiz, styles, layout, ch_num,
                is_single=(not multi_chapter),
                content_w=content_w,
            )
        )

        ch_questions = quiz.get("questions", [])
        is_written   = quiz.get("type", "") == "written"
        ch_qnum = 0
        for q_data in ch_questions:
            global_qnum[0] += 1
            ch_qnum += 1
            qnum = ch_qnum if numbering == "perchapter" else global_qnum[0]
            anchor_id = global_qnum[0]

            if is_written:
                story.extend(build_written_question(
                    q_data, qnum, styles, layout, content_w
                ))
            elif is_mcqnotes:
                elems = build_mcqnotes_question(
                    q_data, qnum, styles, layout, show_expl, content_w
                )
                story.append(KeepTogether(elems))
            else:
                elems = build_question(
                    q_data, qnum, styles, layout,
                    answers_mode, show_expl, content_w,
                    style_mode=style_mode,
                    anchor_id=anchor_id,
                )
                story.append(KeepTogether(elems))

            if answers_mode in ("endchapter", "endbook") and not is_written:
                chapter_ans.append((qnum, q_data, anchor_id))
                all_answers.append((qnum, q_data, anchor_id))

        if answers_mode == "endchapter" and chapter_ans:
            story.append(NextPageTemplate("answers"))
            story.append(PageBreak())
            story.extend(
                build_answer_key_section(
                    chapter_ans, styles, layout, content_w,
                    section_title=f"CHAPTER {ch_num} \u2014 ANSWER KEY",
                    show_expl=show_expl,
                )
            )
            story.append(NextPageTemplate("questions"))

    if answers_mode == "endbook" and all_answers:
        story.append(NextPageTemplate("answers"))
        story.append(PageBreak())
        story.extend(
            build_answer_key_section(
                all_answers, styles, layout, content_w,
                section_title="COMPLETE ANSWER KEY",
                show_expl=show_expl,
            )
        )

    doc.build(story)
    pdf_bytes = buf.getvalue()
    buf.close()
    return pdf_bytes
