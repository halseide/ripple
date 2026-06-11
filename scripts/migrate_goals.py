#!/usr/bin/env python3
"""
One-time migration: convert goals[] from ripple.config.json into
category:'goal' entries in data/prompt_log.json.

Usage:
    python scripts/migrate_goals.py
    python scripts/migrate_goals.py --dry-run
"""

import json
import sys
import time
from pathlib import Path
from datetime import datetime, timezone

def main():
    dry_run = '--dry-run' in sys.argv
    
    config_path = Path('ripple.config.json')
    if not config_path.exists():
        print('ERROR: ripple.config.json not found')
        sys.exit(1)
    
    config = json.loads(config_path.read_text(encoding='utf-8'))
    log_path = Path('data/prompt_log.json')
    prompt_log = json.loads(log_path.read_text(encoding='utf-8')) if log_path.exists() else []
    
    # Check for already-migrated goals
    existing_goals = {p['prompt'] for p in prompt_log if p.get('category') == 'goal'}
    
    new_entries = []
    now_iso = datetime.now(timezone.utc).isoformat()
    
    for proj in config.get('projects', []):
        key = proj['key']
        goals = proj.get('goals', [])
        
        for goal_text in goals:
            goal_text = goal_text.strip()
            if not goal_text or goal_text.startswith('_DEPRECATED'):
                continue
            if goal_text in existing_goals:
                print(f'  SKIP (already exists): [{key}] {goal_text}')
                continue
            
            ts = int(time.time())
            time.sleep(1)  # ensure unique timestamps
            prompt_id = f'goal_{ts}_{key}'
            
            entry = {
                'promptId': prompt_id,
                'projectKey': key,
                'pageUrl': f'http://localhost/{key}/',
                'elementSelector': 'project-level',
                'elementContext': 'project-level',
                'category': 'goal',
                'subtype': None,
                'prompt': goal_text,
                'sessionId': 'migration',
                'status': 'pending',
                'capturedAt': now_iso,
                'x': 100,
                'y': 100,
                'resolvedAt': None,
                'commitHash': None,
                'commitMessage': None,
            }
            
            new_entries.append(entry)
            print(f'  ADD: [{key}] {goal_text}')
    
    if not new_entries:
        print('\nNo new goals to migrate.')
        return
    
    print(f'\n{len(new_entries)} goals to migrate.')
    
    if dry_run:
        print('DRY RUN — no changes written.')
        return
    
    # Prepend new entries to prompt log
    prompt_log = new_entries + prompt_log
    log_path.write_text(
        json.dumps(prompt_log, indent=2, ensure_ascii=False),
        encoding='utf-8'
    )
    print(f'Written to {log_path}')
    print('Done. You can now remove goals[] from ripple.config.json.')

if __name__ == '__main__':
    main()
