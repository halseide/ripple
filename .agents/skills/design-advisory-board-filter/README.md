# Design Advisory Board Skill

This skill allows your AI agent to ruthlessly critique UI designs, workflows, and mockups through the lenses of history's greatest designers (Steve Jobs, Dieter Rams, Don Norman, etc.).

## How to Install
Zero installation required. Because this folder is located in `.agents/skills`, your AI workspace will automatically discover it.

## How to Use
Just open your AI chat while working on a project and say:
> *"Run the `index.html` screen through the Design Advisory Board."*
> *"What would Steve Jobs say about our current dashboard?"*
> *"Filter this mockup through Dieter Rams."*

**The Visual Cortex Rule:** The AI is strictly instructed *never* to just read HTML/CSS. If you ask it to evaluate a localhost URL, it will write a script to take a screenshot and look at the actual pixels. 

## Customizing
You can add your own advisors to the `advisors/` folder. Just create a markdown file with `advisor_domain` and `advisor_filter` in the frontmatter.
