/**
 * Tests for TaskSplitter module
 */

import { describe, it, expect } from 'vitest';
import { TaskSplitter, DEFAULT_CONFIG, getRealTagIds, getVirtualTagIds, getEffectiveTagIds } from '../src/core.js';

// Helper to create a task
function createTask(overrides = {}) {
  return {
    id: 'task-1',
    title: 'Test Task',
    timeEstimate: 4 * 60 * 60 * 1000, // 4 hours
    timeSpent: 0,
    tagIds: ['tag-1'],
    projectId: 'project-1',
    parentId: null,
    created: Date.now(),
    isDone: false,
    notes: '',
    ...overrides,
  };
}

describe('TaskSplitter.splitTask', () => {
  const config = { ...DEFAULT_CONFIG, splitSuffix: true };

  it('splits a 4-hour task into 2 blocks (default 2h blocks)', () => {
    const task = createTask({ timeEstimate: 4 * 60 * 60 * 1000 });
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits).toHaveLength(2);
    expect(splits[0].estimatedHours).toBe(2);
    expect(splits[1].estimatedHours).toBe(2);
  });

  it('handles tasks smaller than block size', () => {
    const task = createTask({ timeEstimate: 1 * 60 * 60 * 1000 }); // 1 hour
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits).toHaveLength(1);
    expect(splits[0].estimatedHours).toBe(1);
  });

  it('handles partial last block', () => {
    const task = createTask({ timeEstimate: 5 * 60 * 60 * 1000 }); // 5 hours
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits).toHaveLength(3);
    expect(splits[0].estimatedHours).toBe(2);
    expect(splits[1].estimatedHours).toBe(2);
    expect(splits[2].estimatedHours).toBe(1);
  });

  it('adds Roman numeral suffixes', () => {
    const task = createTask({ timeEstimate: 6 * 60 * 60 * 1000 }); // 6 hours
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits[0].title).toBe('Test Task <I>');
    expect(splits[1].title).toBe('Test Task <II>');
    expect(splits[2].title).toBe('Test Task <III>');
  });

  it('respects splitSuffix = false', () => {
    const noSuffixConfig = { ...config, splitSuffix: false };
    const task = createTask({ timeEstimate: 4 * 60 * 60 * 1000 });
    const splits = TaskSplitter.splitTask(task, 120, noSuffixConfig);

    expect(splits[0].title).toBe('Test Task');
    expect(splits[1].title).toBe('Test Task');
  });

  it('applies splitPrefix', () => {
    const prefixConfig = { ...config, splitPrefix: '[SPLIT] ' };
    const task = createTask({ timeEstimate: 2 * 60 * 60 * 1000 });
    const splits = TaskSplitter.splitTask(task, 120, prefixConfig);

    expect(splits[0].title).toBe('[SPLIT] Test Task <I>');
  });

  it('preserves task metadata', () => {
    const task = createTask({
      id: 'my-task',
      tagIds: ['tag-a', 'tag-b'],
      projectId: 'proj-123',
      parentId: null, // Use null so no virtual tags expected
    });
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits[0].originalTaskId).toBe('my-task');
    expect(splits[0].tagIds).toEqual(['tag-a', 'tag-b']);
    expect(splits[0].realTagIds).toEqual(['tag-a', 'tag-b']);
    expect(splits[0].virtualTagIds).toEqual([]);
    expect(splits[0].projectId).toBe('proj-123');
    expect(splits[0].parentId).toBe(null);
  });

  it('sets correct split indices and links', () => {
    const task = createTask({ timeEstimate: 6 * 60 * 60 * 1000 });
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits[0].splitIndex).toBe(0);
    expect(splits[0].totalSplits).toBe(3);
    expect(splits[0].prevSplitIndex).toBe(null);
    expect(splits[0].nextSplitIndex).toBe(1);

    expect(splits[1].splitIndex).toBe(1);
    expect(splits[1].prevSplitIndex).toBe(0);
    expect(splits[1].nextSplitIndex).toBe(2);

    expect(splits[2].splitIndex).toBe(2);
    expect(splits[2].prevSplitIndex).toBe(1);
    expect(splits[2].nextSplitIndex).toBe(null);
  });

  it('returns empty array for task with no remaining time', () => {
    const task = createTask({
      timeEstimate: 2 * 60 * 60 * 1000,
      timeSpent: 2 * 60 * 60 * 1000,
    });
    const splits = TaskSplitter.splitTask(task, 120, config);
    expect(splits).toHaveLength(0);
  });

  it('first split includes timeSpent plus one block for partially worked task', () => {
    // 5 hour task with 1.5 hours already worked, 2 hour blocks
    // Expected: first split = 1.5h (spent) + 2h (block) = 3.5h
    //           second split = 5h - 3.5h = 1.5h
    const task = createTask({
      timeEstimate: 5 * 60 * 60 * 1000, // 5 hours
      timeSpent: 1.5 * 60 * 60 * 1000,  // 1.5 hours already worked
    });
    const splits = TaskSplitter.splitTask(task, 120, config); // 2 hour blocks

    expect(splits).toHaveLength(2);
    // First split: timeSpent (1.5h) + blockSize (2h) = 3.5h
    expect(splits[0].estimatedHours).toBe(3.5);
    expect(splits[0].timeSpentMs).toBe(1.5 * 60 * 60 * 1000);
    // Second split: remaining = 5h - 3.5h = 1.5h
    expect(splits[1].estimatedHours).toBe(1.5);
    expect(splits[1].timeSpentMs).toBe(0);
  });

  it('first split includes timeSpent that exceeds block size', () => {
    // 6 hour task with 2.5 hours already worked, 2 hour blocks
    // First block should be 2.5h (spent) + 2h = 4.5h
    // Second block = 6h - 4.5h = 1.5h
    const task = createTask({
      timeEstimate: 6 * 60 * 60 * 1000, // 6 hours
      timeSpent: 2.5 * 60 * 60 * 1000,  // 2.5 hours already worked
    });
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits).toHaveLength(2);
    expect(splits[0].estimatedHours).toBe(4.5);
    expect(splits[0].timeSpentMs).toBe(2.5 * 60 * 60 * 1000);
    expect(splits[1].estimatedHours).toBe(1.5);
  });

  it('handles task where timeSpent plus one block exceeds total estimate', () => {
    // 3 hour task with 2.5 hours worked, 2 hour blocks
    // Since 2.5h + 2h = 4.5h > 3h, first split should be the full task
    const task = createTask({
      timeEstimate: 3 * 60 * 60 * 1000, // 3 hours
      timeSpent: 2.5 * 60 * 60 * 1000,  // 2.5 hours worked
    });
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits).toHaveLength(1);
    expect(splits[0].estimatedHours).toBe(3);
    expect(splits[0].timeSpentMs).toBe(2.5 * 60 * 60 * 1000);
  });

  it('returns empty array for task with more time spent than estimated', () => {
    const task = createTask({
      timeEstimate: 2 * 60 * 60 * 1000,
      timeSpent: 3 * 60 * 60 * 1000,
    });
    const splits = TaskSplitter.splitTask(task, 120, config);
    expect(splits).toHaveLength(0);
  });

  it('handles zero/negative block size by using default', () => {
    const task = createTask({ timeEstimate: 4 * 60 * 60 * 1000 });
    
    const splits0 = TaskSplitter.splitTask(task, 0, config);
    expect(splits0).toHaveLength(2); // Uses default 120 min
    
    const splitsNeg = TaskSplitter.splitTask(task, -60, config);
    expect(splitsNeg).toHaveLength(2);
  });
});

describe('TaskSplitter.isAlreadyProcessed', () => {
  it('detects tasks already processed by AutoPlan', () => {
    const processed = createTask({
      notes: 'Some notes\n\n[AutoPlan] This task was split.',
    });
    expect(TaskSplitter.isAlreadyProcessed(processed)).toBe(true);
  });

  it('returns false for unprocessed tasks', () => {
    const unprocessed = createTask({ notes: 'Regular notes' });
    expect(TaskSplitter.isAlreadyProcessed(unprocessed)).toBe(false);
  });

  it('handles tasks without notes', () => {
    const noNotes = createTask({ notes: null });
    expect(TaskSplitter.isAlreadyProcessed(noNotes)).toBe(false);
  });
});

describe('TaskSplitter.processAllTasks', () => {
  const config = { ...DEFAULT_CONFIG, splitSuffix: true };

  it('processes multiple tasks', () => {
    const tasks = [
      createTask({ id: 'task-1', timeEstimate: 4 * 60 * 60 * 1000 }),
      createTask({ id: 'task-2', timeEstimate: 2 * 60 * 60 * 1000 }),
    ];

    const { splits, skippedParents, alreadyProcessed } = 
      TaskSplitter.processAllTasks(tasks, 120, config);

    expect(splits).toHaveLength(3); // 2 splits from task-1, 1 from task-2
    expect(skippedParents).toHaveLength(0);
    expect(alreadyProcessed).toHaveLength(0);
  });

  it('skips parent tasks with subtasks', () => {
    const tasks = [
      createTask({ id: 'parent', timeEstimate: 4 * 60 * 60 * 1000 }),
      createTask({ id: 'child', parentId: 'parent', timeEstimate: 2 * 60 * 60 * 1000 }),
    ];

    const { splits, skippedParents } = TaskSplitter.processAllTasks(tasks, 120, config);

    expect(splits).toHaveLength(1); // Only child task
    expect(skippedParents).toHaveLength(1);
    expect(skippedParents[0].id).toBe('parent');
  });

  it('skips completed tasks', () => {
    const tasks = [
      createTask({ id: 'task-1', isDone: true, timeEstimate: 4 * 60 * 60 * 1000 }),
      createTask({ id: 'task-2', isDone: false, timeEstimate: 2 * 60 * 60 * 1000 }),
    ];

    const { splits } = TaskSplitter.processAllTasks(tasks, 120, config);
    expect(splits).toHaveLength(1);
    expect(splits[0].originalTaskId).toBe('task-2');
  });

  it('skips already processed tasks', () => {
    const tasks = [
      createTask({
        id: 'task-1',
        timeEstimate: 4 * 60 * 60 * 1000,
        notes: '[AutoPlan] Already processed',
      }),
      createTask({ id: 'task-2', timeEstimate: 2 * 60 * 60 * 1000 }),
    ];

    const { splits, alreadyProcessed } = TaskSplitter.processAllTasks(tasks, 120, config);

    expect(splits).toHaveLength(1);
    expect(alreadyProcessed).toHaveLength(1);
    expect(alreadyProcessed[0].id).toBe('task-1');
  });

  it('handles empty task list', () => {
    const { splits, skippedParents, alreadyProcessed } = 
      TaskSplitter.processAllTasks([], 120, config);

    expect(splits).toHaveLength(0);
    expect(skippedParents).toHaveLength(0);
    expect(alreadyProcessed).toHaveLength(0);
  });

  it('skips tasks without time estimate', () => {
    const tasks = [
      createTask({ id: 'task-1', timeEstimate: 0 }),
      createTask({ id: 'task-2', timeEstimate: 2 * 60 * 60 * 1000 }),
    ];

    const { splits } = TaskSplitter.processAllTasks(tasks, 120, config);
    expect(splits).toHaveLength(1);
    expect(splits[0].originalTaskId).toBe('task-2');
  });
});

// ============================================================================
// REAL vs VIRTUAL TAGS TESTS
// ============================================================================

describe('getRealTagIds', () => {
  it('returns the task own tagIds', () => {
    const task = createTask({ tagIds: ['tag-a', 'tag-b'] });
    expect(getRealTagIds(task)).toEqual(['tag-a', 'tag-b']);
  });

  it('returns empty array for task without tags', () => {
    const task = createTask({ tagIds: undefined });
    expect(getRealTagIds(task)).toEqual([]);
  });

  it('returns empty array for null tagIds', () => {
    const task = createTask({ tagIds: null });
    expect(getRealTagIds(task)).toEqual([]);
  });

  it('includes subTaskIds for subtasks (SP API quirk)', () => {
    // SP stores subtask tags in subTaskIds when added via API
    const subtask = createTask({ 
      id: 'subtask',
      tagIds: ['tag-a'],
      subTaskIds: ['tag-b', 'tag-c'],
      parentId: 'parent'
    });
    const realTags = getRealTagIds(subtask);
    expect(realTags).toContain('tag-a');
    expect(realTags).toContain('tag-b');
    expect(realTags).toContain('tag-c');
    expect(realTags).toHaveLength(3);
  });

  it('deduplicates tags from tagIds and subTaskIds', () => {
    const subtask = createTask({ 
      id: 'subtask',
      tagIds: ['tag-a', 'tag-b'],
      subTaskIds: ['tag-b', 'tag-c'], // tag-b is duplicated
      parentId: 'parent'
    });
    const realTags = getRealTagIds(subtask);
    expect(realTags).toContain('tag-a');
    expect(realTags).toContain('tag-b');
    expect(realTags).toContain('tag-c');
    expect(realTags).toHaveLength(3); // No duplicates
  });

  it('ignores subTaskIds for non-subtasks (no parentId)', () => {
    // subTaskIds should only be considered for actual subtasks
    const task = createTask({ 
      id: 'task',
      tagIds: ['tag-a'],
      subTaskIds: ['tag-b'], // Should be ignored for non-subtasks
      parentId: null
    });
    const realTags = getRealTagIds(task);
    expect(realTags).toEqual(['tag-a']);
  });
});

describe('getVirtualTagIds', () => {
  it('returns empty array for task without parent', () => {
    const task = createTask({ id: 'task-1', parentId: null, tagIds: ['tag-own'] });
    const allTasks = [task];
    expect(getVirtualTagIds(task, allTasks)).toEqual([]);
  });

  it('returns parent tags for subtask', () => {
    const parent = createTask({ id: 'parent', tagIds: ['tag-parent'], parentId: null });
    const subtask = createTask({ id: 'subtask', tagIds: ['tag-own'], parentId: 'parent' });
    const allTasks = [parent, subtask];

    const virtualTags = getVirtualTagIds(subtask, allTasks);
    expect(virtualTags).toEqual(['tag-parent']);
  });

  it('returns grandparent tags for nested subtask', () => {
    const grandparent = createTask({ id: 'grandparent', tagIds: ['tag-grandparent'], parentId: null });
    const parent = createTask({ id: 'parent', tagIds: ['tag-parent'], parentId: 'grandparent' });
    const subtask = createTask({ id: 'subtask', tagIds: ['tag-own'], parentId: 'parent' });
    const allTasks = [grandparent, parent, subtask];

    const virtualTags = getVirtualTagIds(subtask, allTasks);
    // Should include both parent and grandparent tags
    expect(virtualTags).toContain('tag-parent');
    expect(virtualTags).toContain('tag-grandparent');
    expect(virtualTags).toHaveLength(2);
  });

  it('returns empty array when allTasks is empty', () => {
    const subtask = createTask({ id: 'subtask', tagIds: ['tag-own'], parentId: 'parent' });
    expect(getVirtualTagIds(subtask, [])).toEqual([]);
  });

  it('returns empty array when parent not found', () => {
    const subtask = createTask({ id: 'subtask', tagIds: ['tag-own'], parentId: 'nonexistent' });
    const allTasks = [subtask];
    expect(getVirtualTagIds(subtask, allTasks)).toEqual([]);
  });
});

describe('getEffectiveTagIds', () => {
  it('returns own tags for task without parent', () => {
    const task = createTask({ id: 'task-1', tagIds: ['tag-a', 'tag-b'], parentId: null });
    const allTasks = [task];
    const effective = getEffectiveTagIds(task, allTasks);
    expect(effective).toContain('tag-a');
    expect(effective).toContain('tag-b');
    expect(effective).toHaveLength(2);
  });

  it('combines own and parent tags for subtask', () => {
    const parent = createTask({ id: 'parent', tagIds: ['tag-parent'], parentId: null });
    const subtask = createTask({ id: 'subtask', tagIds: ['tag-own'], parentId: 'parent' });
    const allTasks = [parent, subtask];

    const effective = getEffectiveTagIds(subtask, allTasks);
    expect(effective).toContain('tag-own');
    expect(effective).toContain('tag-parent');
    expect(effective).toHaveLength(2);
  });

  it('deduplicates when subtask has same tag as parent', () => {
    const parent = createTask({ id: 'parent', tagIds: ['shared-tag', 'tag-parent'], parentId: null });
    const subtask = createTask({ id: 'subtask', tagIds: ['shared-tag', 'tag-own'], parentId: 'parent' });
    const allTasks = [parent, subtask];

    const effective = getEffectiveTagIds(subtask, allTasks);
    expect(effective).toContain('shared-tag');
    expect(effective).toContain('tag-own');
    expect(effective).toContain('tag-parent');
    expect(effective).toHaveLength(3); // No duplicates
  });
});

describe('TaskSplitter.splitTask with subtask tags', () => {
  const config = { ...DEFAULT_CONFIG, splitSuffix: true };

  it('splits include realTagIds and virtualTagIds for standalone task', () => {
    const task = createTask({ id: 'task-1', tagIds: ['tag-a', 'tag-b'], parentId: null });
    const allTasks = [task];
    const splits = TaskSplitter.splitTask(task, 120, config, allTasks);

    expect(splits[0].realTagIds).toEqual(['tag-a', 'tag-b']);
    expect(splits[0].virtualTagIds).toEqual([]);
    expect(splits[0].tagIds).toEqual(['tag-a', 'tag-b']);
  });

  it('splits include parent tags as virtualTagIds for subtask', () => {
    const parent = createTask({ id: 'parent', tagIds: ['tag-parent'], parentId: null });
    const subtask = createTask({ 
      id: 'subtask', 
      tagIds: ['tag-own'], 
      parentId: 'parent',
      timeEstimate: 4 * 60 * 60 * 1000 
    });
    const allTasks = [parent, subtask];
    const splits = TaskSplitter.splitTask(subtask, 120, config, allTasks);

    // All splits should have the same tag structure
    for (const split of splits) {
      expect(split.realTagIds).toEqual(['tag-own']);
      expect(split.virtualTagIds).toEqual(['tag-parent']);
      // Combined tagIds should include both
      expect(split.tagIds).toContain('tag-own');
      expect(split.tagIds).toContain('tag-parent');
      expect(split.tagIds).toHaveLength(2);
    }
  });

  it('preserves tags correctly across all splits of a subtask', () => {
    const parent = createTask({ id: 'parent', tagIds: ['tag-parent-1', 'tag-parent-2'], parentId: null });
    const subtask = createTask({ 
      id: 'subtask', 
      tagIds: ['tag-own'], 
      parentId: 'parent',
      timeEstimate: 6 * 60 * 60 * 1000 // 6 hours = 3 splits
    });
    const allTasks = [parent, subtask];
    const splits = TaskSplitter.splitTask(subtask, 120, config, allTasks);

    expect(splits).toHaveLength(3);

    // Each split should have identical tag info
    for (let i = 0; i < splits.length; i++) {
      expect(splits[i].realTagIds).toEqual(['tag-own']);
      expect(splits[i].virtualTagIds).toContain('tag-parent-1');
      expect(splits[i].virtualTagIds).toContain('tag-parent-2');
      expect(splits[i].virtualTagIds).toHaveLength(2);
    }
  });

  it('handles deeply nested subtasks with inherited tags', () => {
    const grandparent = createTask({ id: 'gp', tagIds: ['tag-gp'], parentId: null });
    const parent = createTask({ id: 'parent', tagIds: ['tag-parent'], parentId: 'gp' });
    const subtask = createTask({ 
      id: 'subtask', 
      tagIds: ['tag-own'], 
      parentId: 'parent',
      timeEstimate: 2 * 60 * 60 * 1000 
    });
    const allTasks = [grandparent, parent, subtask];
    const splits = TaskSplitter.splitTask(subtask, 120, config, allTasks);

    expect(splits).toHaveLength(1);
    expect(splits[0].realTagIds).toEqual(['tag-own']);
    expect(splits[0].virtualTagIds).toContain('tag-parent');
    expect(splits[0].virtualTagIds).toContain('tag-gp');
    expect(splits[0].virtualTagIds).toHaveLength(2);
  });

  it('works without allTasks parameter (backward compatibility)', () => {
    const task = createTask({ id: 'task-1', tagIds: ['tag-a'], parentId: null });
    // Call without allTasks - should still work
    const splits = TaskSplitter.splitTask(task, 120, config);

    expect(splits[0].realTagIds).toEqual(['tag-a']);
    expect(splits[0].virtualTagIds).toEqual([]);
    expect(splits[0].tagIds).toEqual(['tag-a']);
  });
});

describe('TaskSplitter.processAllTasks with subtask tags', () => {
  const config = { ...DEFAULT_CONFIG, splitSuffix: true };

  it('subtask splits include virtualTagIds from parent', () => {
    const parent = createTask({ id: 'parent', tagIds: ['urgent'], timeEstimate: 4 * 60 * 60 * 1000 });
    const subtask = createTask({ 
      id: 'subtask', 
      tagIds: ['specific'], 
      parentId: 'parent',
      timeEstimate: 2 * 60 * 60 * 1000 
    });
    const allTasks = [parent, subtask];

    const { splits } = TaskSplitter.processAllTasks(allTasks, 120, config);

    // Should only have splits from subtask (parent is skipped)
    expect(splits).toHaveLength(1);
    expect(splits[0].originalTaskId).toBe('subtask');
    
    // Subtask split should have real and virtual tags
    expect(splits[0].realTagIds).toEqual(['specific']);
    expect(splits[0].virtualTagIds).toEqual(['urgent']);
    expect(splits[0].tagIds).toContain('specific');
    expect(splits[0].tagIds).toContain('urgent');
  });
});

describe('TaskSplitter.splitTask with partially worked subtasks', () => {
  const config = { ...DEFAULT_CONFIG, splitSuffix: true };

  it('subtask with timeSpent splits correctly with first block including spent time', () => {
    // 5 hour subtask with 1.5 hours already worked, 2 hour blocks
    // Expected: first split = 1.5h (spent) + 2h (block) = 3.5h
    //           second split = 5h - 3.5h = 1.5h
    const parent = createTask({ id: 'parent', tagIds: ['tag-parent'], parentId: null });
    const subtask = createTask({
      id: 'subtask',
      tagIds: ['tag-own'],
      parentId: 'parent',
      timeEstimate: 5 * 60 * 60 * 1000, // 5 hours
      timeSpent: 1.5 * 60 * 60 * 1000,  // 1.5 hours already worked
    });
    const allTasks = [parent, subtask];
    const splits = TaskSplitter.splitTask(subtask, 120, config, allTasks);

    expect(splits).toHaveLength(2);
    // First split: timeSpent (1.5h) + blockSize (2h) = 3.5h
    expect(splits[0].estimatedHours).toBe(3.5);
    expect(splits[0].timeSpentMs).toBe(1.5 * 60 * 60 * 1000);
    // Second split: remaining = 5h - 3.5h = 1.5h
    expect(splits[1].estimatedHours).toBe(1.5);
    expect(splits[1].timeSpentMs).toBe(0);

    // Both splits should preserve virtual tags from parent
    for (const split of splits) {
      expect(split.realTagIds).toEqual(['tag-own']);
      expect(split.virtualTagIds).toEqual(['tag-parent']);
      expect(split.tagIds).toContain('tag-own');
      expect(split.tagIds).toContain('tag-parent');
    }
  });

  it('deeply nested subtask with timeSpent splits correctly', () => {
    // 6 hour nested subtask with 2.5 hours worked
    // First block = 2.5h + 2h = 4.5h, second block = 1.5h
    const grandparent = createTask({ id: 'gp', tagIds: ['tag-gp'], parentId: null });
    const parent = createTask({ id: 'parent', tagIds: ['tag-parent'], parentId: 'gp' });
    const subtask = createTask({
      id: 'subtask',
      tagIds: ['tag-own'],
      parentId: 'parent',
      timeEstimate: 6 * 60 * 60 * 1000, // 6 hours
      timeSpent: 2.5 * 60 * 60 * 1000,  // 2.5 hours already worked
    });
    const allTasks = [grandparent, parent, subtask];
    const splits = TaskSplitter.splitTask(subtask, 120, config, allTasks);

    expect(splits).toHaveLength(2);
    expect(splits[0].estimatedHours).toBe(4.5);
    expect(splits[0].timeSpentMs).toBe(2.5 * 60 * 60 * 1000);
    expect(splits[1].estimatedHours).toBe(1.5);

    // All splits should have inherited tags from both parent and grandparent
    for (const split of splits) {
      expect(split.realTagIds).toEqual(['tag-own']);
      expect(split.virtualTagIds).toContain('tag-parent');
      expect(split.virtualTagIds).toContain('tag-gp');
      expect(split.virtualTagIds).toHaveLength(2);
    }
  });

  it('subtask where timeSpent plus one block exceeds total estimate', () => {
    // 3 hour subtask with 2.5 hours worked
    // Since 2.5h + 2h = 4.5h > 3h, first split should be the full task
    const parent = createTask({ id: 'parent', tagIds: ['urgent'], parentId: null });
    const subtask = createTask({
      id: 'subtask',
      tagIds: ['specific'],
      parentId: 'parent',
      timeEstimate: 3 * 60 * 60 * 1000, // 3 hours
      timeSpent: 2.5 * 60 * 60 * 1000,  // 2.5 hours worked
    });
    const allTasks = [parent, subtask];
    const splits = TaskSplitter.splitTask(subtask, 120, config, allTasks);

    expect(splits).toHaveLength(1);
    expect(splits[0].estimatedHours).toBe(3);
    expect(splits[0].timeSpentMs).toBe(2.5 * 60 * 60 * 1000);
    expect(splits[0].realTagIds).toEqual(['specific']);
    expect(splits[0].virtualTagIds).toEqual(['urgent']);
  });
});
