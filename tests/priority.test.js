/**
 * Tests for PriorityCalculator module
 */

import { describe, it, expect } from 'vitest';
import { PriorityCalculator, getRemainingHours } from '../src/core.js';

// Helper to create a task
function createTask(overrides = {}) {
  return {
    id: 'task-1',
    title: 'Test Task',
    timeEstimate: 2 * 60 * 60 * 1000, // 2 hours
    timeSpent: 0,
    tagIds: [],
    created: Date.now() - 5 * 24 * 60 * 60 * 1000, // 5 days ago
    isDone: false,
    ...overrides,
  };
}

describe('PriorityCalculator.calculateTagPriority', () => {
  const allTags = [
    { id: 'tag-urgent', name: 'urgent' },
    { id: 'tag-work', name: 'work' },
    { id: 'tag-personal', name: 'personal' },
  ];

  const tagPriorities = {
    urgent: 10,
    work: 5,
    personal: -2,
  };

  it('calculates tag boost correctly', () => {
    const task = createTask({ tagIds: ['tag-urgent'] });
    expect(PriorityCalculator.calculateTagPriority(task, tagPriorities, allTags)).toBe(10);
  });

  it('sums multiple tag boosts', () => {
    const task = createTask({ tagIds: ['tag-urgent', 'tag-work'] });
    expect(PriorityCalculator.calculateTagPriority(task, tagPriorities, allTags)).toBe(15);
  });

  it('handles negative tag boosts', () => {
    const task = createTask({ tagIds: ['tag-personal'] });
    expect(PriorityCalculator.calculateTagPriority(task, tagPriorities, allTags)).toBe(-2);
  });

  it('returns 0 for task with no tags', () => {
    const task = createTask({ tagIds: [] });
    expect(PriorityCalculator.calculateTagPriority(task, tagPriorities, allTags)).toBe(0);
  });

  it('returns 0 for undefined tagIds', () => {
    const task = createTask();
    delete task.tagIds;
    expect(PriorityCalculator.calculateTagPriority(task, tagPriorities, allTags)).toBe(0);
  });

  it('ignores tags not in priority config', () => {
    const task = createTask({ tagIds: ['tag-unknown'] });
    const unknownTags = [{ id: 'tag-unknown', name: 'unknown' }];
    expect(PriorityCalculator.calculateTagPriority(task, tagPriorities, unknownTags)).toBe(0);
  });

  it('handles null/undefined tagPriorities', () => {
    const task = createTask({ tagIds: ['tag-urgent'] });
    expect(PriorityCalculator.calculateTagPriority(task, null, allTags)).toBe(0);
    expect(PriorityCalculator.calculateTagPriority(task, undefined, allTags)).toBe(0);
  });
});

describe('PriorityCalculator.calculateProjectPriority', () => {
  const allProjects = [
    { id: 'proj-work', title: 'Work' },
    { id: 'proj-personal', title: 'Personal' },
    { id: 'proj-someday', title: 'Someday' },
  ];

  const projectPriorities = {
    Work: 15,
    Personal: 5,
    Someday: -10,
  };

  it('calculates project boost correctly', () => {
    const task = createTask({ projectId: 'proj-work' });
    expect(PriorityCalculator.calculateProjectPriority(task, projectPriorities, allProjects)).toBe(15);
  });

  it('handles negative project boosts', () => {
    const task = createTask({ projectId: 'proj-someday' });
    expect(PriorityCalculator.calculateProjectPriority(task, projectPriorities, allProjects)).toBe(-10);
  });

  it('returns 0 for task with no project', () => {
    const task = createTask({ projectId: null });
    expect(PriorityCalculator.calculateProjectPriority(task, projectPriorities, allProjects)).toBe(0);
  });

  it('returns 0 for undefined projectId', () => {
    const task = createTask();
    delete task.projectId;
    expect(PriorityCalculator.calculateProjectPriority(task, projectPriorities, allProjects)).toBe(0);
  });

  it('ignores projects not in priority config', () => {
    const task = createTask({ projectId: 'proj-unknown' });
    const unknownProjects = [{ id: 'proj-unknown', title: 'Unknown Project' }];
    expect(PriorityCalculator.calculateProjectPriority(task, projectPriorities, unknownProjects)).toBe(0);
  });

  it('handles null/undefined projectPriorities', () => {
    const task = createTask({ projectId: 'proj-work' });
    expect(PriorityCalculator.calculateProjectPriority(task, null, allProjects)).toBe(0);
    expect(PriorityCalculator.calculateProjectPriority(task, undefined, allProjects)).toBe(0);
  });

  it('handles empty allProjects array', () => {
    const task = createTask({ projectId: 'proj-work' });
    expect(PriorityCalculator.calculateProjectPriority(task, projectPriorities, [])).toBe(0);
  });
});

describe('PriorityCalculator.calculateDurationPriority', () => {
  it('calculates linear duration priority', () => {
    const task = createTask({ timeEstimate: 4 * 60 * 60 * 1000 }); // 4 hours
    // Linear: hours * weight = 4 * 1 = 4
    expect(PriorityCalculator.calculateDurationPriority(task, 'linear', 1)).toBe(4);
  });

  it('calculates inverse duration priority (shorter = higher)', () => {
    const task = createTask({ timeEstimate: 1 * 60 * 60 * 1000 }); // 1 hour
    // Inverse: 1/(hours+1) * weight = 1/(1+1) * 1 = 0.5
    expect(PriorityCalculator.calculateDurationPriority(task, 'inverse', 1)).toBe(0.5);
  });

  it('calculates log duration priority', () => {
    const task = createTask({ timeEstimate: 2 * 60 * 60 * 1000 }); // 2 hours
    // Log: log(hours+1) * weight = log(3) ≈ 1.099
    const result = PriorityCalculator.calculateDurationPriority(task, 'log', 1);
    expect(result).toBeCloseTo(Math.log(3), 5);
  });

  it('returns 0 for formula = none', () => {
    const task = createTask({ timeEstimate: 4 * 60 * 60 * 1000 });
    expect(PriorityCalculator.calculateDurationPriority(task, 'none', 1)).toBe(0);
  });

  it('returns 0 for zero remaining hours', () => {
    const task = createTask({
      timeEstimate: 1 * 60 * 60 * 1000,
      timeSpent: 1 * 60 * 60 * 1000,
    });
    expect(PriorityCalculator.calculateDurationPriority(task, 'linear', 1)).toBe(0);
  });

  it('applies weight correctly', () => {
    const task = createTask({ timeEstimate: 2 * 60 * 60 * 1000 });
    expect(PriorityCalculator.calculateDurationPriority(task, 'linear', 2)).toBe(4);
    expect(PriorityCalculator.calculateDurationPriority(task, 'linear', 0.5)).toBe(1);
  });

  it('returns 0 for zero weight', () => {
    const task = createTask({ timeEstimate: 2 * 60 * 60 * 1000 });
    expect(PriorityCalculator.calculateDurationPriority(task, 'linear', 0)).toBe(0);
  });
});

describe('PriorityCalculator.calculateOldnessPriority', () => {
  it('calculates linear oldness priority', () => {
    const now = new Date('2024-01-15');
    const task = createTask({ created: new Date('2024-01-10').getTime() }); // 5 days old
    expect(PriorityCalculator.calculateOldnessPriority(task, 'linear', 1, now)).toBe(5);
  });

  it('calculates log oldness priority', () => {
    const now = new Date('2024-01-15');
    const task = createTask({ created: new Date('2024-01-10').getTime() }); // 5 days old
    const result = PriorityCalculator.calculateOldnessPriority(task, 'log', 1, now);
    expect(result).toBeCloseTo(Math.log(6), 5);
  });

  it('calculates exponential oldness with cap', () => {
    const now = new Date('2024-01-15');
    const task = createTask({ created: new Date('2024-01-10').getTime() }); // 5 days old
    const result = PriorityCalculator.calculateOldnessPriority(task, 'exponential', 1, now);
    expect(result).toBeCloseTo(Math.pow(1.1, 5), 5);
  });

  it('caps exponential at 100 days to prevent overflow', () => {
    const now = new Date('2024-06-01');
    const task = createTask({ created: new Date('2024-01-01').getTime() }); // ~150 days old
    const result = PriorityCalculator.calculateOldnessPriority(task, 'exponential', 1, now);
    // Should be capped at 1.1^100, not 1.1^150
    expect(result).toBeCloseTo(Math.pow(1.1, 100), 0);
    expect(result).toBeLessThan(20000); // Sanity check
  });

  it('returns 0 for formula = none', () => {
    const now = new Date('2024-01-15');
    const task = createTask({ created: new Date('2024-01-10').getTime() });
    expect(PriorityCalculator.calculateOldnessPriority(task, 'none', 1, now)).toBe(0);
  });

  it('returns 0 for task without created date', () => {
    const task = createTask();
    delete task.created;
    expect(PriorityCalculator.calculateOldnessPriority(task, 'linear', 1)).toBe(0);
  });

  it('returns 0 for zero weight', () => {
    const now = new Date('2024-01-15');
    const task = createTask({ created: new Date('2024-01-10').getTime() });
    expect(PriorityCalculator.calculateOldnessPriority(task, 'linear', 0, now)).toBe(0);
  });
});

describe('PriorityCalculator.calculateUrgency', () => {
  const allTags = [{ id: 'tag-1', name: 'urgent' }];
  const allProjects = [{ id: 'proj-1', title: 'Work' }];
  const config = {
    tagPriorities: { urgent: 10 },
    projectPriorities: { Work: 5 },
    durationFormula: 'linear',
    durationWeight: 1,
    oldnessFormula: 'linear',
    oldnessWeight: 1,
  };

  it('combines all priority components including project', () => {
    const now = new Date('2024-01-15');
    const task = createTask({
      id: 'task-1',
      tagIds: ['tag-1'],
      projectId: 'proj-1',
      timeEstimate: 2 * 60 * 60 * 1000, // 2 hours
      created: new Date('2024-01-10').getTime(), // 5 days ago
    });

    const result = PriorityCalculator.calculateUrgency(task, config, allTags, allProjects, now);

    expect(result.components.tag).toBe(10);
    expect(result.components.project).toBe(5);
    expect(result.components.duration).toBe(2);
    expect(result.components.oldness).toBe(5);
    expect(result.total).toBe(10 + 5 + 2 + 5); // 22
  });

  it('handles missing config properties with defaults', () => {
    const task = createTask({ id: 'task-1' });
    const minimalConfig = {};

    const result = PriorityCalculator.calculateUrgency(task, minimalConfig, [], []);
    
    // With 'none' as default for formulas, duration and oldness should be 0
    expect(result.total).toBe(0);
    expect(result.components.project).toBe(0);
  });

  it('works without project priority', () => {
    const now = new Date('2024-01-15');
    const task = createTask({
      id: 'task-1',
      tagIds: ['tag-1'],
      timeEstimate: 2 * 60 * 60 * 1000,
      created: new Date('2024-01-10').getTime(), // 5 days before 'now'
    });
    const configWithoutProjects = { ...config };
    delete configWithoutProjects.projectPriorities;

    const result = PriorityCalculator.calculateUrgency(task, configWithoutProjects, allTags, [], now);

    expect(result.components.project).toBe(0);
    expect(result.total).toBe(10 + 2 + 5); // 17
  });
});
