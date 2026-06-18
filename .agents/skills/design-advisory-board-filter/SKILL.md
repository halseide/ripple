---
name: design-advisory-board-filter
description: Migrated from legacy checklist: Design Advisory Board Filter Skill.md
source_file: Design Advisory Board Filter Skill.md
migrated_date: 2026-06-12
type: skill
status: active
last_updated: 2026-05-30
tags: 
---

<what-to-do>
# Design Advisory Board Filter Skill

## 🎯 Purpose
To route any UI/UX design, wireframe, or feature request through the specialized lenses of history's greatest designers and usability experts. This prevents feature bloat, "local optimization" (where a screen is beautiful but confusing), and ensures all design decisions are ruthlessly governed by principle rather than preference.

## 🧠 The Design Board Members

Read the advisor personas bundled in the `advisors/` directory alongside this `SKILL.md` file. Each markdown file contains the `advisor_domain` and `advisor_filter` for that specific expert.

## 🛠️ The Execution Pipeline

When the Architect commands Antigravity to **"Run this UI through the Design Board"** or **"What would Dieter Rams think of this button?"**, the AI must execute the following workflow:

### 0. The Visual Cortex Rule (Zero-Blindness)
If evaluating a localhost or deployed web app, the AI must NEVER rely purely on reading HTML/CSS code. The AI MUST write and execute an automation script (e.g., using Playwright) to take a full-page screenshot of the target URL, pass the image through the `view_file` tool to activate its multimodal visual cortex, and evaluate the rendered pixels directly.

### 1. The Simulation (The Filter)
- Analyze the specific design element or screen through the requested Advisor's lens.
- **Crucial:** The AI must explicitly answer the Advisor's "Filter Question" from the matrix above.

### 2. The Output Format
The AI's response must strictly follow this structure:
1. **The Verdict:** Approve, Challenge, or Reject.
2. **The Filter Analysis:** An explanation written in the spirit of the Advisor.
3. **The Pivot / Deletion:** What specific element the Advisor demands be removed or changed immediately.

## 🚨 The Primary Rule of the Design Board
If the experts disagree (e.g., Cialdini says "add a scarcity timer" and Tufte says "remove the clutter"), the AI must resolve the conflict using the **Handshake Design Constitution's** priority hierarchy:
1. Clarity
2. Task Completion
3. Trust
4. Beauty
5. Delight

## 📝 Example Triggers
> *"Run the Handshake 'Initiate' screen through Steve Krug and Dieter Rams."*
> *"What would Steve Jobs say about our current dashboard?"*
> *"Filter this mockup through the Design Advisory Board."*
</what-to-do>
