# AutoPlan - Automatic Task Scheduler for Super Productivity

Intelligently schedule your tasks based on urgency. Inspired by the proven approach of [taskcheck](https://github.com/00sapo/taskcheck) for taskwarrior.

## Installation

1. Download `sp-autoplan-plugin.zip` from the [latest release](https://github.com/00sapo/sp-autoplan/releases/latest)
2. In Super Productivity: **Settings > Plugin > Load Plugin**
3. Enable the AutoPlan plugin
4. Click on the AutoPlan button (🪄) in the top bar

## Quick Start

1. Add time estimates to your tasks (required for scheduling)
2. Click **"Run AutoPlan Now"**
3. Your tasks are split into blocks and scheduled to your calendar

That's it. I strongly recommend to adjust the settings and save them. Each option in the UI is
self-explained.

## Features

### 🎯 Smart Priority Calculation
- 🏷️ **Tag-based priorities** — Boost urgency with tags like "urgent" (+20) or reduce with "someday" (-10)
- 📁 **Project-based priorities** — Give entire projects higher or lower priority
- ⏳ **Age awareness** — Older tasks gradually rise in priority so nothing gets forgotten
- ⏱️ **Duration weighting** — Prefer quick wins or tackle big tasks first (your choice!)
- 📊 **Customizable formulas** — Linear, logarithmic, inverse, or exponential priority curves

### 📅 Deadline Management
- 📝 **Deadlines in notes** — Write "Due: 2024-01-20" in task notes (no extra fields needed!)
- 🚨 **Deadline warnings** — Get alerted when tasks can't be completed on time
- 🔄 **Dynamic rescheduling** — Automatically reprioritizes when deadlines are at risk
- 📆 **Multiple date formats** — Supports ISO, US, EU, and natural date formats

### ⏰ Flexible Time Maps
- 🗓️ **Custom work schedules** — Define different work hours for each day of the week
- 🏢 **Per-project schedules** — Schedule "Work" tasks 9-5, "Personal" tasks evenings only
- 🏷️ **Per-tag schedules** — Assign tags to specific time windows
- 🌅 **Multiple time maps** — Create as many schedules as you need

### 🔄 Smart Task Splitting
- ✂️ **Automatic splitting** — Large tasks become "Task ⟨I⟩", "Task ⟨II⟩", etc.
- 📐 **Configurable block size** — Default 2 hours, minimum 30 minutes
- 🔗 **One-click merge** — Consolidate split tasks back together anytime
- 🎨 **Custom naming** — Add prefixes or disable suffixes as you prefer

### 🛡️ Safe & Reversible
- ✅ **Dry-run preview** — See exactly what will be scheduled before applying
- 🔄 **Re-run anytime** — Previous schedules are cleared and rebuilt automatically
- 📌 **Fixed tasks** — Tag meetings and appointments to prevent rescheduling
- 📥 **iCal protection** — Imported calendar events are never moved

### ⚡ Easy to Use
- 🪄 **One-click scheduling** — Just click "Run AutoPlan Now"
- 💾 **Persistent settings** — Configure once, use forever
- 🔌 **Native integration** — Works seamlessly with Super Productivity's side panel
- 📱 **Responsive UI** — Full settings panel or compact side panel view

## How It Works

1. Clear previous schedules and merge any split tasks
2. Calculate urgency for each task based on:
   - Tag boosts (add +20 to "urgent" tag)
   - Project boosts (add +15 to "Work" project)
   - Duration (prefer quick wins or tackle big tasks)
   - Age (prevent old tasks being forgotten)
3. Split large tasks into blocks
4. Schedule blocks in urgency order

## Settings (All Optional)

**Basic**: Block size, max days ahead, work hours, days off

**Tags & Projects**: Add priority boosts (e.g., "urgent" +20, "low-priority" -10)

**Formulas**: Advanced control of how duration and age affect priority

**Do Not Reschedule**: Tag tasks with a "fixed" tag to keep them scheduled (meetings, etc.)

Use the **Schedule** tab to preview what will be scheduled before applying changes.

## Setting Deadlines

Since Super Productivity uses the same field for both scheduled time and due dates, AutoPlan provides an alternative way to set deadlines: **add a deadline in your task notes**.

Add one of these formats to your task notes:
- `Due: 2024-01-20`
- `Deadline: 2024-01-20`
- `Due: Jan 20, 2024`
- `Due: 01/20/2024` (MM/DD/YYYY)
- `due: 20/01/2024` (DD/MM/YYYY if day > 12)

AutoPlan will parse these deadlines and prioritize tasks accordingly. Tasks with approaching deadlines will get higher urgency, and AutoPlan will warn you if a task cannot be completed before its deadline.

### Dynamic Scheduling

AutoPlan can automatically adjust scheduling priorities when deadlines can't be met. When enabled (default), if a task would miss its deadline, AutoPlan reduces the weight of non-deadline factors (tags, projects, duration, age) and re-runs the scheduler, prioritizing deadline urgency until all deadlines are met or the weight reaches zero.

This is similar to taskcheck's `--auto-adjust-urgency` feature.

## Important Caveats

**Super Productivity has no priority field.** AutoPlan rebuilds urgency using tags, projects, task elderliness, deadline, and estimated completion time. Use the dry-run preview to verify the schedule matches your expectations.

**Super Productivity doesn't support partial scheduling of tasks.** AutoPlan splits large tasks into `Task <I>`, `Task <II>`, etc. This means:
- Task count changes each run
- Could conflict with other plugins that manipulate tasks
- Use the Merge tab to manually consolidate if needed

**Super Productivity Plugin API are limited.** Especially, they don't expose settings that would be
useful for improving AutoPlan (working hours, weekdays, boards). This leads to replicate the working
hours settings and to the impossibility of having priority given by our custom list order.

## Development

```bash
npm install
npm run build        # Generate plugin/plugin.js
npm run build:zip    # Create release zip
npm test             # Run tests
```

## License

GPL-3.0
