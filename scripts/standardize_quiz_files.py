import os
import re
import glob

def standardize_file(file_path):
    print(f"Processing: {file_path}")
    
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 1. Update CSS comment from "Time selector" to "Time selector (exam mode)"
    content = re.sub(r'/\*\s*Time selector\s*\*/', r'/* Time selector (exam mode) */', content)
    
    # 2. Add .time-hint CSS class if it doesn't exist already
    if '.time-hint' not in content:
        # Insert after .time-input style
        time_input_end = re.search(r'\.time-input\s*\{[^}]+\}', content)
        if time_input_end:
            insert_pos = time_input_end.end()
            time_hint_css = """
.time-hint {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.35rem;
  text-align: left;
}
"""
            content = content[:insert_pos] + time_hint_css + content[insert_pos:]
    
    # 3. Change HTML h1 from "Quiz Loading..." to "Quiz Title"
    content = re.sub(r'<h1[^>]*>\s*Quiz Loading\.\.\.\s*</h1>', r'<h1 id="quiz-title">Quiz Title</h1>', content)
    
    # 4. Change topbar title from "Quiz Loading..." to "Quiz"
    content = re.sub(r'(<div[^>]+class="topbar-title"[^>]*>)\s*Quiz Loading\.\.\.\s*(</div>)', r'\1Quiz\2', content)
    
    # 5. Add marker comments around config objects (QUIZ_CONFIG, BANK_CONFIG, FLASHCARD_CONFIG)
    config_markers = [
        ('QUIZ_CONFIG', 'QUIZ_CONFIG_START', 'QUIZ_CONFIG_END'),
        ('BANK_CONFIG', 'BANK_CONFIG_START', 'BANK_CONFIG_END'),
    ]
    for var, start_marker, end_marker in config_markers:
        if start_marker not in content:
            esc = re.escape(var)
            config_match = re.search(r'(const\s+' + esc + r'\s*=\s*\{[^}]+\};)', content, re.DOTALL)
            if not config_match:
                config_match = re.search(r'(var\s+' + esc + r'\s*=\s*\{[^}]+\};)', content, re.DOTALL)
            if config_match:
                config_code = config_match.group(1)
                wrapped = f"""/* [{start_marker}] */
{config_code}
/* [{end_marker}] */"""
                content = content.replace(config_code, wrapped)

    # 6. Add marker comments around data arrays (QUESTIONS, QUESTION_BANK, FLASHCARD_BANK)
    array_markers = [
        ('QUESTIONS', 'QUESTIONS_START', 'QUESTIONS_END'),
        ('QUESTION_BANK', 'QUESTION_BANK_START', 'QUESTION_BANK_END'),
        ('FLASHCARD_BANK', 'FLASHCARD_BANK_START', 'FLASHCARD_BANK_END'),
    ]
    for var, start_marker, end_marker in array_markers:
        if start_marker not in content:
            esc = re.escape(var)
            array_match = re.search(r'(const\s+' + esc + r'\s*=\s*\[.*?\];)', content, re.DOTALL)
            if not array_match:
                array_match = re.search(r'(var\s+' + esc + r'\s*=\s*\[.*?\];)', content, re.DOTALL)
            if array_match:
                array_code = array_match.group(1)
                wrapped = f"""/* [{start_marker}] */
{array_code}
/* [{end_marker}] */"""
                content = content.replace(array_code, wrapped)
    
    # 7. Clean up whitespace (trim trailing spaces, normalize line endings)
    lines = content.splitlines()
    cleaned_lines = [line.rstrip() for line in lines]
    content = '\n'.join(cleaned_lines)
    
    # Remove extra blank lines
    content = re.sub(r'\n{3,}', r'\n\n', content)
    
    with open(file_path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)
    
    print(f"✅ Completed: {file_path}")

def main():
    # Auto-discover all subject folders — no need to hard-code them
    import pathlib
    repo_root = pathlib.Path(__file__).resolve().parent.parent
    skip = {'.git', '.github', '__pycache__', '_site', 'scripts', 'node_modules'}
    
    target_dirs = [
        str(sub / '**' / '*.html')
        for sub in repo_root.iterdir()
        if sub.is_dir() and sub.name not in skip and not sub.name.startswith('.')
    ]
    # Fall back to current-directory globs when run from repo root
    if not target_dirs:
        target_dirs = ['**/*.html']
    
    exclude_patterns = ['index.html', '*bank*.html', 'all-*.html']
    
    all_files = []
    for pattern in target_dirs:
        all_files.extend(glob.glob(pattern, recursive=True))
    
    # Filter excluded files
    process_files = []
    for fpath in all_files:
        filename = os.path.basename(fpath)
        exclude = False
        for excl in exclude_patterns:
            if glob.fnmatch.fnmatch(filename.lower(), excl.lower()):
                exclude = True
                break
        if not exclude:
            process_files.append(fpath)
    
    print(f"Found {len(process_files)} files to process")
    
    for file_path in process_files:
        try:
            standardize_file(file_path)
        except Exception as e:
            print(f"❌ Failed: {file_path} | {str(e)}")
    
    print("\n✅ All files processed successfully!")

if __name__ == "__main__":
    main()