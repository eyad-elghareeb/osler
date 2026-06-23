from __future__ import annotations

import hashlib
import json
import re
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
SW_PATH = REPO_ROOT / "sw.js"
SKIP_DIRS = {".git", ".github", "__pycache__", "_site", "scripts", "node_modules"}
GENERIC_DESCRIPTIONS = {"past years exams", "department book mcqs", "quiz loading..."}
ACRONYMS = {
    "aub": "AUB",
    "copd": "COPD",
    "fgm": "FGM",
    "hrt": "HRT",
    "mcq": "MCQ",
    "mcqs": "MCQs",
    "pcos": "PCOS",
    "pid": "PID",
    "pms": "PMS",
    "qs": "QS",
    "stis": "STIs",
}
FOLDER_TITLES = {
    "gyn": "Gynecology",
    "cardio": "Cardiology",
    "ai": "AI",
    "dep": "Department",
    "mans": "Mansoura",
    "mansoura": "Mansoura old Qs",
    "by-chapter": "Question by chapter",
    "ped": "Paediatrics",
    "surg": "Surgery",
    "med": "Internal Medicine",
    "chest": "Chest Medicine",
    "past-years": "Past Years",
}


def main() -> int:
    changed_files: list[Path] = []
    
    global_tracker_map = {}
    for html_path in discover_html_files():
        text = html_path.read_text(encoding="utf-8")
        config = extract_quiz_config(text)
        if config and config.get("uid"):
            uid = config["uid"]
            rel_path = html_path.relative_to(REPO_ROOT).as_posix()
            folder_path = html_path.parent.relative_to(REPO_ROOT).as_posix()
            if folder_path == ".":
                folder_path = ""
            else:
                folder_path += "/"
            global_tracker_map[uid] = {
                "path": rel_path,
                "folderPath": folder_path
            }
            
    tracker_map_path = REPO_ROOT / "tracker-map.json"
    new_tracker_map = json.dumps(global_tracker_map, separators=(',', ':'))
    old_tracker_map = tracker_map_path.read_text(encoding="utf-8") if tracker_map_path.exists() else ""
    if old_tracker_map != new_tracker_map:
        tracker_map_path.write_text(new_tracker_map, encoding="utf-8")
        changed_files.append(tracker_map_path)

    for index_path in discover_index_files():
        if update_index_file(index_path):
            changed_files.append(index_path)

    if update_service_worker():
        changed_files.append(SW_PATH)

    if changed_files:
        print("Updated:")
        for path in changed_files:
            print(f"  - {path.relative_to(REPO_ROOT).as_posix()}")
    else:
        print("No generated updates were needed.")

    return 0




def discover_index_files() -> list[Path]:
    paths: list[Path] = []
    for path in REPO_ROOT.rglob("index.html"):
        rel = path.relative_to(REPO_ROOT)
        if any(part in SKIP_DIRS or part.startswith(".") for part in rel.parts[:-1]):
            continue
        paths.append(path)
    return sorted(paths, key=lambda item: natural_key(item.relative_to(REPO_ROOT).as_posix()))


def discover_html_files() -> list[Path]:
    paths: list[Path] = []
    for path in REPO_ROOT.rglob("*.html"):
        rel = path.relative_to(REPO_ROOT)
        if any(part in SKIP_DIRS or part.startswith(".") for part in rel.parts[:-1]):
            continue
        paths.append(path)
    return sorted(paths, key=lambda item: (item.relative_to(REPO_ROOT).as_posix() != "index.html", natural_key(item.relative_to(REPO_ROOT).as_posix())))


def update_index_file(index_path: Path) -> bool:
    """Synchronize QUIZZES array in an index.html file: prune dead links, update metadata, add missing ones."""
    text = index_path.read_text(encoding="utf-8")
    
    try:
        array_literal, start, end = extract_assigned_literal(text, "QUIZZES", "[", "]")
    except ValueError:
        # Skip index files without QUIZZES array
        return False
    
    existing_entries = parse_js_literal(array_literal)
    if not isinstance(existing_entries, list):
        raise ValueError(f"{index_path} has a QUIZZES assignment that is not an array.")

    index_dir = index_path.parent
    dir_rel = index_dir.relative_to(REPO_ROOT)
    
    # 1. Discover all valid local targets
    valid_local_files = {p.name for p in index_dir.glob("*.html") if p.name != "index.html"}
    
    # 2. Discover valid subfolder targets (with index.html)
    import urllib.parse as _ul
    valid_subfolders = {}
    for p in index_dir.iterdir():
        if p.is_dir() and not (p.name in SKIP_DIRS or p.name.startswith(".")):
            if (p / "index.html").exists():
                url = _ul.quote(p.name, safe='') + "/index.html"
                valid_subfolders[url] = p.name

    # 3. Filter existing entries (prune dead links)
    updated_entries = []
    seen_urls = set()
    
    for entry in existing_entries:
        if not isinstance(entry, dict): continue
        url = entry.get("url")
        if not url: continue
        
        is_valid = False
        quiz_path = None
        if url.startswith(("http://", "https://")):
            is_valid = True
        elif "/" in url:
            # Subfolder or relative path (e.g. med/index.html)
            quiz_path = index_dir / url
            if quiz_path.exists():
                is_valid = True
        else:
            # Local file in current directory
            if url in valid_local_files:
                quiz_path = index_dir / url
                is_valid = True
        
        if is_valid and url not in seen_urls:
            # Enrich existing entry with latest metadata from file if possible
            if quiz_path and quiz_path.is_file() and quiz_path.name != "index.html":
                new_meta = build_quiz_entry(quiz_path, dir_rel, entry.get("icon", "📘"))
                if new_meta:
                    # Update entry fields with latest from file
                    for key in ["uid", "title", "description", "tags"]:
                        if key in new_meta:
                            entry[key] = new_meta[key]
            
            updated_entries.append(entry)
            seen_urls.add(url)
    
    # 4. Add missing local files
    new_local_entries = []
    # Use first existing icon or default
    existing_icon = next((e.get("icon") for e in updated_entries if e.get("icon")), "📘")
    
    for filename in sorted(valid_local_files, key=natural_key):
        if filename not in seen_urls:
            quiz_path = index_dir / filename
            entry = build_quiz_entry(quiz_path, dir_rel, str(existing_icon))
            if entry:
                new_local_entries.append(entry)
                seen_urls.add(filename)

    # 5. Add missing subfolders
    new_subfolder_entries = []
    
    for url, folder_name in sorted(valid_subfolders.items(), key=lambda x: natural_key(x[1])):
        if url not in seen_urls:
            title = FOLDER_TITLES.get(folder_name.lower(), folder_name.replace('-', ' ').replace('_', ' ').capitalize())
            entry = {
                "title": f"📁 {title}",
                "description": f"{title} quizzes and resources",
                "icon": default_icon(Path(folder_name)),
                "tags": ["Folder"],
                "url": url,
            }
            new_subfolder_entries.append(entry)
            seen_urls.add(url)

    final_entries = updated_entries + new_local_entries + new_subfolder_entries
    
    # Serialize back
    new_literals = [serialize_quiz_entry(e) for e in final_entries]
    new_array_content = "[\n" + ",\n".join(new_literals) + "\n]"
    
    # Compare with normalized version to avoid unnecessary writes
    # (parse_js_literal -> serialize) would be the best way to compare
    # but for now simple string check on content
    
    updated_text = text[:start] + new_array_content + text[end:]
    
    # 6. Synchronize Titles and Labels
    updated_text = sync_titles(index_path, updated_text)
    
    if updated_text == text:
        return False
        
    index_path.write_text(updated_text, encoding="utf-8")
    return True


def sync_titles(index_path: Path, text: str) -> str:
    """Synchronize <title>, .topbar-title, and hero h1 based on folder path."""
    dir_rel = index_path.parent.relative_to(REPO_ROOT)
    parts = dir_rel.parts
    if not parts:
        return text  # Root index usually has manual titles
        
    subject_key = parts[0].lower()
    subject_name = FOLDER_TITLES.get(subject_key, subject_key.capitalize())
    
    # If subfolder (e.g. med/past-years)
    if len(parts) > 1:
        sub_key = parts[-1].lower()
        sub_name = FOLDER_TITLES.get(sub_key, sub_key.replace('-', ' ').replace('_', ' ').capitalize())
        
        # Avoid redundancy if sub_name already includes subject_name
        if sub_name.lower().startswith(subject_name.lower()):
            full_title = f"MU61 Quiz - {sub_name}"
            hero_title = f"Select your <span>{sub_name}</span>"
        else:
            full_title = f"MU61 Quiz - {subject_name} {sub_name}"
            hero_title = f"Select your <span>{subject_name} {sub_name}</span>"
            
        back_label = f"Back to {subject_name}"
    else:
        full_title = f"MU61 Quiz - {subject_name}"
        hero_title = f"Select your <span>{subject_name} exam</span>"
        back_label = "Back to Home"

    # Update <title>
    updated = re.sub(r"<title>.*?</title>", f"<title>{full_title}</title>", text)
    
    # Update .topbar-title
    updated = re.sub(r'<div class="topbar-title">.*?</div>', f'<div class="topbar-title">{full_title}</div>', updated)
    
    # Update hero h1
    updated = re.sub(r'<h1>.*?</h1>', f'<h1>{hero_title}</h1>', updated)
    
    # Update back button title
    updated = re.sub(r'class="icon-btn back-btn" title=".*?"', f'class="icon-btn back-btn" title="{back_label}"', updated)
    
    return updated


def build_quiz_entry(quiz_path: Path, dir_rel: Path, icon: str) -> dict[str, object]:
    quiz_text = quiz_path.read_text(encoding="utf-8")

    # Skip files without quiz config
    config = extract_quiz_config(quiz_text)
    if not config:
        return None  # Signal that this file should be skipped

    title = beautify_title(extract_quiz_title(quiz_text) or quiz_path.stem)
    description = infer_description(title, extract_quiz_description(quiz_text), dir_rel)
    question_count = extract_question_count(quiz_text)
    primary_tag = infer_primary_tag(title, description, dir_rel, quiz_path.stem)

    return {
        "uid": config.get("uid", ""),
        "title": title,
        "description": description,
        "icon": icon,
        "tags": [primary_tag, question_label(question_count)],
        "url": quiz_path.name,
    }


def discover_asset_files() -> list[Path]:
    """Find all image, style, script, and manifest files recursively, excluding engines and skip dirs."""
    extensions = {".png", ".svg", ".jpg", ".jpeg", ".css", ".webmanifest", ".js", ".json"}
    paths: list[Path] = []
    # Known engines are handled separately to ensure they are at the top of the list
    engines = {"quiz-engine.js", "bank-engine.js", "index-engine.js", "index-engine.css", "flashcard-engine.js", "written-engine.js", "ai-assistant-engine.js", "uworld-engine.js", "osce-engine.js", "search-engine.js", "engine-shared.js", "engine-shared.css", "engine-tracker.js"}
    # Source files that should not be precached
    skip_files = {"sw.js", "sync-engine.js", "sync-engine.src.js"}
    
    for path in REPO_ROOT.rglob("*"):
        if not path.is_file():
            continue
        rel = path.relative_to(REPO_ROOT)
        if any(part in SKIP_DIRS or part.startswith(".") for part in rel.parts[:-1]):
            continue
        if path.suffix.lower() not in extensions:
            continue
        if path.name in engines or path.name in skip_files:
            continue
        paths.append(path)
    return sorted(paths, key=lambda item: natural_key(item.relative_to(REPO_ROOT).as_posix()))


def update_service_worker() -> bool:
    text = SW_PATH.read_text(encoding="utf-8")
    
    # Discovery
    html_paths = [path.relative_to(REPO_ROOT).as_posix() for path in discover_html_files()]
    asset_paths = [path.relative_to(REPO_ROOT).as_posix() for path in discover_asset_files()]
    
    # Engine files must always be first in the precache list for prioritized installation
    # Engines are specifically placed first to ensure cache robustness logic in sw.js works.
    engine_paths = []
    for eng in ["quiz-engine.js", "bank-engine.js", "flashcard-engine.js", "written-engine.js", "ai-assistant-engine.js", "uworld-engine.js", "osce-engine.js", "search-engine.js", "index-engine.js", "index-engine.css", "engine-shared.js", "engine-shared.css", "engine-tracker.js"]:
        if (REPO_ROOT / "engines" / eng).exists():
            engine_paths.append("engines/" + eng)
    if (REPO_ROOT / "tracker-map.json").exists():
        engine_paths.append("tracker-map.json")
            
    all_cache_paths = engine_paths + html_paths + asset_paths
    cache_version = build_cache_version(all_cache_paths)

    updated = re.sub(
        r"const CACHE_VERSION = '.*?';",
        f"const CACHE_VERSION = '{cache_version}';",
        text,
        count=1,
    )

    array_literal, start, end = extract_assigned_literal(updated, "PRECACHE_REL_PATHS", "[", "]")
    new_array_literal = serialize_string_array(all_cache_paths)
    updated = updated[:start] + new_array_literal + updated[end:]

    if updated == text:
        return False

    # Update SHARED assets in sw.js (ensure icon fallbacks are present)
    shared_assets = [
        'quiz-engine.js', 'bank-engine.js', 'flashcard-engine.js', 'written-engine.js', 'index-engine.js', 'index-engine.css',
        'engine-shared.js', 'engine-shared.css', 'engine-tracker.js',
        'manifest.webmanifest', 'favicon.svg',
        'icon-48.png', 'icon-72.png', 'icon-96.png', 'icon-144.png', 'icon-192.png', 'icon-512.png',
        'tracker-map.json'
    ]
    
    shared_literal = "[\n" + ",\n".join(f"          '{a}'" for a in shared_assets) + "\n        ]"
    updated = re.sub(
        r"var SHARED = \[.*?\];",
        f"var SHARED = {shared_literal};",
        updated,
        flags=re.DOTALL
    )

    SW_PATH.write_text(updated, encoding="utf-8")
    return True


def build_cache_version(all_paths: list[str]) -> str:
    hasher = hashlib.sha256()

    for rel_path in all_paths:
        path = REPO_ROOT / rel_path
        hasher.update(rel_path.encode("utf-8"))
        hasher.update(b"\0")
        hasher.update(path.read_bytes())
        hasher.update(b"\0")

    return f"mu61-quiz-{hasher.hexdigest()[:12]}"


def extract_quiz_title(quiz_text: str) -> str | None:
    config = extract_quiz_config(quiz_text)
    title = config.get("title")
    return normalize_spaces(str(title)) if title else None


def extract_quiz_description(quiz_text: str) -> str:
    config = extract_quiz_config(quiz_text)
    description = config.get("description")
    return normalize_spaces(str(description)) if description else ""


def extract_quiz_config(quiz_text: str) -> dict[str, object]:
    for var_name in ("QUIZ_CONFIG", "BANK_CONFIG", "WRITTEN_CONFIG"):
        try:
            config_literal, _, _ = extract_assigned_literal(quiz_text, var_name, "{", "}")
            config = parse_js_literal(config_literal)
            if isinstance(config, dict):
                return config
        except ValueError:
            continue
    return {}  # Return empty dict instead of raising error


def extract_question_count(quiz_text: str) -> int:
    for var_name in ("QUESTIONS", "QUESTION_BANK", "FLASHCARD_BANK", "WRITTEN_QUESTIONS"):
        try:
            questions_literal, _, _ = extract_assigned_literal(quiz_text, var_name, "[", "]")
            matches = re.findall(r'["\']?question["\']?\s*:', questions_literal)
            if matches:
                return len(matches)
            # For flashcard banks, count by "front" keys
            front_matches = re.findall(r'["\']?front["\']?\s*:', questions_literal)
            if front_matches:
                return len(front_matches)
            return 0
        except ValueError:
            continue
    return 0  # Return 0 instead of raising error


def extract_assigned_literal(text: str, variable_name: str, open_char: str, close_char: str) -> tuple[str, int, int]:
    match = re.search(rf"\b(?:const|let|var)\s+{re.escape(variable_name)}\s*=", text)
    if not match:
        raise ValueError(f"Could not find assignment for {variable_name}.")

    start = text.find(open_char, match.end())
    if start == -1:
        raise ValueError(f"Could not find literal start for {variable_name}.")

    literal, end = extract_balanced(text, start, open_char, close_char)
    return literal, start, end


def extract_balanced(text: str, start: int, open_char: str, close_char: str) -> tuple[str, int]:
    depth = 0
    in_string: str | None = None
    in_line_comment = False
    in_block_comment = False
    escape = False
    index = start

    while index < len(text):
        char = text[index]
        next_char = text[index + 1] if index + 1 < len(text) else ""

        if in_line_comment:
            if char == "\n":
                in_line_comment = False
        elif in_block_comment:
            if char == "*" and next_char == "/":
                in_block_comment = False
                index += 1
        elif in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == in_string:
                in_string = None
        else:
            if char == "/" and next_char == "/":
                in_line_comment = True
                index += 1
            elif char == "/" and next_char == "*":
                in_block_comment = True
                index += 1
            elif char in {"'", '"', "`"}:
                in_string = char
            elif char == open_char:
                depth += 1
            elif char == close_char:
                depth -= 1
                if depth == 0:
                    return text[start : index + 1], index + 1

        index += 1

    raise ValueError("Unbalanced JavaScript literal.")


def parse_js_literal(literal: str) -> object:
    # Strip JavaScript/JSON comments first
    # Remove single-line comments
    normalized = re.sub(r'//.*?$', '', literal, flags=re.MULTILINE)
    # Remove multi-line comments
    normalized = re.sub(r'/\*.*?\*/', '', normalized, flags=re.DOTALL)
    
    # Quote unquoted keys - handle newlines and whitespace properly
    # Match: after { or , (with any whitespace including newlines), capture unquoted key followed by :
    key_pattern = re.compile(r"([,{]\s*)([A-Za-z_$][A-Za-z0-9_$]*)(\s*:)", re.DOTALL)
    previous = None
    while previous != normalized:
        previous = normalized
        normalized = key_pattern.sub(r'\1"\2"\3', normalized)

    # Remove trailing commas before } or ]
    normalized = re.sub(r",(\s*[}\]])", r"\1", normalized)
    
    return json.loads(normalized)


def append_entries_to_array_literal(array_literal: str, new_entries: list[str]) -> str:
    prefix = array_literal[:-1].rstrip()
    if prefix.endswith("["):
        return prefix + "\n" + ",\n".join(new_entries) + "\n]"
    return prefix + ",\n" + ",\n".join(new_entries) + "\n]"


def serialize_quiz_entry(entry: dict[str, object]) -> str:
    uid = json.dumps(entry.get("uid", ""), ensure_ascii=False)
    title = json.dumps(entry["title"], ensure_ascii=False)
    description = json.dumps(entry["description"], ensure_ascii=False)
    icon = json.dumps(entry["icon"], ensure_ascii=False)
    tags = ", ".join(json.dumps(tag, ensure_ascii=False) for tag in entry["tags"])
    url = json.dumps(entry["url"], ensure_ascii=False)

    return (
        "  {\n"
        f"    uid: {uid},\n"
        f"    title: {title},\n"
        f"    description: {description},\n"
        f"    icon: {icon},\n"
        f"    tags: [{tags}],\n"
        f"    url: {url}\n"
        "  }"
    )


def serialize_string_array(values: list[str]) -> str:
    lines = ["["]
    for value in values:
        escaped = value.replace("\\", "\\\\").replace("'", "\\'")
        lines.append(f"  '{escaped}',")
    if len(lines) > 1:
        lines[-1] = lines[-1].rstrip(",")
    lines.append("]")
    return "\n".join(lines)


def infer_description(title: str, raw_description: str, dir_rel: Path) -> str:
    cleaned = normalize_spaces(raw_description)
    lowered = cleaned.casefold()

    if cleaned and lowered not in GENERIC_DESCRIPTIONS:
        return cleaned

    if "past years" in dir_rel.as_posix().casefold():
        return f"Gynecology {title} Exam"

    lecture_match = re.match(r"^L\d+\s+(.+)$", title, flags=re.IGNORECASE)
    if lecture_match:
        return lecture_match.group(1)

    if cleaned:
        return cleaned

    return f"{title} Quiz"


def infer_primary_tag(title: str, description: str, dir_rel: Path, stem: str) -> str:
    haystack = " ".join([title, description, dir_rel.as_posix(), stem]).casefold()

    if "end round" in haystack:
        return "End Round"
    if "midterm" in haystack:
        return "Midterm"
    if re.search(r"\bmid\b", haystack):
        return "Mid"
    if "final" in haystack:
        return "Final"
    if re.search(r"\bqs\b", haystack):
        return "QS"
    if "misc" in haystack:
        return "Misc"
    if "dep" in dir_rel.parts or "department book" in haystack:
        return "Lecture"
    return "Quiz"


def question_label(question_count: int) -> str:
    suffix = "Question" if question_count == 1 else "Questions"
    return f"{question_count} {suffix}"


def beautify_title(raw_title: str) -> str:
    cleaned = normalize_spaces(raw_title.replace("_", " ").replace("-", " "))

    def replacer(match: re.Match[str]) -> str:
        token = match.group(0)
        lower = token.casefold()

        acronym = ACRONYMS.get(lower)
        if acronym:
            return acronym

        ordinal_match = re.fullmatch(r"(\d+)(st|nd|rd|th)", token, flags=re.IGNORECASE)
        if ordinal_match:
            return ordinal_match.group(1) + ordinal_match.group(2).lower()

        lecture_match = re.fullmatch(r"l(\d+)", token, flags=re.IGNORECASE)
        if lecture_match:
            return "L" + lecture_match.group(1)

        if token.isupper() and len(token) <= 4:
            return token

        return token[:1].upper() + token[1:].lower()

    return re.sub(r"[A-Za-z0-9]+", replacer, cleaned)


def default_icon(dir_rel: Path) -> str:
    lowered = dir_rel.as_posix().casefold()
    if "gyn" in lowered:
        return "🤰"
    if "cardio" in lowered:
        return "🫀"
    if "ped" in lowered:
        return "👶"
    if "surg" in lowered:
        return "🔪"
    if "med" in lowered or "medicine" in lowered:
        return "🩺"
    if "chest" in lowered:
        return "🫁"
    if "past years" in lowered or "exam" in lowered:
        return "📚"
    return "📘"


def normalize_spaces(value: str) -> str:
    return " ".join(value.split())


def natural_key(value: str) -> list[tuple[int, object]]:
    parts = re.split(r"(\d+)", value.casefold())
    key: list[tuple[int, object]] = []
    for part in parts:
        if not part:
            continue
        if part.isdigit():
            key.append((0, int(part)))
        else:
            key.append((1, part))
    return key


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover - surfaced directly in CI logs
        print(f"sync_quiz_assets.py failed: {exc}", file=sys.stderr)
        raise
