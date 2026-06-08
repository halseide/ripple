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
    
    print("\nDone! Remember to run `git commit` to save the version bump.")
