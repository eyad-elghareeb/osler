"""QuizTool PDF Dependencies — first-run check & install.

Usage:
    python ensure_pdf_deps.py

Returns JSON on stdout:
    {"status": "ok"} | {"status": "installed", "detail": "..."} |
    {"status": "error", "detail": "..."}
"""

import json
import os
import subprocess
import sys
import shutil
import urllib.request


def check_python():
    """Check Python 3 is available and usable."""
    vi = sys.version_info
    if vi.major < 3 or (vi.major == 3 and vi.minor < 8):
        return {"status": "error", "detail": f"Python 3.8+ required, got {vi.major}.{vi.minor}.{vi.micro}"}
    return {"status": "ok", "detail": f"Python {vi.major}.{vi.minor}.{vi.micro}"}


def check_reportlab():
    """Check if reportlab is importable."""
    try:
        import reportlab
        ver = getattr(reportlab, "Version", "unknown")
        return {"status": "ok", "detail": f"reportlab {ver}"}
    except ImportError:
        return {"status": "missing", "detail": "reportlab not installed"}


def install_reportlab():
    """Install reportlab via pip."""
    python = sys.executable
    try:
        kwargs = {"capture_output": True, "text": True, "timeout": 120}
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        result = subprocess.run(
            [python, "-m", "pip", "install", "reportlab", "--quiet"], **kwargs
        )
        if result.returncode != 0:
            return {"status": "error", "detail": f"pip install failed: {result.stderr.strip()}"}
        return {"status": "installed", "detail": "reportlab installed successfully"}
    except subprocess.TimeoutExpired:
        return {"status": "error", "detail": "pip install timed out after 120s"}
    except FileNotFoundError:
        return {"status": "error", "detail": "pip not found"}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


def ensure_pip():
    """Ensure pip is available for the current Python."""
    python = sys.executable
    if shutil.which("pip"):
        return {"status": "ok", "detail": "pip available"}

    try:
        # Try python -m pip
        kwargs2 = {"capture_output": True, "text": True, "timeout": 30}
        if sys.platform == "win32":
            kwargs2["creationflags"] = subprocess.CREATE_NO_WINDOW
        r = subprocess.run([python, "-m", "pip", "--version"], **kwargs2)
        if r.returncode == 0:
            return {"status": "ok", "detail": "pip available via python -m pip"}
    except Exception:
        pass

    # On Windows, try to ensure pip
    if sys.platform == "win32":
        try:
            kwargs3 = {"capture_output": True, "text": True, "timeout": 60}
            if sys.platform == "win32":
                kwargs3["creationflags"] = subprocess.CREATE_NO_WINDOW
            result = subprocess.run(
                [python, "-m", "ensurepip", "--upgrade"], **kwargs3
            )
            if result.returncode == 0:
                return {"status": "installed", "detail": "pip installed via ensurepip"}
            return {"status": "error", "detail": f"ensurepip failed: {result.stderr.strip()}"}
        except Exception as e:
            return {"status": "error", "detail": f"ensurepip error: {e}"}

    return {"status": "error", "detail": "pip not found and ensurepip failed"}


def check_fonts():
    """Check if PDF premium fonts are available, try to download if missing."""
    fonts_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")
    required = [
        "Poppins-Regular.ttf", "Poppins-Bold.ttf", "Poppins-Italic.ttf",
        "Poppins-BoldItalic.ttf", "Poppins-Medium.ttf", "Poppins-Light.ttf",
        "Poppins-LightItalic.ttf", "Lora[wght].ttf", "Lora-Italic[wght].ttf",
    ]
    missing = [f for f in required if not os.path.exists(os.path.join(fonts_dir, f))]
    if not missing:
        return {"status": "ok", "detail": "All premium fonts found"}

    try:
        # Inline download logic
        GF = "https://raw.githubusercontent.com/google/fonts/main/ofl"
        os.makedirs(fonts_dir, exist_ok=True)
        for fname, url_path in [
            ("Poppins-Regular.ttf", "/poppins/Poppins-Regular.ttf"),
            ("Poppins-Bold.ttf", "/poppins/Poppins-Bold.ttf"),
            ("Poppins-Italic.ttf", "/poppins/Poppins-Italic.ttf"),
            ("Poppins-BoldItalic.ttf", "/poppins/Poppins-BoldItalic.ttf"),
            ("Poppins-Medium.ttf", "/poppins/Poppins-Medium.ttf"),
            ("Poppins-Light.ttf", "/poppins/Poppins-Light.ttf"),
            ("Poppins-LightItalic.ttf", "/poppins/Poppins-LightItalic.ttf"),
            ("Lora[wght].ttf", "/lora/Lora%5Bwght%5D.ttf"),
            ("Lora-Italic[wght].ttf", "/lora/Lora-Italic%5Bwght%5D.ttf"),
        ]:
            dest = os.path.join(fonts_dir, fname)
            if not os.path.exists(dest):
                urllib.request.urlretrieve(GF + url_path, dest)
        still_missing = [f for f in missing if not os.path.exists(os.path.join(fonts_dir, f))]
        if not still_missing:
            return {"status": "installed", "detail": "Premium fonts downloaded"}
        return {"status": "partial", "detail": f"Missing: {', '.join(still_missing)}"}
    except Exception as e:
        return {"status": "missing", "detail": f"Fonts not available: {e}"}


def main():
    result = {"checks": {}}

    # Step 1: Check Python
    py_check = check_python()
    result["checks"]["python"] = py_check
    if py_check["status"] == "error":
        result["status"] = "error"
        result["detail"] = py_check["detail"]
        print(json.dumps(result))
        sys.exit(0)

    # Step 2: Check / ensure pip
    pip_check = ensure_pip()
    result["checks"]["pip"] = pip_check
    if pip_check["status"] == "error":
        result["status"] = "error"
        result["detail"] = pip_check["detail"]
        print(json.dumps(result))
        sys.exit(0)

    # Step 3: Check reportlab
    rl_check = check_reportlab()
    result["checks"]["reportlab"] = rl_check

    if rl_check["status"] == "ok":
        # Step 4: Check / download premium fonts
        font_check = check_fonts()
        result["checks"]["fonts"] = font_check
        result["status"] = "ok"
        detail_parts = ["All dependencies satisfied"]
        if font_check["status"] != "ok":
            detail_parts.append(f"Fonts: {font_check['detail']}")
        result["detail"] = " | ".join(detail_parts)
        print(json.dumps(result))
        sys.exit(0)

    # Step 4: Install reportlab
    install_result = install_reportlab()
    result["checks"]["reportlab_install"] = install_result

    if install_result["status"] == "installed":
        verify = check_reportlab()
        if verify["status"] == "ok":
            font_check = check_fonts()
            result["checks"]["fonts"] = font_check
            result["status"] = "installed"
            result["detail"] = "reportlab installed" + (f" | Fonts: {font_check['detail']}" if font_check["status"] != "ok" else "")
            print(json.dumps(result))
            sys.exit(0)

    result["status"] = "error"
    result["detail"] = install_result.get("detail", "Unknown error installing reportlab")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
