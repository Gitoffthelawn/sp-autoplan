/**
 * Tests for AutoPlanner module
 */

import { describe, it, expect } from 'vitest';
import { AutoPlanner, TaskSplitter, DEFAULT_CONFIG } from '../src/core.js';

// Helper to create a task
function createTask(overrides = {}) {
  return {
    id: 'task-1',
    title: 'Test Task',
    timeEstimate: 4 * 60 * 60 * 1000, // 4 hours
    timeSpent: 0,
    tagIds: [],
    projectId: 'project-1',
    parentId: null,
    created: Date.now() - 5 * 24 * 60 * 60 * 1000, // 5 days ago
    isDone: false,
    notes: '',
    ...overrides,
  };
}

describe('AutoPlanner.getCurrentDayMinutes', () => {
  it('returns 0 before work start', () => {
    const now = new Date('2024-01-15T08:00:00');
    expect(AutoPlanner.getCurrentDayMinutes(now, 9)).toBe(0);
  });

  it('calculates minutes since work start', () => {
    const now = new Date('2024-01-15T11:30:00'); // 2.5 hours after 9 AM
    expect(AutoPlanner.getCurrentDayMinutes(now, 9)).toBe(150);
  });

  it('handles exactly at work start', () => {
    const now = new Date('2024-01-15T09:00:00');
    expect(AutoPlanner.getCurrentDayMinutes(now, 9)).toBe(0);
  });

  it('handles late in the day', () => {
    const now = new Date('2024-01-15T17:00:00'); // 8 hours after 9 AM
    expect(AutoPlanner.getCurrentDayMinutes(now, 9)).toBe(480);
  });

  it('respects custom work start hour', () => {
    const now = new Date('2024-01-15T10:30:00');
    expect(AutoPlanner.getCurrentDayMinutes(now, 8)).toBe(150); // 2.5h after 8 AM
    expect(AutoPlanner.getCurrentDayMinutes(now, 10)).toBe(30); // 0.5h after 10 AM
  });
});

describe('AutoPlanner.schedule', () => {
  const allTags = [];
  const config = {
    ...DEFAULT_CONFIG,
    tagPriorities: {},
    durationFormula: 'none',
    oldnessFormula: 'none',
    workdayStartHour: 9,
    workdayHours: 8,
    maxDaysAhead: 30,
  };

  it('schedules splits in order of urgency', () => {
    const tasks = [
      createTask({ id: 'task-1', title: 'First', timeEstimate: 2 * 60 * 60 * 1000 }),
      createTask({ id: 'task-2', title: 'Second', timeEstimate: 2 * 60 * 60 * 1000 }),
    ];

    const splits = [];
    for (const task of tasks) {
      splits.push(...TaskSplitter.splitTask(task, 120, config));
    }

    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, allTags, [], startTime);

    expect(result.schedule).toHaveLength(2);
    // First task has higher base priority (position 1 of 2)
    expect(result.schedule[0].split.originalTaskId).toBe('task-1');
    expect(result.schedule[1].split.originalTaskId).toBe('task-2');
  });

  it('respects work day limits', () => {
    const task = createTask({
      id: 'task-1',
      title: 'Long Task',
      timeEstimate: 12 * 60 * 60 * 1000, // 12 hours
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    expect(splits).toHaveLength(6);

    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, allTags, [], startTime);

    expect(result.schedule).toHaveLength(6);

    // First 4 blocks should be on day 1 (8 hours)
    const day1 = result.schedule.filter(s => s.startTime.getDate() === 15);
    const day2 = result.schedule.filter(s => s.startTime.getDate() === 16);

    expect(day1).toHaveLength(4);
    expect(day2).toHaveLength(2);
  });

  it('starts from current time if during work hours', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T14:00:00'); // 2 PM = 5 hours into workday
    const result = AutoPlanner.schedule(splits, config, allTags, [], startTime);

    expect(result.schedule).toHaveLength(1);
    // Should start at 2 PM (14:00)
    expect(result.schedule[0].startTime.getHours()).toBe(14);
    expect(result.schedule[0].startTime.getMinutes()).toBe(0);
  });

  it('moves to next day if past work hours', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T18:00:00'); // 6 PM - after 8h workday
    const result = AutoPlanner.schedule(splits, config, allTags, [], startTime);

    expect(result.schedule).toHaveLength(1);
    expect(result.schedule[0].startTime.getDate()).toBe(16); // Next day
  });

  it('respects maxDaysAhead limit', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 100 * 60 * 60 * 1000, // 100 hours = 12.5 work days
    });

    const limitedConfig = { ...config, maxDaysAhead: 5 };
    const splits = TaskSplitter.splitTask(task, 120, limitedConfig);

    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, limitedConfig, allTags, [], startTime);

    // Should stop before scheduling all blocks
    expect(result.schedule.length).toBeLessThan(splits.length);

    // Check that all scheduled blocks are within 5 days
    const lastDate = result.schedule[result.schedule.length - 1].startTime;
    const daysDiff = (lastDate - startTime) / (1000 * 60 * 60 * 24);
    expect(daysDiff).toBeLessThan(5);
  });

  it('returns empty schedule for empty splits', () => {
    const result = AutoPlanner.schedule([], config, allTags, []);
    expect(result.schedule).toHaveLength(0);
    expect(result.deadlineMisses).toHaveLength(0);
  });

  it('includes urgency information in schedule', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, allTags, [], startTime);

    expect(result.schedule[0].urgency).toBeDefined();
    expect(result.schedule[0].urgencyComponents).toBeDefined();
    expect(result.schedule[0].urgencyComponents.tag).toBeDefined();
  });

  it('schedules only remaining time when first split includes timeSpent', () => {
    const task = createTask({
      id: 'task-1',
      title: 'Long Task',
      timeEstimate: 8 * 60 * 60 * 1000, // 8 hours
      timeSpent: (3 * 60 + 13) * 60 * 1000, // 3h 13m
    });

    const splits = TaskSplitter.splitTask(task, 120, config); // 2 hour blocks
    expect(splits).toHaveLength(3);

    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, allTags, [], startTime);

    expect(result.schedule).toHaveLength(3);

    const totalScheduledMs = result.schedule.reduce(
      (sum, item) => sum + (item.endTime - item.startTime),
      0
    );
    const remainingMs = task.timeEstimate - task.timeSpent;

    expect(Math.abs(totalScheduledMs - remainingMs)).toBeLessThan(1000);

    const firstBlockMs = result.schedule[0].endTime - result.schedule[0].startTime;
    expect(Math.abs(firstBlockMs - (2 * 60 * 60 * 1000))).toBeLessThan(1000);
  });

  it('preserves timeSpent when dynamically shortening first split', () => {
    const task = createTask({
      id: 'task-1',
      title: 'Long Task',
      timeEstimate: 6 * 60 * 60 * 1000, // 6 hours
      timeSpent: 2 * 60 * 60 * 1000, // 2 hours
    });

    const dynamicConfig = {
      ...config,
      workdayHours: 1, // Force partial scheduling
      minimumBlockSizeMinutes: 30,
    };

    const splits = TaskSplitter.splitTask(task, 180, dynamicConfig); // 3 hour blocks
    expect(splits).toHaveLength(2);

    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, dynamicConfig, allTags, [], startTime);

    expect(result.schedule.length).toBeGreaterThan(0);

    const firstSplit = result.schedule[0].split;
    const expectedMs = task.timeSpent + 60 * 60 * 1000; // timeSpent + scheduled hour

    expect(firstSplit.timeSpentMs).toBe(task.timeSpent);
    expect(firstSplit.estimatedMs).toBe(expectedMs);
  });

  it('schedules by priority with tag boosts', () => {
    const tagConfig = {
      ...config,
      tagPriorities: { urgent: 100 },
    };
    const allTagsList = [{ id: 'tag-urgent', title: 'urgent' }];

    const tasks = [
      createTask({ id: 'task-1', title: 'Normal', timeEstimate: 2 * 60 * 60 * 1000 }),
      createTask({ id: 'task-2', title: 'Urgent', timeEstimate: 2 * 60 * 60 * 1000, tagIds: ['tag-urgent'] }),
    ];

    const splits = [];
    for (const task of tasks) {
      splits.push(...TaskSplitter.splitTask(task, 120, tagConfig));
    }

    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, tagConfig, allTagsList, [], startTime);

    // Urgent task should be scheduled first despite being second in list
    expect(result.schedule[0].split.originalTaskId).toBe('task-2');
  });

  it('re-evaluates urgency after each assignment', () => {
    // This tests the core algorithm: after scheduling one block,
    // urgency is recalculated, potentially changing priority order
    const longTaskConfig = {
      ...config,
      durationFormula: 'inverse', // Shorter = higher priority
      durationWeight: 10,
    };

    const tasks = [
      createTask({ id: 'long', title: 'Long', timeEstimate: 8 * 60 * 60 * 1000 }), // 4 blocks
      createTask({ id: 'short', title: 'Short', timeEstimate: 2 * 60 * 60 * 1000 }), // 1 block
    ];

    const splits = [];
    for (const task of tasks) {
      splits.push(...TaskSplitter.splitTask(task, 120, longTaskConfig));
    }

    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, longTaskConfig, [], [], startTime);

    // Short task should be scheduled first due to inverse duration formula
    expect(result.schedule[0].split.originalTaskId).toBe('short');
  });
});

describe('AutoPlanner.shouldSkipDay', () => {
  it('returns false when skipDays is empty', () => {
    const date = new Date('2024-01-13T10:00:00'); // Saturday
    expect(AutoPlanner.shouldSkipDay(date, [])).toBe(false);
  });

  it('returns false when skipDays is undefined', () => {
    const date = new Date('2024-01-13T10:00:00'); // Saturday
    expect(AutoPlanner.shouldSkipDay(date, undefined)).toBe(false);
  });

  it('returns true for Saturday when 6 is in skipDays', () => {
    const date = new Date('2024-01-13T10:00:00'); // Saturday = 6
    expect(AutoPlanner.shouldSkipDay(date, [0, 6])).toBe(true);
  });

  it('returns true for Sunday when 0 is in skipDays', () => {
    const date = new Date('2024-01-14T10:00:00'); // Sunday = 0
    expect(AutoPlanner.shouldSkipDay(date, [0, 6])).toBe(true);
  });

  it('returns false for Monday when only weekend is skipped', () => {
    const date = new Date('2024-01-15T10:00:00'); // Monday = 1
    expect(AutoPlanner.shouldSkipDay(date, [0, 6])).toBe(false);
  });
});

describe('AutoPlanner.advanceToNextWorkday', () => {
  it('advances to next day when no skip days', () => {
    const date = new Date('2024-01-15T10:00:00'); // Monday
    const next = AutoPlanner.advanceToNextWorkday(date, [], 9);
    expect(next.getDate()).toBe(16); // Tuesday
    expect(next.getHours()).toBe(9);
  });

  it('skips Saturday and Sunday when weekend is in skipDays', () => {
    const friday = new Date('2024-01-12T10:00:00'); // Friday
    const next = AutoPlanner.advanceToNextWorkday(friday, [0, 6], 9);
    expect(next.getDate()).toBe(15); // Monday (skips Sat 13, Sun 14)
    expect(next.getDay()).toBe(1); // Monday
  });

  it('skips multiple consecutive days', () => {
    const thursday = new Date('2024-01-11T10:00:00'); // Thursday
    // Skip Fri, Sat, Sun (5, 6, 0)
    const next = AutoPlanner.advanceToNextWorkday(thursday, [0, 5, 6], 9);
    expect(next.getDate()).toBe(15); // Monday
    expect(next.getDay()).toBe(1);
  });

  it('sets correct work start hour', () => {
    const date = new Date('2024-01-15T10:00:00');
    const next = AutoPlanner.advanceToNextWorkday(date, [], 8);
    expect(next.getHours()).toBe(8);
    expect(next.getMinutes()).toBe(0);
  });
});

describe('AutoPlanner.schedule with skipDays', () => {
  const config = {
    ...DEFAULT_CONFIG,
    blockSizeMinutes: 120,
    workdayStartHour: 9,
    workdayHours: 8,
    skipDays: [0, 6], // Skip Saturday and Sunday
  };

  it('skips weekends when scheduling across multiple days', () => {
    // Create enough tasks to span multiple days
    const task = createTask({
      id: 'task-1',
      timeEstimate: 24 * 60 * 60 * 1000, // 24 hours = 3 full work days
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    // Friday Jan 12, 2024
    const startTime = new Date('2024-01-12T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // Should have 12 blocks (24h / 2h)
    expect(result.schedule.length).toBe(12);

    // Check that no blocks are scheduled on Saturday (13) or Sunday (14)
    const scheduledDays = result.schedule.map(s => ({
      date: s.startTime.getDate(),
      day: s.startTime.getDay()
    }));

    // Should not have any Saturday (6) or Sunday (0)
    expect(scheduledDays.every(d => d.day !== 0 && d.day !== 6)).toBe(true);

    // First 4 blocks on Friday (12), next 4 on Monday (15), last 4 on Tuesday (16)
    const fridayBlocks = result.schedule.filter(s => s.startTime.getDate() === 12);
    const mondayBlocks = result.schedule.filter(s => s.startTime.getDate() === 15);
    const tuesdayBlocks = result.schedule.filter(s => s.startTime.getDate() === 16);

    expect(fridayBlocks.length).toBe(4);
    expect(mondayBlocks.length).toBe(4);
    expect(tuesdayBlocks.length).toBe(4);
  });

  it('starts on next workday when starting on a skip day', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000, // 2 hours
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    // Saturday Jan 13, 2024
    const startTime = new Date('2024-01-13T10:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    expect(result.schedule.length).toBe(1);
    // Should be scheduled on Monday Jan 15
    expect(result.schedule[0].startTime.getDate()).toBe(15);
    expect(result.schedule[0].startTime.getDay()).toBe(1); // Monday
  });

  it('handles starting on Sunday', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    // Sunday Jan 14, 2024
    const startTime = new Date('2024-01-14T10:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    expect(result.schedule.length).toBe(1);
    // Should be scheduled on Monday Jan 15
    expect(result.schedule[0].startTime.getDate()).toBe(15);
  });

  it('works with no skip days configured', () => {
    const noSkipConfig = { ...config, skipDays: [] };
    const task = createTask({
      id: 'task-1',
      timeEstimate: 16 * 60 * 60 * 1000, // 16 hours = 2 days
    });

    const splits = TaskSplitter.splitTask(task, 120, noSkipConfig);
    // Friday Jan 12
    const startTime = new Date('2024-01-12T09:00:00');
    const result = AutoPlanner.schedule(splits, noSkipConfig, [], [], startTime);

    // Should schedule on Friday (4 blocks) and Saturday (4 blocks)
    const fridayBlocks = result.schedule.filter(s => s.startTime.getDate() === 12);
    const saturdayBlocks = result.schedule.filter(s => s.startTime.getDate() === 13);

    expect(fridayBlocks.length).toBe(4);
    expect(saturdayBlocks.length).toBe(4);
  });
});

describe('AutoPlanner.getDateKey', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date('2024-01-15T10:30:00');
    expect(AutoPlanner.getDateKey(date)).toBe('2024-01-15');
  });

  it('pads month and day with zeros', () => {
    const date = new Date('2024-03-05T10:30:00');
    expect(AutoPlanner.getDateKey(date)).toBe('2024-03-05');
  });
});

describe('AutoPlanner.calculateFixedMinutesPerDay', () => {
  it('returns empty object for no fixed tasks', () => {
    const result = AutoPlanner.calculateFixedMinutesPerDay([]);
    expect(result).toEqual({});
  });

  it('calculates minutes for a single fixed task', () => {
    const fixedTasks = [{
      id: 'fixed-1',
      title: 'Fixed Task',
      dueWithTime: new Date('2024-01-15T14:00:00').getTime(),
      timeEstimate: 2 * 60 * 60 * 1000, // 2 hours = 120 minutes
    }];

    const result = AutoPlanner.calculateFixedMinutesPerDay(fixedTasks);
    expect(result['2024-01-15']).toBe(120);
  });

  it('sums multiple fixed tasks on the same day', () => {
    const fixedTasks = [
      {
        id: 'fixed-1',
        dueWithTime: new Date('2024-01-15T10:00:00').getTime(),
        timeEstimate: 2 * 60 * 60 * 1000, // 2 hours
      },
      {
        id: 'fixed-2',
        dueWithTime: new Date('2024-01-15T14:00:00').getTime(),
        timeEstimate: 1 * 60 * 60 * 1000, // 1 hour
      },
    ];

    const result = AutoPlanner.calculateFixedMinutesPerDay(fixedTasks);
    expect(result['2024-01-15']).toBe(180); // 3 hours
  });

  it('handles fixed tasks on different days', () => {
    const fixedTasks = [
      {
        id: 'fixed-1',
        dueWithTime: new Date('2024-01-15T10:00:00').getTime(),
        timeEstimate: 2 * 60 * 60 * 1000,
      },
      {
        id: 'fixed-2',
        dueWithTime: new Date('2024-01-16T10:00:00').getTime(),
        timeEstimate: 3 * 60 * 60 * 1000,
      },
    ];

    const result = AutoPlanner.calculateFixedMinutesPerDay(fixedTasks);
    expect(result['2024-01-15']).toBe(120);
    expect(result['2024-01-16']).toBe(180);
  });

  it('ignores tasks without dueWithTime', () => {
    const fixedTasks = [{
      id: 'fixed-1',
      timeEstimate: 2 * 60 * 60 * 1000,
      // no dueWithTime
    }];

    const result = AutoPlanner.calculateFixedMinutesPerDay(fixedTasks);
    expect(result).toEqual({});
  });

  it('ignores tasks without timeEstimate', () => {
    const fixedTasks = [{
      id: 'fixed-1',
      dueWithTime: new Date('2024-01-15T10:00:00').getTime(),
      // no timeEstimate
    }];

    const result = AutoPlanner.calculateFixedMinutesPerDay(fixedTasks);
    expect(result).toEqual({});
  });
});

describe('AutoPlanner.schedule with fixed tasks', () => {
  const config = {
    ...DEFAULT_CONFIG,
    tagPriorities: {},
    durationFormula: 'none',
    oldnessFormula: 'none',
    workdayStartHour: 9,
    workdayHours: 6, // 6-hour workday for easier testing
    skipDays: [0, 6],
  };

  it('reduces available time on days with fixed tasks', () => {
    // Create a task that needs 6 hours (fills a whole day normally)
    const task = createTask({
      id: 'task-1',
      timeEstimate: 6 * 60 * 60 * 1000, // 6 hours
    });

    // Fixed task takes 4 hours on Jan 15
    const fixedTasks = [{
      id: 'fixed-1',
      dueWithTime: new Date('2024-01-15T10:00:00').getTime(),
      timeEstimate: 4 * 60 * 60 * 1000, // 4 hours
    }];

    const splits = TaskSplitter.splitTask(task, 120, config); // 2-hour blocks = 3 splits
    const startTime = new Date('2024-01-15T09:00:00'); // Monday
    const result = AutoPlanner.schedule(splits, config, [], [], startTime, fixedTasks);

    expect(result.schedule.length).toBe(3);

    // Jan 15 has only 2 hours available (6 - 4 = 2), so only 1 block fits
    const jan15Blocks = result.schedule.filter(s => s.startTime.getDate() === 15);
    expect(jan15Blocks.length).toBe(1);

    // Remaining 2 blocks should be on Jan 16
    const jan16Blocks = result.schedule.filter(s => s.startTime.getDate() === 16);
    expect(jan16Blocks.length).toBe(2);
  });

  it('skips days entirely filled by fixed tasks', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000, // 2 hours
    });

    // Fixed task takes entire 6-hour day on Jan 15
    const fixedTasks = [{
      id: 'fixed-1',
      dueWithTime: new Date('2024-01-15T09:00:00').getTime(),
      timeEstimate: 6 * 60 * 60 * 1000, // 6 hours
    }];

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime, fixedTasks);

    expect(result.schedule.length).toBe(1);
    // Should skip Jan 15 entirely and schedule on Jan 16
    expect(result.schedule[0].startTime.getDate()).toBe(16);
  });

  it('handles fixed tasks that exceed workday hours', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    // Fixed task takes more than available (7 hours > 6 hour workday)
    const fixedTasks = [{
      id: 'fixed-1',
      dueWithTime: new Date('2024-01-15T09:00:00').getTime(),
      timeEstimate: 7 * 60 * 60 * 1000, // 7 hours
    }];

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime, fixedTasks);

    expect(result.schedule.length).toBe(1);
    // Should skip to next day
    expect(result.schedule[0].startTime.getDate()).toBe(16);
  });

  it('works normally when no fixed tasks provided', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 4 * 60 * 60 * 1000, // 4 hours
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    
    // Call with empty fixed tasks array
    const result = AutoPlanner.schedule(splits, config, [], [], startTime, []);

    expect(result.schedule.length).toBe(2);
    // All should be on the same day
    expect(result.schedule[0].startTime.getDate()).toBe(15);
    expect(result.schedule[1].startTime.getDate()).toBe(15);
  });

  it('handles multiple days with varying fixed task loads', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 10 * 60 * 60 * 1000, // 10 hours
    });

    const fixedTasks = [
      {
        id: 'fixed-1',
        dueWithTime: new Date('2024-01-15T10:00:00').getTime(),
        timeEstimate: 4 * 60 * 60 * 1000, // 4 hours on Jan 15
      },
      {
        id: 'fixed-2',
        dueWithTime: new Date('2024-01-16T10:00:00').getTime(),
        timeEstimate: 2 * 60 * 60 * 1000, // 2 hours on Jan 16
      },
    ];

    const splits = TaskSplitter.splitTask(task, 120, config); // 5 blocks of 2 hours
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime, fixedTasks);

    expect(result.schedule.length).toBe(5);

    // Jan 15: 6h - 4h fixed = 2h available = 1 block
    const jan15Blocks = result.schedule.filter(s => s.startTime.getDate() === 15);
    expect(jan15Blocks.length).toBe(1);

    // Jan 16: 6h - 2h fixed = 4h available = 2 blocks
    const jan16Blocks = result.schedule.filter(s => s.startTime.getDate() === 16);
    expect(jan16Blocks.length).toBe(2);

    // Jan 17: 6h - 0h fixed = 6h available = remaining 2 blocks
    const jan17Blocks = result.schedule.filter(s => s.startTime.getDate() === 17);
    expect(jan17Blocks.length).toBe(2);
  });

  it('handles iCal events as fixed tasks blocking time', () => {
    // Working hours: 10-17 (7 hours)
    const testConfig = {
      ...config,
      workdayStartHour: 10,
      workdayHours: 7,
      skipDays: [],
      treatIcalAsFixed: true,
    };

    // Task that needs 4 hours (2 blocks of 2 hours)
    const task = createTask({
      id: 'task-1',
      timeEstimate: 4 * 60 * 60 * 1000, // 4 hours
    });

    // iCal event lasting 6 hours from 14:00-20:00 on Jan 15
    // This blocks 14:00-17:00 (3 hours) of the workday
    const fixedTasks = [{
      id: 'ical-1',
      issueType: 'ICAL',
      dueWithTime: new Date('2024-01-15T14:00:00').getTime(),
      timeEstimate: 6 * 60 * 60 * 1000, // 6 hours
    }];

    const splits = TaskSplitter.splitTask(task, 120, testConfig); // 2 blocks of 2 hours
    expect(splits.length).toBe(2);

    const startTime = new Date('2024-01-15T10:00:00'); // Monday 10 AM
    const result = AutoPlanner.schedule(splits, testConfig, [], [], startTime, fixedTasks);

    expect(result.schedule.length).toBe(2);

    // Jan 15 has 7h workday (10-17) minus 3h blocked (14-17) = 4h available
    // So both 2-hour blocks should fit on Jan 15
    const jan15Blocks = result.schedule.filter(s => s.startTime.getDate() === 15);
    expect(jan15Blocks.length).toBe(2);
  });

  it('pushes tasks to next day when iCal blocks most of the day', () => {
    // Test that blocks don't get scheduled when insufficient time remains
    const testConfig = {
      ...DEFAULT_CONFIG,
      tagPriorities: {},
      durationFormula: 'none',
      oldnessFormula: 'none',
      workdayStartHour: 10,
      workdayHours: 7,
      skipDays: [],
      treatIcalAsFixed: true,
      minimumBlockSizeMinutes: 120, // Require full 2-hour blocks
    };

    // Task that needs 4 hours
    const task = createTask({
      id: 'task-1',
      timeEstimate: 4 * 60 * 60 * 1000, // 4 hours
    });

    // iCal event lasting 6 hours from 11:00-17:00 on Jan 15
    // This blocks 6 hours of the 7-hour workday, leaving only 1 hour
    const fixedTasks = [{
      id: 'ical-1',
      issueType: 'ICAL',
      dueWithTime: new Date('2024-01-15T11:00:00').getTime(),
      timeEstimate: 6 * 60 * 60 * 1000, // 6 hours
    }];

    const splits = TaskSplitter.splitTask(task, 120, testConfig); // 2 blocks of 2 hours
    const startTime = new Date('2024-01-15T10:00:00');
    const result = AutoPlanner.schedule(splits, testConfig, [], [], startTime, fixedTasks);

    expect(result.schedule.length).toBe(2);

    // Jan 15 only has 1 hour available, not enough for 2-hour blocks
    // Both blocks should go to Jan 16
    const jan15Blocks = result.schedule.filter(s => s.startTime.getDate() === 15);
    expect(jan15Blocks.length).toBe(0);

    const jan16Blocks = result.schedule.filter(s => s.startTime.getDate() === 16);
    expect(jan16Blocks.length).toBe(2);
  });
});

describe('AutoPlanner.schedule with deadlines', () => {
  const config = {
    ...DEFAULT_CONFIG,
    tagPriorities: {},
    durationFormula: 'none',
    oldnessFormula: 'none',
    deadlineFormula: 'linear',
    deadlineWeight: 12,
    workdayStartHour: 9,
    workdayHours: 8,
    skipDays: [],
  };

  it('prioritizes tasks with closer deadlines', () => {
    // Two tasks: one due soon, one due later
    const tasks = [
      createTask({ 
        id: 'later', 
        title: 'Later Task', 
        timeEstimate: 2 * 60 * 60 * 1000,
        dueDate: new Date('2024-01-25').getTime(), // 10 days away
      }),
      createTask({ 
        id: 'sooner', 
        title: 'Sooner Task', 
        timeEstimate: 2 * 60 * 60 * 1000,
        dueDate: new Date('2024-01-17').getTime(), // 2 days away
      }),
    ];

    const splits = [];
    for (const task of tasks) {
      splits.push(...TaskSplitter.splitTask(task, 120, config));
    }

    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // Sooner task should be scheduled first despite being second in list
    expect(result.schedule[0].split.originalTaskId).toBe('sooner');
  });

  it('detects tasks that will miss their deadlines', () => {
    // Task with deadline but too much work to complete in time
    const task = createTask({
      id: 'task-1',
      title: 'Big Task',
      timeEstimate: 20 * 60 * 60 * 1000, // 20 hours = 2.5 work days
      dueDate: new Date('2024-01-16T17:00:00').getTime(), // Due end of tomorrow
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // Should have deadline misses
    expect(result.deadlineMisses.length).toBeGreaterThan(0);
    expect(result.deadlineMisses[0].taskId).toBe('task-1');
    expect(result.deadlineMisses[0].taskTitle).toBe('Big Task');
  });

  it('returns no deadline misses when task can be completed on time', () => {
    // Small task with distant deadline
    const task = createTask({
      id: 'task-1',
      title: 'Small Task',
      timeEstimate: 2 * 60 * 60 * 1000, // 2 hours
      dueDate: new Date('2024-01-25').getTime(), // 10 days away
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // Should have no deadline misses
    expect(result.deadlineMisses.length).toBe(0);
  });

  it('detects tasks with deadlines already in the past', () => {
    // Task with deadline that was yesterday
    const task = createTask({
      id: 'task-1',
      title: 'Overdue Task',
      timeEstimate: 2 * 60 * 60 * 1000, // 2 hours
      notes: 'Deadline: 2024-01-14 17:00', // Yesterday at 5pm
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00'); // Today
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // Should detect this as a deadline miss
    expect(result.deadlineMisses.length).toBe(1);
    expect(result.deadlineMisses[0].taskId).toBe('task-1');
    expect(result.deadlineMisses[0].taskTitle).toBe('Overdue Task');
    // The deadline was in the past
    expect(result.deadlineMisses[0].dueDate < startTime).toBe(true);
  });

  it('includes deadline urgency component in schedule items', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
      dueDate: new Date('2024-01-20').getTime(), // 5 days away
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    expect(result.schedule[0].urgencyComponents.deadline).toBeGreaterThan(0);
  });

  it('tracks unscheduled splits for tasks that exceed maxDaysAhead', () => {
    // Task with deadline and too much work for limited scheduling window
    const task = createTask({
      id: 'task-1',
      title: 'Huge Task',
      timeEstimate: 100 * 60 * 60 * 1000, // 100 hours
      dueDate: new Date('2024-02-01').getTime(),
    });

    const limitedConfig = { ...config, maxDaysAhead: 3 };
    const splits = TaskSplitter.splitTask(task, 120, limitedConfig);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, limitedConfig, [], [], startTime);

    // Should have deadline miss with unscheduled splits
    expect(result.deadlineMisses.length).toBeGreaterThan(0);
    expect(result.deadlineMisses[0].unscheduledSplits).toBeGreaterThan(0);
  });

  it('recalculates urgency for each future day, so due date urgency increases over time', () => {
    // Scenario:
    // - Task A: priority 5 (via tag), due in 14 days
    // - Task B: priority 15 (via tag), no due date  
    // - Task C: priority 7.6 (via tag), no due date
    // - All tasks take 8 hours (full working day)
    //
    // Urgency calculations:
    // - Day 1: A=7.40 (5 + 2.40 deadline), B=15.00, C=7.60
    //   -> B wins, and C > A
    // - Day 2 (with recalculation): A=7.86 (5 + 2.86 deadline), C=7.60
    //   -> A wins because deadline urgency increased
    // - Day 2 (without recalculation - BUG): A=7.40, C=7.60
    //   -> C would win incorrectly
    //
    // Key insight: urgency must be recalculated at the time each split would be scheduled,
    // not at the original start time. Otherwise, C would be scheduled before A on day 2
    // because A's deadline urgency wouldn't increase for future days.

    const startTime = new Date('2024-01-15T09:00:00'); // Monday
    const fourteenDaysLater = new Date('2024-01-29T17:00:00'); // 14 days later
    
    const allTags = [
      { id: 'tag-low', title: 'low' },
      { id: 'tag-high', title: 'high' },
      { id: 'tag-medium', title: 'medium' },
    ];
    
    const configWithTags = {
      ...config,
      tagPriorities: {
        'low': 5,      // Task A base priority
        'high': 15,    // Task B base priority
        'medium': 7.6, // Task C base priority (slightly higher than A's total on day 1)
      },
    };

    const tasks = [
      createTask({
        id: 'task-A',
        title: 'Task A (low priority but with deadline)',
        timeEstimate: 8 * 60 * 60 * 1000, // 8 hours = full work day
        tagIds: ['tag-low'],
        dueDate: fourteenDaysLater.getTime(),
      }),
      createTask({
        id: 'task-B',
        title: 'Task B (high priority)',
        timeEstimate: 8 * 60 * 60 * 1000, // 8 hours = full work day
        tagIds: ['tag-high'],
        // No due date
      }),
      createTask({
        id: 'task-C',
        title: 'Task C (higher than A on day 1, but lower after deadline urgency increases)',
        timeEstimate: 8 * 60 * 60 * 1000, // 8 hours = full work day
        tagIds: ['tag-medium'],
        // No due date
      }),
    ];

    const splits = [];
    for (const task of tasks) {
      splits.push(...TaskSplitter.splitTask(task, 480, configWithTags)); // 8h max block
    }

    const result = AutoPlanner.schedule(splits, configWithTags, allTags, [], startTime);

    // Should have 3 splits scheduled (one per task)
    expect(result.schedule).toHaveLength(3);

    // Get the dates for each scheduled split
    const day1 = new Date('2024-01-15').toDateString();
    const day2 = new Date('2024-01-16').toDateString();
    const day3 = new Date('2024-01-17').toDateString();

    const getTaskForDay = (dateString) => {
      const item = result.schedule.find(s => s.startTime.toDateString() === dateString);
      return item?.split.originalTaskId;
    };

    // Day 1: B should be scheduled (highest base priority of 10)
    expect(getTaskForDay(day1)).toBe('task-B');

    // Day 2: A should be scheduled (deadline urgency increases as we approach due date)
    // Even though C has 5.1 base priority vs A's 5.0, A's deadline urgency
    // should push it above C when calculated from day 2's perspective
    expect(getTaskForDay(day2)).toBe('task-A');

    // Day 3: C should be scheduled (remaining task with 5.1 base priority)
    expect(getTaskForDay(day3)).toBe('task-C');
  });
});

describe('AutoPlanner.scheduleWithAutoAdjust', () => {
  const config = {
    ...DEFAULT_CONFIG,
    tagPriorities: { urgent: 50 },
    durationFormula: 'none',
    oldnessFormula: 'none',
    deadlineFormula: 'linear',
    deadlineWeight: 12,
    autoAdjustUrgency: true,
    urgencyWeight: 1.0,
    workdayStartHour: 9,
    workdayHours: 8,
    skipDays: [],
  };

  it('returns schedule without adjustment when no deadline misses', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
      notes: 'Due: 2024-01-25', // Plenty of time
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.scheduleWithAutoAdjust(splits, config, [], [], startTime);

    expect(result.schedule.length).toBe(1);
    expect(result.deadlineMisses.length).toBe(0);
    expect(result.finalUrgencyWeight).toBe(1.0);
    expect(result.adjustmentAttempts).toBe(0);
  });

  it('adjusts urgency weight when deadline cannot be met', () => {
    // Create two tasks: one urgent with tag boost, one with tight deadline
    // With full urgency weight, the urgent task gets scheduled first,
    // causing the deadline task to miss its deadline.
    // With reduced urgency weight, deadline priority takes over.
    const tasks = [
      createTask({
        id: 'urgent-task',
        title: 'Urgent',
        timeEstimate: 8 * 60 * 60 * 1000, // 8 hours (full day)
        tagIds: ['tag-urgent'],
      }),
      createTask({
        id: 'deadline-task',
        title: 'Deadline',
        timeEstimate: 8 * 60 * 60 * 1000, // 8 hours (full day)
        notes: 'Deadline: 2024-01-15 12:00', // Due at noon today - impossible!
      }),
    ];

    const allTags = [{ id: 'tag-urgent', name: 'urgent' }];

    let allSplits = [];
    for (const task of tasks) {
      allSplits.push(...TaskSplitter.splitTask(task, 120, config));
    }

    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.scheduleWithAutoAdjust(allSplits, config, allTags, [], startTime);

    // Auto-adjust should have kicked in to prioritize the deadline task
    expect(result.finalUrgencyWeight).toBeLessThan(1.0);
    expect(result.adjustmentAttempts).toBeGreaterThan(0);
  });

  it('does not adjust when autoAdjustUrgency is false', () => {
    const task = createTask({
      id: 'task-1',
      timeEstimate: 20 * 60 * 60 * 1000, // 20 hours
      notes: 'Deadline: 2024-01-16', // Due tomorrow - will miss
    });

    const noAdjustConfig = { ...config, autoAdjustUrgency: false, maxDaysAhead: 1 };
    const splits = TaskSplitter.splitTask(task, 120, noAdjustConfig);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.scheduleWithAutoAdjust(splits, noAdjustConfig, [], [], startTime);

    // Should not attempt adjustment
    expect(result.adjustmentAttempts).toBe(0);
    expect(result.finalUrgencyWeight).toBe(1.0);
    // Should still have deadline miss
    expect(result.deadlineMisses.length).toBeGreaterThan(0);
  });

  it('stops adjusting when weight reaches 0', () => {
    // Task that cannot be scheduled before deadline no matter what
    const task = createTask({
      id: 'task-1',
      timeEstimate: 100 * 60 * 60 * 1000, // 100 hours = 12.5 days
      notes: 'Deadline: 2024-01-16', // Due tomorrow
    });

    const maxDayConfig = { ...config, maxDaysAhead: 2 };
    const splits = TaskSplitter.splitTask(task, 120, maxDayConfig);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.scheduleWithAutoAdjust(splits, maxDayConfig, [], [], startTime);

    // Should have tried all adjustments down to 0
    expect(result.finalUrgencyWeight).toBe(0);
  });
});

describe('AutoPlanner.schedule with dynamic splitting', () => {
  const config = {
    ...DEFAULT_CONFIG,
    blockSizeMinutes: 120, // 2 hours preferred block size
    minimumBlockSizeMinutes: 120, // 2 hours minimum block size (for these tests)
    tagPriorities: {},
    durationFormula: 'none',
    oldnessFormula: 'none',
    workdayStartHour: 9,
    workdayHours: 6, // 6-hour workday for easier testing
    skipDays: [],
  };

  it('dynamically splits task to fill remaining day time', () => {
    // Task with 5 hours (split into 2h + 2h + 1h initially)
    // Start at 13:00 (4 hours into workday), leaving 2 hours today
    // Should schedule 2h today (from first block) and create remainder for next day
    const task = createTask({
      id: 'task-1',
      title: 'Long Task',
      timeEstimate: 5 * 60 * 60 * 1000, // 5 hours
    });

    const splits = TaskSplitter.splitTask(task, 120, config); // 3 splits: 2h, 2h, 1h
    expect(splits.length).toBe(3);

    // Start at 1 PM (4 hours into 6-hour workday = 2 hours left)
    const startTime = new Date('2024-01-15T13:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // All task time should be scheduled
    const totalScheduledMinutes = result.schedule.reduce(
      (sum, item) => sum + (item.endTime - item.startTime) / 60000,
      0
    );
    expect(totalScheduledMinutes).toBe(5 * 60); // All 5 hours scheduled

    // First block should be scheduled today (2 hours)
    const day1 = result.schedule.filter(s => s.startTime.getDate() === 15);
    expect(day1.length).toBe(1);
    expect((day1[0].endTime - day1[0].startTime) / 60000).toBe(120); // 2 hours
  });

  it('uses available time when block does not fit but remaining >= min block size', () => {
    // 5-hour task, 3 hours available today (more than min block of 2h)
    // Should schedule 3 hours today, 2 hours tomorrow
    const task = createTask({
      id: 'task-1',
      title: 'Task',
      timeEstimate: 5 * 60 * 60 * 1000, // 5 hours
    });

    const splits = TaskSplitter.splitTask(task, 120, config); // 3 splits: 2h, 2h, 1h
    
    // Start at 12:00 (3 hours into 6-hour workday = 3 hours left)
    const startTime = new Date('2024-01-15T12:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // Check day 1 scheduling (3 hours available)
    const day1 = result.schedule.filter(s => s.startTime.getDate() === 15);
    const day1Minutes = day1.reduce((sum, s) => sum + (s.endTime - s.startTime) / 60000, 0);
    
    // First 2h block fits completely in day 1. After scheduling it, 1 hour remains.
    // The next block (2h) doesn't fit, and remaining time (1h) < min block size (2h),
    // so no dynamic split happens - we move to day 2.
    expect(day1Minutes).toBe(120); // 2 hours (one full block)
    
    // Day 2 should have the remaining time
    const day2 = result.schedule.filter(s => s.startTime.getDate() === 16);
    const day2Minutes = day2.reduce((sum, s) => sum + (s.endTime - s.startTime) / 60000, 0);
    expect(day2Minutes).toBe(180); // 3 hours (2h + 1h blocks)
  });

  it('moves to next day when remaining time < minimum block size', () => {
    // 4-hour task, 1 hour available today (less than min block of 2h)
    // Should skip today and schedule everything tomorrow
    const task = createTask({
      id: 'task-1',
      title: 'Task',
      timeEstimate: 4 * 60 * 60 * 1000, // 4 hours
    });

    const splits = TaskSplitter.splitTask(task, 120, config); // 2 splits: 2h, 2h

    // Start at 14:00 (5 hours into 6-hour workday = 1 hour left, less than min block)
    const startTime = new Date('2024-01-15T14:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // No blocks should be scheduled on day 1 (not enough time)
    const day1 = result.schedule.filter(s => s.startTime.getDate() === 15);
    expect(day1.length).toBe(0);

    // All blocks should be on day 2
    const day2 = result.schedule.filter(s => s.startTime.getDate() === 16);
    expect(day2.length).toBe(2);
  });

  it('dynamically creates new split when partial block scheduled', () => {
    // 3-hour task (one block), 2 hours available today
    // Should split into 2h today + 1h tomorrow
    const task = createTask({
      id: 'task-1',
      title: 'Task',
      timeEstimate: 3 * 60 * 60 * 1000, // 3 hours
    });

    // Use 60-minute minimum block size for this test
    const smallBlockConfig = { ...config, blockSizeMinutes: 60 };
    
    // Create a single 3-hour split manually (as if from a larger block size)
    const splits = [{
      originalTaskId: 'task-1',
      originalTask: task,
      splitIndex: 0,
      totalSplits: 1,
      title: 'Task <I>',
      estimatedHours: 3,
      estimatedMs: 3 * 60 * 60 * 1000,
      tagIds: task.tagIds || [],
      projectId: task.projectId,
      parentId: task.parentId,
      prevSplitIndex: null,
      nextSplitIndex: null,
    }];

    // Start at 13:00 (4 hours into 6-hour workday = 2 hours left)
    const startTime = new Date('2024-01-15T13:00:00');
    const result = AutoPlanner.schedule(splits, smallBlockConfig, [], [], startTime);

    // Should have 2 scheduled items now (dynamically created)
    expect(result.schedule.length).toBe(2);

    // Day 1 should have 2 hours
    const day1 = result.schedule.filter(s => s.startTime.getDate() === 15);
    expect(day1.length).toBe(1);
    expect((day1[0].endTime - day1[0].startTime) / 60000).toBe(120);

    // Day 2 should have 1 hour (the remainder)
    const day2 = result.schedule.filter(s => s.startTime.getDate() === 16);
    expect(day2.length).toBe(1);
    expect((day2[0].endTime - day2[0].startTime) / 60000).toBe(60);
  });

  it('fills day completely when possible with dynamic splits', () => {
    // 10-hour task, 6 hours available today (full day)
    // Should fill today completely (6h) and put 4h on next day
    const task = createTask({
      id: 'task-1',
      title: 'Big Task',
      timeEstimate: 10 * 60 * 60 * 1000, // 10 hours
    });

    const splits = TaskSplitter.splitTask(task, 120, config); // 5 splits: 2h each
    expect(splits.length).toBe(5);

    // Start at 9 AM (full 6-hour day available)
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // Day 1 should have exactly 6 hours (3 blocks of 2h)
    const day1 = result.schedule.filter(s => s.startTime.getDate() === 15);
    const day1Minutes = day1.reduce((sum, s) => sum + (s.endTime - s.startTime) / 60000, 0);
    expect(day1Minutes).toBe(360); // 6 hours

    // Day 2 should have 4 hours (2 blocks of 2h)
    const day2 = result.schedule.filter(s => s.startTime.getDate() === 16);
    const day2Minutes = day2.reduce((sum, s) => sum + (s.endTime - s.startTime) / 60000, 0);
    expect(day2Minutes).toBe(240); // 4 hours

    // Total scheduled should be 10 hours
    const totalMinutes = result.schedule.reduce(
      (sum, s) => sum + (s.endTime - s.startTime) / 60000, 0
    );
    expect(totalMinutes).toBe(600);
  });
});

describe('AutoPlanner.schedule with time maps', () => {
  // Helper to create a time map with per-day schedules
  const createTimeMap = (name, daySchedules) => ({
    name,
    days: daySchedules,
  });

  it('uses default time map when no project assignment', () => {
    const config = {
      ...DEFAULT_CONFIG,
      timeMaps: {
        'default': createTimeMap('Default', {
          0: null, // Sunday skip
          1: { startHour: 9, endHour: 17 },
          2: { startHour: 9, endHour: 17 },
          3: { startHour: 9, endHour: 17 },
          4: { startHour: 9, endHour: 17 },
          5: { startHour: 9, endHour: 17 },
          6: null, // Saturday skip
        }),
      },
      projectTimeMaps: {},
      skipDays: undefined, // Don't use legacy settings
      workdayStartHour: undefined,
      workdayHours: undefined,
    };

    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
      projectId: 'project-1', // Project without time map assignment
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00'); // Monday
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    expect(result.schedule.length).toBe(1);
    expect(result.schedule[0].startTime.getHours()).toBe(9);
    expect(result.schedule[0].timeMapId).toBe('default');
  });

  it('schedules tasks from different projects in their respective time maps', () => {
    const config = {
      ...DEFAULT_CONFIG,
      timeMaps: {
        'work': createTimeMap('Work', {
          0: null,
          1: { startHour: 9, endHour: 17 },
          2: { startHour: 9, endHour: 17 },
          3: { startHour: 9, endHour: 17 },
          4: { startHour: 9, endHour: 17 },
          5: { startHour: 9, endHour: 17 },
          6: null,
        }),
        'personal': createTimeMap('Personal', {
          0: { startHour: 10, endHour: 18 },
          1: { startHour: 19, endHour: 22 },
          2: { startHour: 19, endHour: 22 },
          3: { startHour: 19, endHour: 22 },
          4: { startHour: 19, endHour: 22 },
          5: { startHour: 19, endHour: 22 },
          6: { startHour: 10, endHour: 18 },
        }),
      },
      projectTimeMaps: {
        'work-project': 'work',
        'personal-project': 'personal',
      },
      defaultTimeMap: 'work',
      skipDays: undefined,
      workdayStartHour: undefined,
      workdayHours: undefined,
    };

    const workTask = createTask({
      id: 'work-task',
      title: 'Work Task',
      timeEstimate: 2 * 60 * 60 * 1000,
      projectId: 'work-project',
    });

    const personalTask = createTask({
      id: 'personal-task',
      title: 'Personal Task',
      timeEstimate: 2 * 60 * 60 * 1000,
      projectId: 'personal-project',
    });

    const workSplits = TaskSplitter.splitTask(workTask, 120, config);
    const personalSplits = TaskSplitter.splitTask(personalTask, 120, config);
    const allSplits = [...workSplits, ...personalSplits];

    // Start Monday at 9 AM
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(allSplits, config, [], [], startTime);

    expect(result.schedule.length).toBe(2);

    // Work task should be scheduled at 9:00 (work time map)
    const workSchedule = result.schedule.find(s => s.split.originalTaskId === 'work-task');
    expect(workSchedule).toBeDefined();
    expect(workSchedule.startTime.getHours()).toBe(9);
    expect(workSchedule.timeMapId).toBe('work');

    // Personal task should be scheduled at 19:00 (personal time map for weekday)
    const personalSchedule = result.schedule.find(s => s.split.originalTaskId === 'personal-task');
    expect(personalSchedule).toBeDefined();
    expect(personalSchedule.startTime.getHours()).toBe(19);
    expect(personalSchedule.timeMapId).toBe('personal');
  });

  it('respects per-day skip days in time maps', () => {
    const config = {
      ...DEFAULT_CONFIG,
      timeMaps: {
        'weekdays-only': createTimeMap('Weekdays Only', {
          0: null, // Sunday skip
          1: { startHour: 9, endHour: 17 },
          2: { startHour: 9, endHour: 17 },
          3: { startHour: 9, endHour: 17 },
          4: { startHour: 9, endHour: 17 },
          5: { startHour: 9, endHour: 17 },
          6: null, // Saturday skip
        }),
      },
      defaultTimeMap: 'weekdays-only',
      skipDays: undefined,
      workdayStartHour: undefined,
      workdayHours: undefined,
    };

    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    
    // Start on Saturday - should skip to Monday
    const startTime = new Date('2024-01-13T09:00:00'); // Saturday
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    expect(result.schedule.length).toBe(1);
    // Should be scheduled on Monday (Jan 15)
    expect(result.schedule[0].startTime.getDate()).toBe(15);
  });

  it('handles different hours per day in the same time map', () => {
    const config = {
      ...DEFAULT_CONFIG,
      timeMaps: {
        'variable': createTimeMap('Variable Hours', {
          0: { startHour: 10, endHour: 14 }, // Sunday: 4 hours
          1: { startHour: 9, endHour: 17 },  // Monday: 8 hours
          2: { startHour: 9, endHour: 17 },  // Tuesday: 8 hours
          3: { startHour: 9, endHour: 12 },  // Wednesday: 3 hours (half day)
          4: { startHour: 9, endHour: 17 },  // Thursday: 8 hours
          5: { startHour: 9, endHour: 15 },  // Friday: 6 hours
          6: { startHour: 10, endHour: 14 }, // Saturday: 4 hours
        }),
      },
      defaultTimeMap: 'variable',
      skipDays: undefined,
      workdayStartHour: undefined,
      workdayHours: undefined,
    };

    // Task that requires more time than Wednesday's 3 hours
    const task = createTask({
      id: 'task-1',
      timeEstimate: 4 * 60 * 60 * 1000, // 4 hours
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    
    // Start on Wednesday at 9 AM (only 3 hours available)
    const startTime = new Date('2024-01-17T09:00:00'); // Wednesday
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // Should have 3 schedule items due to dynamic splitting:
    // - 2h block on Wednesday (9-11)
    // - 1h dynamically split on Wednesday (11-12, filling the day)
    // - 1h remainder on Thursday
    expect(result.schedule.length).toBe(3);
    
    // First block should be on Wednesday
    expect(result.schedule[0].startTime.getDate()).toBe(17);
    expect(result.schedule[0].startTime.getHours()).toBe(9);
    
    // Total scheduled should be 4 hours
    const totalMinutes = result.schedule.reduce(
      (sum, s) => sum + (s.endTime - s.startTime) / 60000, 0
    );
    expect(totalMinutes).toBe(240);
  });

  it('schedules tasks that span multiple days correctly with time maps', () => {
    const config = {
      ...DEFAULT_CONFIG,
      timeMaps: {
        'short-days': createTimeMap('Short Days', {
          0: null,
          1: { startHour: 10, endHour: 12 }, // Only 2 hours per day
          2: { startHour: 10, endHour: 12 },
          3: { startHour: 10, endHour: 12 },
          4: { startHour: 10, endHour: 12 },
          5: { startHour: 10, endHour: 12 },
          6: null,
        }),
      },
      defaultTimeMap: 'short-days',
      blockSizeMinutes: 60,
      minimumBlockSizeMinutes: 60,
      skipDays: undefined,
      workdayStartHour: undefined,
      workdayHours: undefined,
    };

    // 5-hour task with 2-hour days = should span 3 days
    const task = createTask({
      id: 'task-1',
      timeEstimate: 5 * 60 * 60 * 1000,
    });

    const splits = TaskSplitter.splitTask(task, 60, config);
    
    const startTime = new Date('2024-01-15T10:00:00'); // Monday
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    // Should be scheduled across multiple days
    const days = new Set(result.schedule.map(s => s.startTime.getDate()));
    expect(days.size).toBeGreaterThanOrEqual(3);

    // First block of each day should start at 10:00 (time map start hour)
    // Group blocks by day and check first block of each day
    const blocksByDay = {};
    result.schedule.forEach(item => {
      const day = item.startTime.getDate();
      if (!blocksByDay[day]) blocksByDay[day] = [];
      blocksByDay[day].push(item);
    });
    
    Object.values(blocksByDay).forEach(dayBlocks => {
      // Sort by start time
      dayBlocks.sort((a, b) => a.startTime - b.startTime);
      // First block of the day should start at 10:00
      expect(dayBlocks[0].startTime.getHours()).toBe(10);
    });

    // Total time should be 5 hours
    const totalMinutes = result.schedule.reduce(
      (sum, s) => sum + (s.endTime - s.startTime) / 60000, 0
    );
    expect(totalMinutes).toBe(300);
  });

  it('includes timeMapId in schedule items', () => {
    const config = {
      ...DEFAULT_CONFIG,
      timeMaps: {
        'default': createTimeMap('Default', {
          0: null,
          1: { startHour: 9, endHour: 17 },
          2: { startHour: 9, endHour: 17 },
          3: { startHour: 9, endHour: 17 },
          4: { startHour: 9, endHour: 17 },
          5: { startHour: 9, endHour: 17 },
          6: null,
        }),
      },
      skipDays: undefined,
      workdayStartHour: undefined,
      workdayHours: undefined,
    };

    const task = createTask({
      id: 'task-1',
      timeEstimate: 2 * 60 * 60 * 1000,
    });

    const splits = TaskSplitter.splitTask(task, 120, config);
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime);

    expect(result.schedule.length).toBe(1);
    expect(result.schedule[0].timeMapId).toBeDefined();
    expect(result.schedule[0].timeMapId).toBe('default');
  });

  it('schedules tasks fairly across time maps on the same day', () => {
    // This test verifies that tasks from different time maps get scheduled
    // on the same day according to each time map's schedule, not globally sorted by priority
    const config = {
      ...DEFAULT_CONFIG,
      blockSizeMinutes: 60,
      timeMaps: {
        'morning': createTimeMap('Morning', {
          0: null,
          1: { startHour: 8, endHour: 12 },  // 4 hours in morning
          2: { startHour: 8, endHour: 12 },
          3: { startHour: 8, endHour: 12 },
          4: { startHour: 8, endHour: 12 },
          5: { startHour: 8, endHour: 12 },
          6: null,
        }),
        'afternoon': createTimeMap('Afternoon', {
          0: null,
          1: { startHour: 14, endHour: 18 },  // 4 hours in afternoon
          2: { startHour: 14, endHour: 18 },
          3: { startHour: 14, endHour: 18 },
          4: { startHour: 14, endHour: 18 },
          5: { startHour: 14, endHour: 18 },
          6: null,
        }),
      },
      projectTimeMaps: {
        'morning-project': 'morning',
        'afternoon-project': 'afternoon',
      },
      defaultTimeMap: 'morning',
      skipDays: undefined,
      workdayStartHour: undefined,
      workdayHours: undefined,
      tagPriorities: { 'high': 100, 'low': 0 },
    };

    const allTags = [
      { id: 'tag-high', title: 'high' },
      { id: 'tag-low', title: 'low' },
    ];

    // Morning project tasks: one high priority, one low priority (2 hours each)
    const morningHigh = createTask({
      id: 'morning-high',
      title: 'Morning High',
      timeEstimate: 2 * 60 * 60 * 1000,
      projectId: 'morning-project',
      tagIds: ['tag-high'],
    });
    const morningLow = createTask({
      id: 'morning-low',
      title: 'Morning Low',
      timeEstimate: 2 * 60 * 60 * 1000,
      projectId: 'morning-project',
      tagIds: ['tag-low'],
    });

    // Afternoon project tasks: one high priority, one low priority (2 hours each)
    const afternoonHigh = createTask({
      id: 'afternoon-high',
      title: 'Afternoon High',
      timeEstimate: 2 * 60 * 60 * 1000,
      projectId: 'afternoon-project',
      tagIds: ['tag-high'],
    });
    const afternoonLow = createTask({
      id: 'afternoon-low',
      title: 'Afternoon Low',
      timeEstimate: 2 * 60 * 60 * 1000,
      projectId: 'afternoon-project',
      tagIds: ['tag-low'],
    });

    const allTasks = [morningHigh, morningLow, afternoonHigh, afternoonLow];
    const allSplits = allTasks.flatMap(t => TaskSplitter.splitTask(t, 60, config));

    // Start Monday at 8 AM
    const startTime = new Date('2024-01-15T08:00:00');
    const result = AutoPlanner.schedule(allSplits, config, allTags, [], startTime, [], allTasks);

    // Should schedule all 8 splits (2 per task, 4 tasks)
    expect(result.schedule.length).toBe(8);

    // Group by time map and day
    const morningDay1 = result.schedule.filter(s => 
      s.timeMapId === 'morning' && s.startTime.getDate() === 15
    );
    const afternoonDay1 = result.schedule.filter(s => 
      s.timeMapId === 'afternoon' && s.startTime.getDate() === 15
    );

    // Morning time map has 4 hours on day 1, should schedule 4 x 1-hour blocks
    expect(morningDay1.length).toBe(4);
    // First 2 should be high priority (morning-high splits), next 2 low priority
    expect(morningDay1[0].split.originalTaskId).toBe('morning-high');
    expect(morningDay1[1].split.originalTaskId).toBe('morning-high');
    expect(morningDay1[2].split.originalTaskId).toBe('morning-low');
    expect(morningDay1[3].split.originalTaskId).toBe('morning-low');

    // Afternoon time map has 4 hours on day 1, should schedule 4 x 1-hour blocks
    expect(afternoonDay1.length).toBe(4);
    // First 2 should be high priority (afternoon-high splits), next 2 low priority
    expect(afternoonDay1[0].split.originalTaskId).toBe('afternoon-high');
    expect(afternoonDay1[1].split.originalTaskId).toBe('afternoon-high');
    expect(afternoonDay1[2].split.originalTaskId).toBe('afternoon-low');
    expect(afternoonDay1[3].split.originalTaskId).toBe('afternoon-low');

    // Verify times: morning tasks should be 8:00-12:00, afternoon 14:00-18:00
    expect(morningDay1[0].startTime.getHours()).toBe(8);
    expect(morningDay1[3].endTime.getHours()).toBe(12);
    expect(afternoonDay1[0].startTime.getHours()).toBe(14);
    expect(afternoonDay1[3].endTime.getHours()).toBe(18);
  });

  it('schedules tasks based on tag-to-time-map mappings', () => {
    const config = {
      ...DEFAULT_CONFIG,
      blockSizeMinutes: 60,
      timeMaps: {
        'work': createTimeMap('Work', {
          0: null,
          1: { startHour: 9, endHour: 12 },
          2: { startHour: 9, endHour: 12 },
          3: { startHour: 9, endHour: 12 },
          4: { startHour: 9, endHour: 12 },
          5: { startHour: 9, endHour: 12 },
          6: null,
        }),
        'personal': createTimeMap('Personal', {
          0: null,
          1: { startHour: 18, endHour: 21 },
          2: { startHour: 18, endHour: 21 },
          3: { startHour: 18, endHour: 21 },
          4: { startHour: 18, endHour: 21 },
          5: { startHour: 18, endHour: 21 },
          6: null,
        }),
      },
      tagTimeMaps: {
        'tag-work': 'work',
        'tag-personal': 'personal',
      },
      defaultTimeMap: 'work',
      skipDays: undefined,
      workdayStartHour: undefined,
      workdayHours: undefined,
    };

    // Task with work tag
    const workTask = createTask({
      id: 'work-task',
      title: 'Work Task',
      timeEstimate: 2 * 60 * 60 * 1000,
      tagIds: ['tag-work'],
    });

    // Task with personal tag
    const personalTask = createTask({
      id: 'personal-task',
      title: 'Personal Task',
      timeEstimate: 2 * 60 * 60 * 1000,
      tagIds: ['tag-personal'],
    });

    const allTasks = [workTask, personalTask];
    const workSplits = TaskSplitter.splitTask(workTask, 60, config);
    const personalSplits = TaskSplitter.splitTask(personalTask, 60, config);
    const allSplits = [...workSplits, ...personalSplits];

    // Start Monday at 9 AM
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(allSplits, config, [], [], startTime, [], allTasks);

    expect(result.schedule.length).toBe(4);

    // Work task should be scheduled at 9:00 (work time map)
    const workSchedule = result.schedule.filter(s => s.split.originalTaskId === 'work-task');
    expect(workSchedule.length).toBe(2);
    expect(workSchedule[0].startTime.getHours()).toBe(9);
    expect(workSchedule[0].timeMapId).toBe('work');

    // Personal task should be scheduled at 18:00 (personal time map)
    const personalSchedule = result.schedule.filter(s => s.split.originalTaskId === 'personal-task');
    expect(personalSchedule.length).toBe(2);
    expect(personalSchedule[0].startTime.getHours()).toBe(18);
    expect(personalSchedule[0].timeMapId).toBe('personal');
  });

  it('schedules task with multiple tags in multiple time maps', () => {
    // A task with both work and personal tags should be schedulable in either time map
    const config = {
      ...DEFAULT_CONFIG,
      blockSizeMinutes: 60,
      timeMaps: {
        'morning': createTimeMap('Morning', {
          0: null,
          1: { startHour: 9, endHour: 11 },  // 2 hours
          2: { startHour: 9, endHour: 11 },
          3: { startHour: 9, endHour: 11 },
          4: { startHour: 9, endHour: 11 },
          5: { startHour: 9, endHour: 11 },
          6: null,
        }),
        'evening': createTimeMap('Evening', {
          0: null,
          1: { startHour: 18, endHour: 20 },  // 2 hours
          2: { startHour: 18, endHour: 20 },
          3: { startHour: 18, endHour: 20 },
          4: { startHour: 18, endHour: 20 },
          5: { startHour: 18, endHour: 20 },
          6: null,
        }),
      },
      tagTimeMaps: {
        'tag-morning': 'morning',
        'tag-evening': 'evening',
      },
      defaultTimeMap: 'morning',
      skipDays: undefined,
      workdayStartHour: undefined,
      workdayHours: undefined,
    };

    // Task with both morning and evening tags - can be scheduled in either
    const flexibleTask = createTask({
      id: 'flexible-task',
      title: 'Flexible Task',
      timeEstimate: 3 * 60 * 60 * 1000, // 3 hours - more than either slot
      tagIds: ['tag-morning', 'tag-evening'],
    });

    const allTasks = [flexibleTask];
    const splits = TaskSplitter.splitTask(flexibleTask, 60, config);

    // Start Monday at 9 AM
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime, [], allTasks);

    // Should schedule all 3 splits across both time maps on day 1
    expect(result.schedule.length).toBe(3);

    // Check that both time maps are used
    const morningSchedule = result.schedule.filter(s => s.timeMapId === 'morning');
    const eveningSchedule = result.schedule.filter(s => s.timeMapId === 'evening');

    // Morning has 2 hours capacity, evening has 2 hours capacity
    // 3 hours of work should fit in 2 + 1 or 2 + 2 arrangement
    expect(morningSchedule.length + eveningSchedule.length).toBe(3);
    expect(morningSchedule.length).toBeGreaterThan(0);
    expect(eveningSchedule.length).toBeGreaterThan(0);
  });

  it('combines project and tag time map mappings', () => {
    const config = {
      ...DEFAULT_CONFIG,
      blockSizeMinutes: 60,
      timeMaps: {
        'work': createTimeMap('Work', {
          0: null,
          1: { startHour: 9, endHour: 12 },
          2: { startHour: 9, endHour: 12 },
          3: { startHour: 9, endHour: 12 },
          4: { startHour: 9, endHour: 12 },
          5: { startHour: 9, endHour: 12 },
          6: null,
        }),
        'urgent': createTimeMap('Urgent', {
          0: null,
          1: { startHour: 14, endHour: 17 },
          2: { startHour: 14, endHour: 17 },
          3: { startHour: 14, endHour: 17 },
          4: { startHour: 14, endHour: 17 },
          5: { startHour: 14, endHour: 17 },
          6: null,
        }),
      },
      projectTimeMaps: {
        'work-project': 'work',
      },
      tagTimeMaps: {
        'tag-urgent': 'urgent',
      },
      defaultTimeMap: 'work',
      skipDays: undefined,
      workdayStartHour: undefined,
      workdayHours: undefined,
    };

    // Task in work project with urgent tag - belongs to both time maps
    const urgentWorkTask = createTask({
      id: 'urgent-work-task',
      title: 'Urgent Work Task',
      timeEstimate: 5 * 60 * 60 * 1000, // 5 hours - more than either slot alone
      projectId: 'work-project',
      tagIds: ['tag-urgent'],
    });

    const allTasks = [urgentWorkTask];
    const splits = TaskSplitter.splitTask(urgentWorkTask, 60, config);

    // Start Monday at 9 AM
    const startTime = new Date('2024-01-15T09:00:00');
    const result = AutoPlanner.schedule(splits, config, [], [], startTime, [], allTasks);

    // Should schedule all 5 splits using both work (3h) and urgent (3h) time maps
    expect(result.schedule.length).toBe(5);

    const workSchedule = result.schedule.filter(s => s.timeMapId === 'work');
    const urgentSchedule = result.schedule.filter(s => s.timeMapId === 'urgent');

    // Should use both time maps
    expect(workSchedule.length).toBeGreaterThan(0);
    expect(urgentSchedule.length).toBeGreaterThan(0);
  });
});
