# AutoPlan - Automatic Task Scheduler for Super Productivity

> [!Warning]
> Mirrored at https://codeberg.org/00sapo/sp-autoplan

Intelligently schedule your tasks based on urgency. Inspired by the proven approach of [taskcheck](https://github.com/00sapo/taskcheck) for taskwarrior.
You can find a tutorial in [Wiki](https://github.com/00sapo/sp-autoplan/wiki).

## Features

- 🎯 Smart Priority Calculation
- 📅 Deadline Management
- ⏰ Flexible Time Maps
- 🔄 Smart Task Splitting
- 🛡️ Safe & Reversible
- ⚡ Easy to Use

## Quick Start

1. Add time estimates to your tasks (required for scheduling)
2. Click **"Run AutoPlan Now"**
3. Your tasks are split into blocks and scheduled to your calendar

That's it. I strongly recommend to adjust the settings and save them. Each option in the UI is
self-explained.

You can also find a tutorial in [Wiki](https://github.com/00sapo/sp-autoplan/wiki).

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
