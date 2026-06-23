#!/usr/bin/env python3
"""
QuizTool PDF Generator — Premium Impeccable-Grade Design.

Design principles:
  · No side-stripe borders (ABSOLUTE BAN) — full hairline outline or bg tint only
  · ALL-CAPS labels with charSpace tracking (0.8–1.2pt)
  · Type hierarchy ≥1.25× ratio per step:
      caption 7 / label 8 / body 9.5 / subhead 11 / heading 13.5 / display 16+
  · 4pt spacing grid: 4 | 8 | 12 | 16 | 24 | 36 | 48
  · Vertical rhythm: body leading 9.5pt × 1.47 ≈ 14pt base unit
  · Color 60/30/10: navy dominates, cobalt/emerald carry structure, gold is the 10% accent
  · Cover: dominant committed dark strategy, extreme scale contrast, decisive geometry
  · Frame-based two-column layout (never Table-hack two-column)
  · Hyperlinked TOC with PDF bookmark anchors
  · Page-size-aware margin and font scaling

Typography:
  Poppins (headings / labels) + Lora variable (body text) + LiberationMono (code / numbers)

Usage:
    python pdf_generator.py <config.json> <output.pdf>
"""

import json, sys, os, re
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


# ═══════════════════════════════════════════════════════════════
# § 1  FONTS
# ═══════════════════════════════════════════════════════════════

_GF  = "/usr/share/fonts/truetype/google-fonts"
_LIB = "/usr/share/fonts/truetype/liberation"

# Mutable font-name registry; updated by register_fonts()
_F = {
    "H":   "Helvetica-Bold",     # heading bold
    "Hn":  "Helvetica",          # heading normal
    "Hl":  "Helvetica",          # heading light
    "Hli": "Helvetica-Oblique",  # heading light-italic
    "Hm":  "Helvetica",          # heading medium
    "B":   "Times-Roman",        # body normal
    "Bb":  "Times-Bold",         # body bold
    "Bi":  "Times-Italic",       # body italic
    "Bbi": "Times-BoldItalic",   # body bold-italic
    "M":   "Courier",            # mono normal
    "Mb":  "Courier-Bold",       # mono bold
}


def register_fonts():
    """Register Poppins + Lora + LiberationMono with graceful fallback to built-ins.
    
    Search order:
      1. Local fonts/ directory next to this script (for bundled fonts)
      2. C:\\Windows\\Fonts (Windows system fonts)
      3. /usr/share/fonts/truetype/... (Linux paths)
    """
    _SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
    _FONTS_DIR  = os.path.join(_SCRIPT_DIR, "fonts")
    _WF         = "C:\\Windows\\Fonts"

    def _resolve(fname):
        """Find the first existing path for a font filename across search dirs."""
        for d in [_FONTS_DIR, _WF, _GF, _LIB]:
            p = os.path.join(d, fname)
            if os.path.exists(p):
                return p
            # Also try lowercase (Windows is case-insensitive but just in case)
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
        ("Lora",                "Lora-Variable.ttf"),      # fallback filename
        ("Lora-Italic",         "Lora-Italic[wght].ttf"),
        ("Lora-Italic",         "Lora-Italic-Variable.ttf"),  # fallback filename
        ("LoraB",               "LiberationSerif-Bold.ttf"),
        ("LoraBI",              "LiberationSerif-BoldItalic.ttf"),
        ("Mono",                "LiberationMono-Regular.ttf"),
        ("Mono-Bold",           "LiberationMono-Bold.ttf"),
    ]
    ok = set()
    registered = set()
    for name, fname in candidates:
        if name in registered:
            continue  # skip fallback filename if primary was already registered
        path = _resolve(fname)
        if path:
            try:
                pdfmetrics.registerFont(TTFont(name, path))
                ok.add(name)
                registered.add(name)
            except Exception as e:
                print(f"[WARN] Font not loaded — {name}: {e}", file=sys.stderr)

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


# ═══════════════════════════════════════════════════════════════
# § 2  COLOR PALETTE  ─  60 / 30 / 10 strategy
# ═══════════════════════════════════════════════════════════════

NAVY       = HexColor("#0B1E33")   # primary dark surface / cover bg
COBALT     = HexColor("#1A3A5C")   # section headers / questions band
ROYAL      = HexColor("#1E5FA8")   # option letters / question rule color
PALE_BLUE  = HexColor("#EBF3FA")   # callout bg (questions)

GOLD       = HexColor("#C9920A")   # primary accent — the 10%
GOLD_MID   = HexColor("#E8A912")   # lighter gold for secondary marks

EMERALD    = HexColor("#0A5C36")   # answer sections
SAGE       = HexColor("#18855A")   # answer rules
PALE_GREEN = HexColor("#E6F5ED")   # callout bg (answers)
MINT_RULE  = HexColor("#A8D8BC")   # answer section separators

CHARCOAL   = HexColor("#1A1A2E")   # primary body text
SLATE      = HexColor("#3A4554")   # secondary text / options
MUTED      = HexColor("#6B7A8D")   # captions / previews
RULE_GRAY  = HexColor("#D0D8E4")   # body rules
PALE_GRAY  = HexColor("#F4F6F9")   # very subtle fills

LINK       = HexColor("#1565C0")   # PDF hyperlinks


def _hx(c):
    """6-char lowercase hex for use in Paragraph HTML tags."""
    return f"{int(c.red*255):02x}{int(c.green*255):02x}{int(c.blue*255):02x}"


# ═══════════════════════════════════════════════════════════════
# § 3  SPACING GRID  —  4pt base
# ═══════════════════════════════════════════════════════════════

def sp(n, scale=1.0):
    """4pt grid unit. sp(3) = 12pt.  sp(3, 0.88) = 10.6pt for compact mode."""
    return round(n * 4 * scale, 1)


# ═══════════════════════════════════════════════════════════════
# § 4  PAGE SIZES + LAYOUT CALCULATOR
# ═══════════════════════════════════════════════════════════════

PAGE_SIZES = {
    "a3": A3, "a4": A4, "a5": A5,
    "letter": LETTER, "legal": LEGAL, "tabloid": TABLOID,
}


def page_layout(page_size, compact=False):
    """
    Return a dict of all layout constants derived from page dimensions.
    All values are in ReportLab points (1pt = 1/72 inch).

    Margins, gutter, and font sizes scale relative to A4 width (595pt).
    compact=True reduces font scale by 12%.
    """
    pw, ph  = page_size
    scale   = pw / 595.0          # 1.0 for A4, 0.71 for A5, 1.41 for A3

    ms      = max(18, int(round(28  * scale)))   # side margin
    mt      = max(38, int(round(52  * scale)))   # top margin  (≥ header band + clearance)
    mb      = max(22, int(round(36  * scale)))   # bottom margin
    gu      = max(8,  int(round(16  * scale)))   # inter-column gutter
    bh      = max(20, int(round(28  * scale)))   # header band height

    cw      = (pw - 2 * ms - gu) / 2            # single-column width in 2-col layout
    fw      = pw - 2 * ms                        # full content width (1-col)

    fs      = max(0.80, min(1.22, scale))        # font scale factor
    if compact:
        fs *= 0.88

    return dict(pw=pw, ph=ph, ms=ms, mt=mt, mb=mb,
                gu=gu, bh=bh, cw=cw, fw=fw, fs=fs, scale=scale)


# ═══════════════════════════════════════════════════════════════
# § 5  CUSTOM FLOWABLES
# ═══════════════════════════════════════════════════════════════

class HRule(Flowable):
    """Horizontal rule on the 4pt grid."""
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
    """Thick + thin double-rule ornament — classic textbook device."""
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
    """Zero-size PDF anchor — bookmark destination for hyperlinks."""
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
    """
    ALL-CAPS label with proper charSpace letter-spacing.
    Impeccable rule: ALL-CAPS needs 0.05–0.12em tracking.
    At 10pt that is 0.5–1.2pt; we use 0.9pt.
    """
    def __init__(self, text, font_name=None, font_size=10,
                 color=COBALT, tracking=0.9):
        super().__init__()
        self.text      = text
        self.font_name = font_name  # resolved lazily from _F if None
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
    """
    Full-width section opener with TOP accent strip.
    Impeccable fix: top accent strip (never a left side-stripe — that's banned).
    """
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
        # Main band
        c.setFillColor(self.bg)
        c.rect(0, 0, w, h - 4, fill=1, stroke=0)
        # TOP accent strip (not side-stripe — impeccable compliant)
        c.setFillColor(self.accent)
        c.rect(0, h - 4, w, 4, fill=1, stroke=0)
        # Bottom separator hairline
        c.setStrokeColor(self.accent)
        c.setLineWidth(0.8)
        c.line(0, 0, w, 0)
        # Text — use beginText for charSpace tracking
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


# ═══════════════════════════════════════════════════════════════
# § 6  HELPERS
# ═══════════════════════════════════════════════════════════════

LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def xesc(text):
    """XML-escape text and convert newlines to <br/>."""
    if not text:
        return ""
    return (str(text)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\n", "<br/>")
            .strip())


def _preview(text, n=22):
    """Return first n words of text with ellipsis."""
    words = str(text).split()
    return (" ".join(words[:n]) + "\u2026") if len(words) > n else text


def _md_to_html(text):
    """Convert inline markdown (**bold**, *italic*, ~~strikethrough~~) to HTML tags.
    Call AFTER xesc() since asterisks/tildes aren't HTML-special characters."""
    if not text:
        return text
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)', r'<i>\1</i>', text)
    text = re.sub(r'~~(.+?)~~', r'<strike>\1</strike>', text)
    return text


def _detect_pipe_table(lines, start):
    """Check if lines[start] starts a pipe table. Returns end index or -1."""
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
    """Split a pipe-table row into trimmed cell values."""
    parts = row.split('|')
    if parts and parts[0].strip() == '':
        parts = parts[1:]
    if parts and parts[-1].strip() == '':
        parts = parts[:-1]
    return [p.strip() for p in parts]


def _build_table_flowable(table_lines, content_w, fs=1.0):
    """Convert pipe-table lines into a ReportLab Table flowable."""
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
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph as RlParagraph

    cell_style = ParagraphStyle(
        '_tc', fontName=_F["Hn"],
        fontSize=round(8 * fs, 1), leading=round(11 * fs, 1),
        textColor=SLATE,
    )
    head_style = ParagraphStyle(
        '_th', fontName=_F["H"],
        fontSize=round(8 * fs, 1), leading=round(11 * fs, 1),
        textColor=COBALT,
    )

    styled = []
    for ri, row in enumerate(data):
        sty = head_style if ri == 0 else cell_style
        styled.append([RlParagraph(_md_to_html(xesc(c)), sty) for c in row])

    from reportlab.lib.colors import HexColor, white as rl_white
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
    # Alternate row shading
    for ri in range(1, len(styled)):
        if ri % 2 == 0:
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, ri), (-1, ri), PALE_GRAY),
            ]))
    return t


def _build_flowables(text, style, content_w, fs=1.0):
    """Convert text (with markdown + pipe tables) into a list of ReportLab flowables."""
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
    """
    Green correct-answer badge.
    IMPECCABLE: full-perimeter background — no side stripe.
    """
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
    """
    Explanation / objective callout box.
    Single Table, one continuous OUTLINE — exactly as originally designed.
    Body text is split via _build_flowables so pipe tables render.
    """
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


# ═══════════════════════════════════════════════════════════════
# § 7  PARAGRAPH STYLES
# ═══════════════════════════════════════════════════════════════
# Type scale (≥1.25× ratio between each step):
#   caption   7.0pt  (0.74×)
#   label     8.0pt  (0.84×)
#   body      9.5pt  (1.00×)  ← rhythm base
#   subhead  11.0pt  (1.16×)
#   heading  13.5pt  (1.42×)
#   display  17pt+
# Body leading: 9.5 × 1.47 ≈ 14pt  →  grid base = 14pt
# ═══════════════════════════════════════════════════════════════

def make_styles(fs=1.0):
    """Build all paragraph styles. fs = font-scale factor (1.0 for A4 standard)."""
    s = {}
    f = fs   # shorthand

    # ── Cover ──────────────────────────────────────────────────
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

    # ── TOC ────────────────────────────────────────────────────
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

    # ── Questions ──────────────────────────────────────────────
    # body = 9.5pt Lora justified, leading 14pt (1.47×)
    s["q_body"] = ParagraphStyle(
        "q_body", fontName=_F["B"],
        fontSize=round(9.5*f,1), leading=round(14*f,1),
        textColor=CHARCOAL, alignment=TA_JUSTIFY,
        spaceBefore=sp(2), spaceAfter=round(14*f,1),
    )
    # option: 9pt, 16pt indent on 4pt grid
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

    # ── MCQ Notes (ultra-compact) ──────────────────────────────
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

    # ── Answers (end-chapter / end-book) ───────────────────────
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

    # ── Chapter header ─────────────────────────────────────────
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


# ═══════════════════════════════════════════════════════════════
# § 8  PAGE BACKGROUND DRAWING FUNCTIONS
# ═══════════════════════════════════════════════════════════════

def draw_cover_page(canvas, doc):
    """Full-page navy cover with diagonal geometry and gold accents."""
    canvas.saveState()
    pw, ph = doc.pagesize

    # ── Full NAVY background ──────────────────────────────────
    canvas.setFillColor(NAVY)
    canvas.rect(0, 0, pw, ph, fill=1, stroke=0)

    # ── Upper cobalt block (top 26% of page) ─────────────────
    canvas.setFillColor(HexColor("#0D2744"))
    canvas.rect(0, ph * 0.74, pw, ph * 0.26, fill=1, stroke=0)

    # ── Diagonal band 1 — sweeping across upper zone ──────────
    canvas.setFillColor(HexColor("#0F3060"))
    p = canvas.beginPath()
    p.moveTo(0,          ph * 0.87)
    p.lineTo(pw * 0.62,  ph * 0.87)
    p.lineTo(pw * 0.46,  ph)
    p.lineTo(0,          ph)
    p.close()
    canvas.drawPath(p, fill=1, stroke=0)

    # ── Diagonal band 2 — thinner wedge, right side ───────────
    canvas.setFillColor(HexColor("#132D50"))
    p2 = canvas.beginPath()
    p2.moveTo(pw * 0.70, ph)
    p2.lineTo(pw,        ph)
    p2.lineTo(pw,        ph * 0.74)
    p2.lineTo(pw * 0.85, ph * 0.74)
    p2.close()
    canvas.drawPath(p2, fill=1, stroke=0)

    # ── GOLD top-edge accent bar ──────────────────────────────
    canvas.setFillColor(GOLD)
    canvas.rect(0, ph - 5, pw, 5, fill=1, stroke=0)

    # ── Thin gold separator below cobalt block ────────────────
    canvas.setStrokeColor(GOLD)
    canvas.setLineWidth(0.8)
    canvas.line(pw * 0.06, ph * 0.74 - 2, pw * 0.94, ph * 0.74 - 2)

    # ── Right-side vertical accent pillar ─────────────────────
    canvas.setFillColor(HexColor("#14304E"))
    canvas.rect(pw * 0.965, 0, pw * 0.035, ph, fill=1, stroke=0)
    # Gold chip at golden-ratio height
    canvas.setFillColor(GOLD)
    canvas.rect(pw * 0.965, ph * 0.382, pw * 0.009, ph * 0.236, fill=1, stroke=0)

    # ── Bottom footer band (bottom 9% of page) ────────────────
    canvas.setFillColor(HexColor("#060E18"))
    canvas.rect(0, 0, pw, ph * 0.09, fill=1, stroke=0)
    canvas.setFillColor(GOLD)
    canvas.rect(0, ph * 0.09, pw, 2, fill=1, stroke=0)

    # ── Subtle vertical grid in footer ────────────────────────
    canvas.setStrokeColor(HexColor("#18304A"))
    canvas.setLineWidth(0.35)
    grid_step = max(20, int(pw / 28))
    for x in range(0, int(pw * 0.96), grid_step):
        canvas.line(x, 0, x, ph * 0.089)
    canvas.line(0, ph * 0.035, pw * 0.96, ph * 0.035)
    canvas.line(0, ph * 0.065, pw * 0.96, ph * 0.065)

    # ── Content well subtle rounded border ────────────────────
    canvas.setStrokeColor(HexColor("#1C3D60"))
    canvas.setLineWidth(0.6)
    canvas.roundRect(pw * 0.05, ph * 0.10,
                     pw * 0.87, ph * 0.58,
                     3, fill=0, stroke=1)

    # ── Three decorative circles — top-left of content well ───
    for i, shade in enumerate(["#0E2E50", "#163A64", "#1E4878"]):
        canvas.setFillColor(HexColor(shade))
        canvas.circle(pw * 0.10 + i * (13 * pw / 595),
                      ph * 0.70,
                      (5 - i * 0.5) * (pw / 595),
                      fill=1, stroke=0)

    canvas.restoreState()


def _draw_header_band(canvas, doc, bg_color, section_label, label_fg):
    """
    Shared header/footer drawing for all content pages.
    Header: bg_color band + GOLD top strip + title left + section label right
    Footer: page number centered
    """
    canvas.saveState()
    pw, ph = doc.pagesize
    lm     = doc.leftMargin
    rm     = doc.rightMargin
    bh     = getattr(doc, "_band_h", 28)

    # ── Header band ───────────────────────────────────────────
    canvas.setFillColor(bg_color)
    canvas.rect(0, ph - bh, pw, bh, fill=1, stroke=0)

    # ── GOLD top strip ────────────────────────────────────────
    canvas.setFillColor(GOLD)
    canvas.rect(0, ph - 5, pw, 5, fill=1, stroke=0)

    # ── Doc title — left, white ───────────────────────────────
    title = getattr(doc, "_header_title", "")[:55]
    y_txt = ph - bh + (bh - 8) * 0.4
    canvas.setFillColor(white)
    canvas.setFont(_F["H"], 7.5)
    canvas.drawString(lm, y_txt, title)

    # ── Section label — right, letter-spaced ──────────────────
    if section_label:
        lbl_w = canvas.stringWidth(section_label, _F["Hl"], 7)
        t = canvas.beginText(pw - rm - lbl_w, y_txt)
        t.setFont(_F["Hl"], 7)
        t.setFillColor(label_fg)
        t.setCharSpace(0.7)
        t.textLine(section_label)
        canvas.drawText(t)

    # ── Footer: page number ───────────────────────────────────
    canvas.setFont(_F["Hl"], 7)
    canvas.setFillColor(MUTED)
    canvas.drawCentredString(pw / 2, 14, f"\u2014\u2002{doc.page}\u2002\u2014")

    # ── Footer rule ───────────────────────────────────────────
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


# ═══════════════════════════════════════════════════════════════
# § 9  COVER PAGE BUILDER
# ═══════════════════════════════════════════════════════════════

def build_cover(cfg, styles, layout):
    """Build the cover page story elements (placed in single-frame cover template)."""
    fw     = layout["fw"]
    fs     = layout["fs"]
    story  = []
    cover  = cfg.get("cover", {})
    quizzes = cfg.get("quizzes", [])
    total_q = sum(len(q.get("questions", [])) for q in quizzes)
    ch_count = len(quizzes)

    story.append(Spacer(1, sp(16, fs)))

    # Eyebrow — letter-spaced via Paragraph HTML
    eyebrow_text = cover.get("eyebrow", "Q U I Z &nbsp; C O M P I L A T I O N")
    story.append(Paragraph(eyebrow_text, styles["cv_eyebrow"]))
    story.append(Spacer(1, sp(3, fs)))

    # Hero title — 44pt Poppins-Bold (extreme scale)
    title = cover.get("title", "Quiz Compilation")
    story.append(Paragraph(xesc(title), styles["cv_title"]))

    # Subtitle
    subtitle = cover.get("subtitle", "")
    if subtitle:
        story.append(Paragraph(xesc(subtitle), styles["cv_subtitle"]))
    story.append(Spacer(1, sp(1, fs)))

    # Double-rule ornament (thick + thin gold)
    story.append(DoubleRule(fw, color=GOLD, before=sp(2, fs), after=sp(2, fs)))
    story.append(Spacer(1, sp(4, fs)))

    # Metadata block — Poppins-Light (weight contrast vs Bold title)
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

    # Stats
    q_word  = "question"  if total_q  == 1 else "questions"
    ch_word = "chapter"   if ch_count == 1 else "chapters"
    story.append(Paragraph(
        f"{ch_count} {ch_word}  \u00b7  {total_q} {q_word}",
        styles["cv_meta"]
    ))
    story.append(Spacer(1, sp(6, fs)))

    # Feature lines
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


# ═══════════════════════════════════════════════════════════════
# § 10  TOC BUILDER  —  with PDF hyperlinks
# ═══════════════════════════════════════════════════════════════

def build_toc(cfg, styles, layout):
    """
    Build the Table of Contents story elements.
    Each entry links to the chapter's PDF bookmark anchor (ch1, ch2, …).
    """
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

        # Chapter number label
        story.append(Paragraph(
            f'<font color="#{_hx(GOLD)}">CH {ch_num:02d}</font>',
            styles["toc_ch_num"]
        ))

        # Linked entry with dot leader
        icon_str  = f"{icon}\u2002" if icon else ""
        entry_lnk = (
            f'<a href="#{anchor}" color="#{_hx(LINK)}">'
            f'{icon_str}{xesc(title)}</a>'
        )
        # Right-aligned question count
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


# ═══════════════════════════════════════════════════════════════
# § 11  CHAPTER HEADER  —  with PDF anchor bookmark
# ═══════════════════════════════════════════════════════════════

def build_chapter_header(quiz, styles, layout, ch_num, is_single=False, content_w=400):
    """Build chapter-opening section header with anchor bookmark."""
    fs     = layout["fs"]
    story  = []

    anchor = f"ch{ch_num}"
    story.append(Anchor(anchor))

    if is_single:
        # Single-quiz mode: centered display
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
        # Multi-chapter mode: banner header
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


# ═══════════════════════════════════════════════════════════════
# § 12  QUESTION FLOWABLES
# ═══════════════════════════════════════════════════════════════

def build_question(q_data, q_num, styles, layout, answers_mode,
                   show_expl, content_w, style_mode="standard",
                   endbook_anchor=True, anchor_id=None):
    """
    Render a single question with options.
    answers_mode: 'inline' | 'endchapter' | 'endbook' | 'none'
    style_mode: 'standard' | 'styled' | 'detailed' | 'compact'
    endbook_anchor: if True, emit an anchor so the answer section can link back.
    anchor_id: globally unique ID for anchor bookmarks (prevents per-chapter collisions).
               Falls back to q_num if None.
    """
    fs    = layout["fs"]
    elems = []

    aid        = anchor_id if anchor_id is not None else q_num
    q_anchor   = f"q{aid}"
    ans_anchor = f"a{aid}"

    # Bookmark anchor (target for "Back to Question N" links)
    elems.append(Anchor(q_anchor))

    # Question header — styled vs standard
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
        # Gold hairline rule
        elems.append(HRule(content_w, thickness=0.8, color=GOLD,
                           before=sp(1, fs), after=sp(2, fs)))
    else:
        elems.append(TrackedLabel(
            f"QUESTION {q_num}",
            font_size=round(10.5 * fs, 1), color=COBALT, tracking=0.9,
        ))
        elems.append(HRule(content_w, thickness=1.5, color=ROYAL,
                           before=sp(1, fs), after=sp(2, fs)))

    # Question body — Lora justified, with markdown rendering (bold, italic, tables)
    q_text = q_data.get("question", "")
    q_flowables = _build_flowables(q_text, styles["q_body"], content_w, fs)
    elems.extend(q_flowables)

    # Options
    opts    = q_data.get("options", [])
    correct = q_data.get("correct", -1)
    show_inline_correct = (answers_mode == "inline")

    for i, opt in enumerate(opts):
        ltr = LETTERS[i] if i < len(LETTERS) else str(i + 1)
        is_correct = (i == correct)

        if style_mode == "styled":
            # Option letter badge style
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

    # Inline answer — badge only when explanation is also shown
    # (otherwise the green coloring on the correct option is sufficient)
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

    # Separator rule — styled gets gold hairline, standard/detailed get gray
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
    """Render a written/essay question with model answer, rubric, and explanation."""
    fs    = layout["fs"]
    elems = []

    aid      = q_num
    q_anchor = f"q{aid}"

    elems.append(Anchor(q_anchor))

    # Question header
    elems.append(TrackedLabel(
        f"QUESTION {q_num}",
        font_size=round(10.5 * fs, 1), color=COBALT, tracking=0.9,
    ))
    elems.append(HRule(content_w, thickness=1.5, color=ROYAL,
                       before=sp(1, fs), after=sp(2, fs)))

    # Question body with markdown
    q_text = q_data.get("question", "")
    for fb in _build_flowables(q_text, styles["q_body"], content_w, fs):
        elems.append(fb)

    # Child questions (rendered first when present)
    children = q_data.get("children", [])
    # Track whether each child supplies its own model answer. When at least one
    # child has its own, per-child MODEL ANSWER callouts are emitted inline and
    # the parent-level callout is suppressed (mirrors the runtime engine's
    # hasAllChildModelAnswers fallback semantics).
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
            esc = _md_to_html(xesc(c_text))
            combined = f'<font name="{_F["H"]}" color="#{_hx(COBALT)}">{c_label_text}</font>  {esc}'
            elems.append(Paragraph(combined, styles["q_body"]))
        else:
            combined = f'<font name="{_F["H"]}" color="#{_hx(COBALT)}">{c_label_text}</font>'
            elems.append(Paragraph(combined, styles["q_body"]))

        # Per-child MODEL ANSWER callout when this part has its own model answer
        if child_has_own_model[idx]:
            c_model = child.get("modelAnswer", "") or child.get("model_answer", "")
            elems.append(Spacer(1, sp(0.5, fs)))
            elems.append(_callout_box(
                f"MODEL ANSWER — {c_label_text.strip()}",
                c_model, content_w,
                bg=PALE_BLUE, border_color=ROYAL, fs=fs,
            ))

    # Parent-level MODEL ANSWER callout: emit only when no child supplied its
    # own (i.e. the parent answer is the shared fallback for all parts), or
    # when there are no children at all (standard written question).
    model_answer = q_data.get("modelAnswer", "") or q_data.get("model_answer", "")
    if model_answer and not any_child_has_own:
        elems.append(Spacer(1, sp(1, fs)))
        elems.append(_callout_box(
            "MODEL ANSWER", model_answer, content_w,
            bg=PALE_BLUE, border_color=ROYAL, fs=fs,
        ))

    # Separator
    elems.append(HRule(content_w, thickness=0.4, color=RULE_GRAY,
                       before=sp(2, fs), after=sp(3, fs)))

    return elems


def build_mcqnotes_question(q_data, q_num, styles, layout, show_expl, content_w):
    """Ultra-compact MCQ notes: question + ✓ answer + explanation on tight spacing."""
    fs    = layout["fs"]
    elems = []

    opts    = q_data.get("options", [])
    correct = q_data.get("correct", -1)
    ans_letter = LETTERS[correct] if 0 <= correct < len(LETTERS) else "?"
    ans_text   = opts[correct] if 0 <= correct < len(opts) else ""

    # Question with inline markdown rendering
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


# ═══════════════════════════════════════════════════════════════
# § 13  ANSWER KEY FLOWABLES
# ═══════════════════════════════════════════════════════════════

def build_answer_block(q_data, q_num, styles, layout, content_w, show_expl=True, anchor_id=None):
    """
    Render a single answer explanation block for the answer key section.
    Mirrors medmcq answer section: preview → correct badge → explanation → back link.
    show_expl: if False, explanation text is omitted.
    anchor_id: globally unique ID for anchor bookmarks.
    """
    fs    = layout["fs"]
    elems = []

    aid        = anchor_id if anchor_id is not None else q_num
    ans_anchor = f"a{aid}"
    q_anchor   = f"q{aid}"

    elems.append(Anchor(ans_anchor))

    # "ANSWER N" tracked label
    elems.append(TrackedLabel(
        f"ANSWER {q_num}",
        font_size=round(10.5 * fs, 1), color=EMERALD, tracking=0.9,
    ))

    # Sage rule
    elems.append(HRule(content_w, thickness=1.5, color=SAGE,
                       before=sp(1, fs), after=sp(2, fs)))

    # Question preview in 8pt Lora-Italic
    preview_text = _preview(q_data.get("question", ""), 18)
    elems.append(Paragraph(
        f'\u201c{_md_to_html(xesc(preview_text))}\u201d', styles["a_preview"]
    ))

    # Correct answer badge
    opts    = q_data.get("options", [])
    correct = q_data.get("correct", -1)
    if 0 <= correct < len(opts):
        ltr = LETTERS[correct]
        elems.append(_correct_badge(ltr, opts[correct], content_w, fs))
        elems.append(Spacer(1, sp(3, fs)))

    # Explanation — omitted when show_expl is False, with markdown rendering
    expl = q_data.get("explanation", "")
    if expl and show_expl:
        for fb in _build_flowables(expl, styles["a_expl"], content_w, fs):
            elems.append(fb)

    # Back link
    back_html = (
        f'<a href="#{q_anchor}" color="#{_hx(LINK)}">'
        f'\u25c4 Back to Question {q_num}</a>'
    )
    elems.append(Paragraph(back_html, styles["a_back_lnk"]))

    # Separator
    elems.append(HRule(content_w, thickness=0.4, color=MINT_RULE,
                       before=sp(2, fs), after=sp(3, fs)))

    return elems


def build_answer_key_section(answers_data, styles, layout, content_w,
                              section_title="ANSWER KEY", show_expl=True):
    """
    Build a complete answer key section (for endchapter or endbook).
    answers_data: list of (q_num, q_data, anchor_id) tuples.
    show_expl: if False, explanations are omitted from each answer block.
    """
    fs    = layout["fs"]
    story = []

    story.append(SectionBanner(
        section_title,
        bg=EMERALD, accent=GOLD, height=max(36, int(52 * layout["scale"])),
    ))
    story.append(Spacer(1, sp(2, fs)))

    # Quick-reference strip
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

    # Per-question answer blocks
    for entry in answers_data:
        q_num = entry[0]
        q_data = entry[1]
        anchor_id = entry[2] if len(entry) > 2 else q_num
        for elem in build_answer_block(q_data, q_num, styles, layout,
                                        content_w, show_expl=show_expl,
                                        anchor_id=anchor_id):
            story.append(elem)

    return story


# ═══════════════════════════════════════════════════════════════
# § 14  DOCUMENT TEMPLATE
# ═══════════════════════════════════════════════════════════════

class QuizDocTemplate(BaseDocTemplate):
    """BaseDocTemplate subclass that carries metadata for header drawing."""

    def __init__(self, *args, **kwargs):
        self._header_title = kwargs.pop("doc_title", "")
        self._band_h       = kwargs.pop("band_h", 28)
        BaseDocTemplate.__init__(self, *args, **kwargs)


def _make_templates(layout, layout_mode, doc):
    """Build and return all page templates for the document."""
    pw, ph = layout["pw"], layout["ph"]
    ms     = layout["ms"]
    mt     = layout["mt"]
    mb     = layout["mb"]
    gu     = layout["gu"]
    cw     = layout["cw"]
    fw     = layout["fw"]
    bh     = layout["bh"]

    # Frames
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


# ═══════════════════════════════════════════════════════════════
# § 15  MAIN PDF GENERATOR
# ═══════════════════════════════════════════════════════════════

def generate_pdf(config_path, output_path):
    """Read config JSON and build the premium PDF at output_path."""
    with open(config_path, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)

    register_fonts()

    # ── Config extraction ──────────────────────────────────────
    style_cfg  = cfg.get("style", {})
    cover_cfg  = cfg.get("cover", {})
    toc_cfg    = cfg.get("toc",   {})

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

    quizzes       = cfg.get("quizzes", [])
    multi_chapter = len(quizzes) > 1

    title         = cover_cfg.get("title", "Quiz Compilation")

    # ── Layout constants ──────────────────────────────────────
    # Detailed mode uses a 1.15× font scale multiplier
    layout   = page_layout(page_size, compact=is_compact)
    if is_detailed:
        layout = dict(layout, fs=layout["fs"] * 1.15)
    styles   = make_styles(fs=layout["fs"])
    content_w = layout["cw"] if layout_mode == "twocol" else layout["fw"]

    # ── Build document ────────────────────────────────────────
    doc = QuizDocTemplate(
        output_path,
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

    # ── Story ─────────────────────────────────────────────────
    story        = []
    global_qnum  = [0]
    all_answers  = []   # list of (q_num, q_data) for endbook answer key

    # ── COVER ─────────────────────────────────────────────────
    if include_cover:
        story.append(NextPageTemplate("cover"))
        story.extend(build_cover(cfg, styles, layout))
        story.append(NextPageTemplate("toc" if (include_toc and multi_chapter) else "questions"))
        story.append(PageBreak())

    # ── TOC ───────────────────────────────────────────────────
    if include_toc and multi_chapter:
        story.extend(build_toc(cfg, styles, layout))
        story.append(NextPageTemplate("questions"))
        story.append(PageBreak())
    elif not include_cover:
        story.append(NextPageTemplate("questions"))

    # ── CHAPTERS ──────────────────────────────────────────────
    for ci, quiz in enumerate(quizzes):
        ch_num       = ci + 1
        is_first     = (ci == 0)
        chapter_ans  = []   # for endchapter mode

        if not is_first:
            story.append(PageBreak())

        # Chapter header
        story.extend(
            build_chapter_header(
                quiz, styles, layout, ch_num,
                is_single=(not multi_chapter),
                content_w=content_w,
            )
        )

        # Questions — with reliable per-chapter numbering
        ch_questions = quiz.get("questions", [])
        is_written   = quiz.get("type", "") == "written"
        ch_qnum = 0
        for q_data in ch_questions:
            global_qnum[0] += 1
            ch_qnum += 1
            qnum = ch_qnum if numbering == "perchapter" else global_qnum[0]
            anchor_id = global_qnum[0]  # always globally unique for PDF bookmarks

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

        # End-of-chapter answer key
        if answers_mode == "endchapter" and chapter_ans:
            story.append(NextPageTemplate("answers"))
            story.append(PageBreak())
            story.extend(
                build_answer_key_section(
                    chapter_ans, styles, layout, content_w,
                    section_title=f"CHAPTER {ch_num} — ANSWER KEY",
                    show_expl=show_expl,
                )
            )
            story.append(NextPageTemplate("questions"))

    # ── END-OF-BOOK ANSWER KEY ────────────────────────────────
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

    # ── BUILD ─────────────────────────────────────────────────
    doc.build(story)
    print(f"[OK] PDF generated: {output_path}")
    return True


# ═══════════════════════════════════════════════════════════════
# § 16  CLI ENTRY POINT
# ═══════════════════════════════════════════════════════════════

def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <config.json> <output.pdf>", file=sys.stderr)
        sys.exit(1)

    config_path = sys.argv[1]
    output_path = sys.argv[2]

    if not os.path.exists(config_path):
        print(f"ERROR: Config file not found: {config_path}", file=sys.stderr)
        sys.exit(1)

    try:
        generate_pdf(config_path, output_path)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        import traceback
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
