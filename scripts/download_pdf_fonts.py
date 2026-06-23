"""Download Poppins + Lora fonts for the PDF generator.

Run this once to download premium fonts into scripts/fonts/.
The PDF generator automatically falls back to built-in PDF fonts
if these aren't found.
"""
import os, urllib.request

FONTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
os.makedirs(FONTS_DIR, exist_ok=True)

GF = "https://raw.githubusercontent.com/google/fonts/main/ofl"


def _dl(url, dest):
    dest = os.path.join(FONTS_DIR, dest)
    if os.path.exists(dest):
        print(f"  EXISTS {dest}")
        return True
    try:
        print(f"  DOWNLOAD {dest} ...", end=" ")
        urllib.request.urlretrieve(url, dest)
        print("OK")
        return True
    except Exception as e:
        print(f"FAILED: {e}")
        return False


print("=== Poppins ===")
for f in [
    "Poppins-Regular.ttf",
    "Poppins-Bold.ttf",
    "Poppins-Italic.ttf",
    "Poppins-BoldItalic.ttf",
    "Poppins-Medium.ttf",
    "Poppins-Light.ttf",
    "Poppins-LightItalic.ttf",
]:
    _dl(f"{GF}/poppins/{f}", f)

print("\n=== Lora (variable) ===")
_dl(f"{GF}/lora/Lora%5Bwght%5D.ttf", "Lora[wght].ttf")
_dl(f"{GF}/lora/Lora-Italic%5Bwght%5D.ttf", "Lora-Italic[wght].ttf")

print(f"\nDone. {len(os.listdir(FONTS_DIR))} font files in {FONTS_DIR}")
