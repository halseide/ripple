import sys
import os
import re

def update_file(filepath, pattern, replacement):
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return
    
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    new_content, count = re.subn(pattern, replacement, content)
    
    if count > 0:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Updated {count} occurrence(s) in {filepath}")
    else:
        print(f"No match found in {filepath} for pattern: {pattern}")

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python bump_version.py <new_version>")
        print("Example: python bump_version.py v0.7.7")
        sys.exit(1)
        
    new_version = sys.argv[1]
    
    # Make sure version starts with 'v'
    if not new_version.startswith('v'):
        new_version = f"v{new_version}"
        
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    print(f"Bumping Ripple version to {new_version}...\n")
    
    # 1. Update README.md
    readme_path = os.path.join(repo_root, "README.md")
    # Matches: > **The Continuous Design Loop** · vX.X.X
    update_file(
        readme_path,
        r'(> \*\*The Continuous Design Loop\*\* · )v\d+\.\d+\.\d+',
        fr'\g<1>{new_version}'
    )
    
    # 2. Update ripple-tracker.js
    tracker_path = os.path.join(repo_root, "src", "tracker", "ripple-tracker.js")
    # Matches: * Ripple Tracker  vX.X.X
    update_file(
        tracker_path,
        r'(\* Ripple Tracker\s+)v\d+\.\d+\.\d+',
        fr'\g<1>{new_version}'
    )
    
    # Matches: const RIPPLE_VERSION = 'vX.X.X';
    update_file(
        tracker_path,
        r"(const RIPPLE_VERSION = ')v\d+\.\d+\.\d+(';)",
        fr"\g<1>{new_version}\g<2>"
    )
    
    # 3. Update CHANGELOG.md
    changelog_path = os.path.join(repo_root, "CHANGELOG.md")
    if os.path.exists(changelog_path):
        from datetime import date
        import subprocess
        
        today = date.today().isoformat()
        recent_commits = ""
        
        try:
            # Grab the last 10 commits for context so the developer/AI can quickly format them
            res = subprocess.run(
                ["git", "log", "-n", "10", "--pretty=format:- `%h` — %s"], 
                capture_output=True, text=True, cwd=repo_root
            )
            if res.returncode == 0:
                recent_commits = res.stdout.strip()
        except Exception:
            pass

        stub = f"## [{new_version}] {today} — [Feature / Fix Summary]\n\n### Changes\n{recent_commits}\n\n---\n\n"
        
        with open(changelog_path, 'r', encoding='utf-8') as f:
            content = f.read()
            
        parts = content.split('---', 1)
        if len(parts) == 2:
            new_content = parts[0] + "---\n\n" + stub + parts[1].lstrip()
            with open(changelog_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"Injected new changelog stub into {changelog_path}")

    print("\nDone! Remember to edit CHANGELOG.md to clean up the commits, then run `git commit` to save the version bump.")
