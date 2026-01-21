/**
 * AutoPlan - Automatic Task Scheduler for Super Productivity
 * 
 * This plugin implements an urgency-based scheduling algorithm similar to taskcheck.
 * It calculates task priority based on:
 * 1. Base priority (order in list)
 * 2. Tag-based priority boosts
 * 3. Estimated duration factor
 * 4. Task age/oldness factor
 * 
 * Then it splits tasks into time blocks and schedules them by urgency.
 * 
 * AUTO-GENERATED FILE - Do not edit directly!
 * Edit src/core.js and src/plugin-template.js instead, then run: npm run build
 */

/**
 * AutoPlan - Core Library (testable, no PluginAPI dependencies)
 */

// ============================================================================
// CONFIGURATION DEFAULTS
// ============================================================================

// Default time map with standard work hours
const DEFAULT_TIME_MAP = {
  name: 'Default',
  days: {
    0: null,  // Sunday: skip
    1: { startHour: 9, endHour: 17 },  // Monday
    2: { startHour: 9, endHour: 17 },  // Tuesday
    3: { startHour: 9, endHour: 17 },  // Wednesday
    4: { startHour: 9, endHour: 17 },  // Thursday
    5: { startHour: 9, endHour: 17 },  // Friday
    6: null,  // Saturday: skip
  }
};

const DEFAULT_CONFIG = {
  blockSizeMinutes: 120, // 2 hours preferred block size
  minimumBlockSizeMinutes: 30, // 30 minutes minimum block size
  tagPriorities: {}, // { tagName: priorityBoost }
  projectPriorities: {}, // { projectName: priorityBoost }
  durationFormula: 'linear', // 'linear', 'inverse', 'log', 'none'
  durationWeight: 1.0,
  oldnessFormula: 'linear', // 'linear', 'log', 'exponential', 'none'
  oldnessWeight: 1.0,
  deadlineFormula: 'linear', // 'linear', 'aggressive', 'none' - how deadline urgency increases as due date approaches
  deadlineWeight: 12.0, // Weight for deadline urgency (similar to taskcheck's urgency.due.coefficient default)
  // Dynamic scheduling options (auto-adjust urgency weight when deadlines can't be met)
  autoAdjustUrgency: true, // If true, reduce urgency weight when tasks can't meet deadlines
  urgencyWeight: 1.0, // Weight for non-deadline urgency factors (0.0 to 1.0)
  maxDaysAhead: 30,
  autoRunOnStart: false,
  splitPrefix: '', // Prefix for split task names (empty = use original name)
  splitSuffix: true, // Add roman numerals as suffix
  // Legacy work hours (used as fallback when timeMaps not configured)
  workdayStartHour: 9,
  workdayHours: 8,
  skipDays: [0, 6], // Days of week to skip (0 = Sunday, 6 = Saturday)
  // Time Maps: per-project and per-tag scheduling windows
  timeMaps: {
    'default': DEFAULT_TIME_MAP,
  },
  projectTimeMaps: {}, // { projectId: timeMapId }
  tagTimeMaps: {}, // { tagId: timeMapId } - maps tags to time maps
  defaultTimeMap: 'default', // Fallback time map for unassigned tasks
  doNotRescheduleTagId: null, // Tag ID for tasks that should not be rescheduled
  treatIcalAsFixed: true, // Treat iCal tasks as fixed (don't reschedule)
};

/**
 * Create a default time map from legacy config settings
 */
function createTimeMapFromLegacy(config) {
  const startHour = config.workdayStartHour ?? 9;
  const hours = config.workdayHours ?? 8;
  const endHour = startHour + hours;
  const skipDays = config.skipDays ?? [0, 6];
  
  const days = {};
  for (let day = 0; day < 7; day++) {
    if (skipDays.includes(day)) {
      days[day] = null;
    } else {
      days[day] = { startHour, endHour };
    }
  }
  
  return { name: 'Default', days };
}

/**
 * Get the time map for a task based on its project and tags
 * Returns the first matching time map (project takes priority, then tags)
 */
function getTimeMapForTask(task, config) {
  const timeMapIds = getTimeMapIdsForTask(task, config);
  const timeMapId = timeMapIds.length > 0 ? timeMapIds[0] : (config.defaultTimeMap || 'default');
  
  // Get the time map, or create from legacy settings
  let timeMap = config.timeMaps?.[timeMapId];
  if (!timeMap) {
    timeMap = createTimeMapFromLegacy(config);
  }
  
  return timeMap;
}

/**
 * Get schedule for a specific day from a time map
 * @returns {{ startHour: number, endHour: number } | null} - null means skip this day
 */
function getDaySchedule(timeMap, dayOfWeek) {
  return timeMap?.days?.[dayOfWeek] ?? null;
}

/**
 * Get the time map ID for a task based on its project and tags
 * Returns the first matching time map ID (project takes priority, then tags)
 * @deprecated Use getTimeMapIdsForTask for multi-time-map support
 */
function getTimeMapIdForTask(task, config) {
  const timeMapIds = getTimeMapIdsForTask(task, config);
  return timeMapIds.length > 0 ? timeMapIds[0] : (config.defaultTimeMap || 'default');
}

/**
 * Get all time map IDs for a task based on its project and tags
 * A task can belong to multiple time maps if it has multiple mapped tags
 * @param {Object} task - The task to get time maps for
 * @param {Object} config - Configuration object
 * @returns {Array<string>} - Array of time map IDs (empty if only default applies)
 */
function getTimeMapIdsForTask(task, config) {
  const timeMapIds = new Set();
  
  // Check project mapping first
  const projectId = task.projectId;
  if (projectId && config.projectTimeMaps?.[projectId]) {
    timeMapIds.add(config.projectTimeMaps[projectId]);
  }
  
  // Check tag mappings
  const tagIds = task.tagIds || [];
  for (const tagId of tagIds) {
    if (config.tagTimeMaps?.[tagId]) {
      timeMapIds.add(config.tagTimeMaps[tagId]);
    }
  }
  
  return Array.from(timeMapIds);
}

/**
 * Get available minutes for a day in a specific time map
 */
function getTimeMapDayMinutes(timeMap, dayOfWeek) {
  const daySchedule = getDaySchedule(timeMap, dayOfWeek);
  if (!daySchedule) return 0;
  return (daySchedule.endHour - daySchedule.startHour) * 60;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Time constants for calculations
const MS_PER_HOUR = 1000 * 60 * 60;
const MS_PER_DAY = MS_PER_HOUR * 24;

// Urgency weight reduction step for auto-adjust scheduling
const URGENCY_WEIGHT_STEP = 0.1;

// Priority calculation constants
const MAX_ROMAN_NUMERAL = 3999;
const OLDNESS_EXPONENTIAL_CAP_DAYS = 100;
const OLDNESS_EXPONENTIAL_BASE = 1.1;

// Deadline priority thresholds (in days)
const DEADLINE_OVERDUE_THRESHOLD_DAYS = 7;
const DEADLINE_LINEAR_RANGE_DAYS = 21;

/**
 * Convert number to Roman numerals
 */
function toRoman(num) {
  if (num <= 0) return 'I'; // Handle edge case - minimum is I
  if (num > MAX_ROMAN_NUMERAL) return String(num); // Roman numerals only go up to 3999
  
  const romanNumerals = [
    ['M', 1000], ['CM', 900], ['D', 500], ['CD', 400],
    ['C', 100], ['XC', 90], ['L', 50], ['XL', 40],
    ['X', 10], ['IX', 9], ['V', 5], ['IV', 4], ['I', 1]
  ];
  let result = '';
  for (const [letter, value] of romanNumerals) {
    while (num >= value) {
      result += letter;
      num -= value;
    }
  }
  return result;
}

/**
 * Calculate hours between two dates
 * @description Utility function exported for external use and testing
 */
function hoursBetween(date1, date2) {
  return Math.abs(date2 - date1) / MS_PER_HOUR;
}

/**
 * Calculate days between two dates
 */
function daysBetween(date1, date2) {
  return Math.abs(date2 - date1) / MS_PER_DAY;
}

/**
 * Get task age in days
 */
function getTaskAgeInDays(task, now = new Date()) {
  if (!task.created) return 0;
  const created = new Date(task.created);
  return daysBetween(created, now);
}

/**
 * Get estimated duration in hours from task
 */
function getEstimatedHours(task) {
  if (task.timeEstimate) {
    return task.timeEstimate / MS_PER_HOUR;
  }
  return 0;
}

/**
 * Get remaining time in hours
 */
function getRemainingHours(task) {
  const estimated = getEstimatedHours(task);
  const spent = task.timeSpent ? task.timeSpent / MS_PER_HOUR : 0;
  return Math.max(0, estimated - spent);
}

/**
 * Parse a deadline from task notes
 * Supports formats like:
 *   - "Due: 2024-01-20" or "due: 2024-01-20"
 *   - "Deadline: 2024-01-20" or "deadline: 2024-01-20"
 *   - "Due: Jan 20, 2024"
 *   - "Due: 20/01/2024" (DD/MM/YYYY)
 *   - "Due: 01/20/2024" (MM/DD/YYYY) - ambiguous, treated as MM/DD/YYYY
 * @param {string} notes - The notes field from a task
 * @returns {Date|null} The parsed due date or null if not found
 */
function parseDeadlineFromNotes(notes) {
  if (!notes || typeof notes !== 'string') return null;
  
  // Match patterns like "Due: <date>" or "Deadline: <date>"
  // Now also supports time like "Deadline: 2024-01-20 9.15" or "Deadline: 2024-01-20 9:15"
  const patterns = [
    // ISO format with optional time: Deadline: 2024-01-20 or Deadline: 2024-01-20 9.15
    /(?:deadline)\s*:\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2})[.:](\d{2}))?/i,
    // Named month with optional time: Deadline: Jan 20, 2024 9.15
    /(?:deadline)\s*:\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})(?:\s+(\d{1,2})[.:](\d{2}))?/i,
    // Slash format with optional time: Deadline: 01/20/2024 9.15
    /(?:deadline)\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+(\d{1,2})[.:](\d{2}))?/i,
  ];
  
  for (const pattern of patterns) {
    const match = notes.match(pattern);
    if (match) {
      const dateStr = match[1];
      const hours = match[2] ? parseInt(match[2], 10) : null;
      const minutes = match[3] ? parseInt(match[3], 10) : null;
      
      let date = null;
      
      // Try parsing the date
      // Handle slash format specially (assume MM/DD/YYYY for US format)
      if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
          const [first, second, year] = parts.map(p => parseInt(p, 10));
          // Validate the parsed values
          if (first > 12 && second >= 1 && second <= 12) {
            // DD/MM/YYYY format (day > 12 indicates it's the day)
            date = new Date(year, second - 1, first);
          } else if (first >= 1 && first <= 12 && second >= 1 && second <= 31) {
            // MM/DD/YYYY format - validate day is reasonable
            date = new Date(year, first - 1, second);
          }
        }
      } else {
        // Standard date parsing for other formats
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          date = parsed;
        }
      }
      
      // If we successfully parsed a date, add time if present
      if (date) {
        if (hours !== null && minutes !== null) {
          date.setHours(hours, minutes, 0, 0);
        }
        return date;
      }
    }
  }
  
  return null;
}

/**
 * Get the due date of a task
 * Priority:
 *   1. Deadline parsed from notes (allows setting deadline separately from scheduled time)
 *   2. dueDate field (Super Productivity's all-day due date)
 *   3. Note: dueWithTime is NOT used here because SP uses it for scheduling, not deadlines
 * 
 * @returns {Date|null} The due date or null if not set
 */
function getTaskDueDate(task) {
  // First check for deadline in notes - this allows users to set deadlines
  // separately from the scheduled time (which uses dueWithTime in SP)
  const notesDeadline = parseDeadlineFromNotes(task.notes);
  if (notesDeadline) {
    return ensureDeadlineTime(notesDeadline);
  }
  
  // Super Productivity's dueDate is for all-day due dates
  // Note: We don't use dueWithTime here because AutoPlan uses it for scheduling
  if (task.dueDate) {
    return ensureDeadlineTime(new Date(task.dueDate));
  }
  
  return null;
}

/**
 * Ensure a deadline date has a time component
 * If the time is midnight (00:00:00), assume it's a date-only deadline
 * and set it to 23:59:59 (end of day)
 * Checks both local time and UTC time to handle dates parsed from ISO strings
 * @param {Date} date - The date to check
 * @returns {Date} - The date with time set to 23:59:59 if it was midnight
 */
function ensureDeadlineTime(date) {
  if (!date) return date;
  
  // Check if time is midnight in local time (00:00:00)
  const isLocalMidnight = date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
  
  // Check if time is midnight in UTC (for dates parsed from ISO strings like "2024-01-25")
  const isUTCMidnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0;
  
  if (isLocalMidnight || isUTCMidnight) {
    const adjusted = new Date(date);
    adjusted.setHours(23, 59, 59, 999);
    return adjusted;
  }
  
  return date;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if a task has a specific tag
 * @param {Object} task - The task to check
 * @param {string} tagId - The tag ID to look for
 * @returns {boolean} True if the task has the tag
 */
function hasTag(task, tagId) {
  return !!(tagId && task && task.tagIds && task.tagIds.includes(tagId));
}

/**
 * Check if a task is a fixed task (has the do-not-reschedule tag)
 * @param {Object} task - The task to check
 * @param {Object} config - Configuration object with doNotRescheduleTagId
 * @returns {boolean} True if the task should not be rescheduled
 */
function isFixedTask(task, config) {
  // Check if task has the do-not-reschedule tag
  if (hasTag(task, config?.doNotRescheduleTagId)) {
    return true;
  }
  
  // Check if iCal tasks should be treated as fixed
  if (config?.treatIcalAsFixed !== false && task.issueType === 'ICAL') {
    return true;
  }
  
  return false;
}

/**
 * Get virtual tag IDs for a task (tags inherited from parent tasks, not the task's own tags)
 * @param {Object} task - The task to get virtual tags for
 * @param {Array} allTasks - All tasks (needed to look up parent)
 * @returns {Array} Array of tag IDs inherited from parent tasks (excludes task's own tags)
 */
function getVirtualTagIds(task, allTasks) {
  const virtualTagIds = new Set();
  
  // If task has a parent, get parent's tags (both real and inherited)
  if (task.parentId && allTasks) {
    const parent = allTasks.find(t => t.id === task.parentId);
    if (parent) {
      // Add parent's own tags (using getRealTagIds to handle SP's dual field quirk)
      for (const tagId of getRealTagIds(parent)) {
        virtualTagIds.add(tagId);
      }
      // Recursively get parent's virtual tags (handles nested subtasks)
      const parentVirtualTags = getVirtualTagIds(parent, allTasks);
      for (const tagId of parentVirtualTags) {
        virtualTagIds.add(tagId);
      }
    }
  }
  
  return Array.from(virtualTagIds);
}

/**
 * Get real tag IDs for a task (the task's own tags from the Super Productivity data model)
 * Note: Super Productivity has a quirk where subtask tags may be stored in 'subTaskIds' 
 * when added via API, but in 'tagIds' when added via UI. This function reads from both
 * fields and combines them to ensure we get all tags.
 * @param {Object} task - The task to get real tags for
 * @returns {Array} Array of tag IDs that belong directly to this task
 */
function getRealTagIds(task) {
  const tagIds = new Set();
  
  // Add tags from tagIds (standard field)
  for (const tagId of (task.tagIds || [])) {
    tagIds.add(tagId);
  }
  
  // Add tags from subTaskIds (SP API quirk for subtasks)
  // Note: subTaskIds is confusingly named - it stores tag IDs for subtasks, not subtask IDs
  if (task.parentId && task.subTaskIds) {
    for (const tagId of task.subTaskIds) {
      tagIds.add(tagId);
    }
  }
  
  return Array.from(tagIds);
}

/**
 * Get effective tag IDs for a task, including inherited tags from parent tasks
 * This combines real tags (task's own) and virtual tags (inherited from parents)
 * @param {Object} task - The task to get tags for
 * @param {Array} allTasks - All tasks (needed to look up parent)
 * @returns {Array} Array of tag IDs including inherited ones
 */
function getEffectiveTagIds(task, allTasks) {
  const tagIds = new Set(getRealTagIds(task));
  
  // Add virtual tags (inherited from parent)
  const virtualTags = getVirtualTagIds(task, allTasks);
  for (const tagId of virtualTags) {
    tagIds.add(tagId);
  }
  
  return Array.from(tagIds);
}

// ============================================================================
// PRIORITY CALCULATION MODULE
// ============================================================================

const PriorityCalculator = {
  /**
   * Calculate tag-based priority boost
   * Uses effective tag IDs which includes inherited tags from parent tasks
   * @param {Object} task - The task to calculate priority for
   * @param {Object} tagPriorities - Map of tag names to priority boosts
   * @param {Array} allTags - All available tags
   * @param {Array} allTasks - All tasks (needed for parent tag inheritance)
   */
  calculateTagPriority(task, tagPriorities, allTags, allTasks = []) {
    // Get effective tags including inherited ones from parent
    const effectiveTagIds = getEffectiveTagIds(task, allTasks);
    if (effectiveTagIds.length === 0) return 0;
    if (!tagPriorities || typeof tagPriorities !== 'object') return 0;
    
    let boost = 0;
    for (const tagId of effectiveTagIds) {
      const tag = allTags.find(t => t.id === tagId);
      // Super Productivity uses 'title' for tag names, not 'name'
      if (tag && tagPriorities[tag.title] !== undefined) {
        boost += Number(tagPriorities[tag.title]) || 0;
      }
    }
    return boost;
  },

  /**
   * Calculate project-based priority boost
   */
  calculateProjectPriority(task, projectPriorities, allProjects) {
    if (!task.projectId) return 0;
    if (!projectPriorities || typeof projectPriorities !== 'object') return 0;
    
    const project = allProjects.find(p => p.id === task.projectId);
    if (project && projectPriorities[project.title] !== undefined) {
      return Number(projectPriorities[project.title]) || 0;
    }
    return 0;
  },

  /**
   * Calculate duration-based priority factor
   */
  calculateDurationPriority(task, formula, weight) {
    const hours = getRemainingHours(task);
    if (hours <= 0 || formula === 'none') return 0;
    if (weight <= 0) return 0;

    let factor;
    switch (formula) {
      case 'inverse':
        // Shorter tasks get higher priority
        factor = 1 / (hours + 1);
        break;
      case 'log':
        // Logarithmic scaling
        factor = Math.log(hours + 1);
        break;
      case 'linear':
      default:
        // Linear with hours
        factor = hours;
        break;
    }
    return factor * weight;
  },

  /**
   * Calculate oldness-based priority factor
   * Includes capping to prevent overflow with exponential formula
   */
  calculateOldnessPriority(task, formula, weight, now = new Date()) {
    const days = getTaskAgeInDays(task, now);
    if (days <= 0 || formula === 'none') return 0;
    if (weight <= 0) return 0;

    let factor;
    switch (formula) {
      case 'exponential':
        // Cap days to prevent overflow
        const cappedDays = Math.min(days, OLDNESS_EXPONENTIAL_CAP_DAYS);
        factor = Math.pow(OLDNESS_EXPONENTIAL_BASE, cappedDays);
        break;
      case 'log':
        factor = Math.log(days + 1);
        break;
      case 'linear':
      default:
        factor = days;
        break;
    }
    return factor * weight;
  },

  /**
   * Calculate deadline-based priority factor
   * Tasks with approaching deadlines get higher priority
   * Uses a configurable day range similar to taskcheck's urgency.due algorithm
   * 
   * @param {Object} task - The task to calculate deadline urgency for
   * @param {string} formula - 'linear', 'aggressive', or 'none'
   * @param {number} weight - Weight for deadline urgency (default 12.0 like taskcheck)
   * @param {Date} now - Current time for calculations
   * @returns {number} - Priority boost based on deadline proximity
   */
  calculateDeadlinePriority(task, formula, weight, now = new Date()) {
    if (formula === 'none') return 0;
    if (weight <= 0) return 0;

    const dueDate = getTaskDueDate(task);
    if (!dueDate) return 0;

    // Calculate days until due (negative = overdue)
    const daysUntilDue = (dueDate - now) / MS_PER_DAY;

    let factor;
    switch (formula) {
      case 'aggressive':
        // More aggressive urgency curve for very close deadlines
        // Overdue (7+ days overdue) = 1.0 (maximum)
        // Just due = 0.9
        // 1 week away = 0.5
        // 2+ weeks away = 0.2 (minimum)
        if (daysUntilDue <= -DEADLINE_OVERDUE_THRESHOLD_DAYS) {
          factor = 1.0;
        } else if (daysUntilDue <= 0) {
          // Overdue (0-7 days overdue): 0.9 to 1.0
          factor = 0.9 + (-daysUntilDue / DEADLINE_OVERDUE_THRESHOLD_DAYS) * 0.1;
        } else if (daysUntilDue <= DEADLINE_OVERDUE_THRESHOLD_DAYS) {
          // Within 1 week: 0.5 to 0.9
          factor = 0.9 - (daysUntilDue / DEADLINE_OVERDUE_THRESHOLD_DAYS) * 0.4;
        } else if (daysUntilDue <= DEADLINE_OVERDUE_THRESHOLD_DAYS * 2) {
          // Within 2 weeks: 0.2 to 0.5
          factor = 0.5 - ((daysUntilDue - DEADLINE_OVERDUE_THRESHOLD_DAYS) / DEADLINE_OVERDUE_THRESHOLD_DAYS) * 0.3;
        } else {
          factor = 0.2;
        }
        break;
      case 'linear':
      default:
        // Linear urgency similar to taskcheck
        // Maps a 21-day range to 0.2 - 1.0
        // Overdue (7+ days) = 1.0
        // 14 days in future = 0.2
        if (daysUntilDue <= -DEADLINE_OVERDUE_THRESHOLD_DAYS) {
          factor = 1.0;
        } else if (daysUntilDue >= DEADLINE_OVERDUE_THRESHOLD_DAYS * 2) {
          factor = 0.2;
        } else {
          // Linear interpolation from -7 days (1.0) to +14 days (0.2)
          // Range of 21 days maps to range of 0.8
          factor = 1.0 - ((daysUntilDue + DEADLINE_OVERDUE_THRESHOLD_DAYS) / DEADLINE_LINEAR_RANGE_DAYS) * 0.8;
        }
        break;
    }

    return factor * weight;
  },

  /**
   * Calculate total urgency/priority for a task
   * 
   * @param {Object} task - The task to calculate urgency for
   * @param {Object} config - Configuration object
   * @param {Array} allTags - All available tags
   * @param {Array} allProjects - All available projects
   * @param {Date} now - Current time for calculations
   * @param {Array} allTasks - All tasks (needed for parent tag inheritance)
   */
  calculateUrgency(task, config, allTags, allProjects = [], now = new Date(), allTasks = []) {
    const tagPriority = this.calculateTagPriority(task, config.tagPriorities || {}, allTags, allTasks);
    const projectPriority = this.calculateProjectPriority(task, config.projectPriorities || {}, allProjects);
    const durationPriority = this.calculateDurationPriority(
      task, config.durationFormula || 'none', config.durationWeight ?? 1.0
    );
    const oldnessPriority = this.calculateOldnessPriority(
      task, config.oldnessFormula || 'none', config.oldnessWeight ?? 1.0, now
    );
    const deadlinePriority = this.calculateDeadlinePriority(
      task, config.deadlineFormula || 'none', config.deadlineWeight ?? 12.0, now
    );

    // Apply urgencyWeight to non-deadline factors (like taskcheck's weight_urgency)
    // This allows dynamic scheduling to prioritize deadline-based urgency when needed
    const urgencyWeight = config.urgencyWeight ?? 1.0;
    const nonDeadlineUrgency = (tagPriority + projectPriority + durationPriority + oldnessPriority) * urgencyWeight;

    return {
      total: nonDeadlineUrgency + deadlinePriority,
      components: {
        tag: tagPriority * urgencyWeight,
        project: projectPriority * urgencyWeight,
        duration: durationPriority * urgencyWeight,
        oldness: oldnessPriority * urgencyWeight,
        deadline: deadlinePriority
      }
    };
  }
};

// ============================================================================
// TASK SPLITTING MODULE
// ============================================================================

const TaskSplitter = {
  /**
   * Split a task into time blocks
   * Returns an array of split task objects
   * @param {Object} task - The task to split
   * @param {number} blockSizeMinutes - Size of each block in minutes
   * @param {Object} config - Configuration object
   * @param {Array} allTasks - All tasks (optional, needed for computing virtualTagIds for subtasks)
   */
  splitTask(task, blockSizeMinutes, config, allTasks = []) {
    // Validate inputs
    if (!blockSizeMinutes || blockSizeMinutes <= 0) {
      blockSizeMinutes = DEFAULT_CONFIG.blockSizeMinutes;
    }

    // Use total estimated hours (not remaining) to preserve time spent during merge
    // The first split inherits timeSpent, so total timeEstimate of all splits
    // should equal the original task's timeEstimate
    const estimatedHours = getEstimatedHours(task);
    if (estimatedHours <= 0) return [];
    
    // Still check remaining hours to skip fully completed tasks
    const remainingHours = getRemainingHours(task);
    if (remainingHours <= 0) return [];

    const blockSizeHours = blockSizeMinutes / 60;
    
    // Calculate time already spent in hours
    const timeSpentHours = (task.timeSpent || 0) / (60 * 60 * 1000);
    
    // First split: includes timeSpent + one full block (capped at total estimate)
    // This ensures the "work already done" stays with the first split and
    // gives it one full block of new work to do
    const firstBlockHours = Math.min(timeSpentHours + blockSizeHours, estimatedHours);
    
    // Remaining hours after first block
    const remainingAfterFirst = estimatedHours - firstBlockHours;
    
    // Calculate number of additional blocks needed for remaining time
    const additionalBlocks = remainingAfterFirst > 0 
      ? Math.ceil(remainingAfterFirst / blockSizeHours) 
      : 0;
    const numBlocks = 1 + additionalBlocks;
    
    const splits = [];

    // Real tags: the task's own tags from the Super Productivity data model
    const realTagIds = getRealTagIds(task);
    // Virtual tags: tags inherited from parent tasks (only applicable for subtasks)
    const virtualTagIds = getVirtualTagIds(task, allTasks);

    // Track how much time has been allocated
    let allocatedHours = 0;

    for (let i = 0; i < numBlocks; i++) {
      let blockHours;
      if (i === 0) {
        // First block: timeSpent + one full block (capped at total)
        blockHours = firstBlockHours;
      } else {
        // Subsequent blocks: full block size or remaining time
        const remaining = estimatedHours - allocatedHours;
        blockHours = Math.min(blockSizeHours, remaining);
      }
      
      allocatedHours += blockHours;

      let splitName = task.title;
      if (config.splitPrefix) {
        splitName = config.splitPrefix + splitName;
      }
      if (config.splitSuffix !== false) {
        splitName = `${splitName} <${toRoman(i + 1)}>`;
      }

      // First split inherits timeSpent and timeSpentOnDay from original task, others start empty
      const timeSpentMs = i === 0 ? (task.timeSpent || 0) : 0;
      const timeSpentOnDay = i === 0 ? (task.timeSpentOnDay || {}) : {};
      
      splits.push({
        originalTaskId: task.id,
        originalTask: task,
        splitIndex: i,
        totalSplits: numBlocks,
        title: splitName,
        estimatedHours: blockHours,
        estimatedMs: blockHours * 60 * 60 * 1000,
        timeSpentMs: timeSpentMs,
        timeSpentOnDay: timeSpentOnDay,
        // Real tags: the task's own tags (from SP data model)
        realTagIds: realTagIds,
        // Virtual tags: inherited from parent tasks
        virtualTagIds: virtualTagIds,
        // Combined for backward compatibility (real + virtual)
        tagIds: [...new Set([...realTagIds, ...virtualTagIds])],
        projectId: task.projectId,
        parentId: task.parentId,
        // Link to other splits
        prevSplitIndex: i > 0 ? i - 1 : null,
        nextSplitIndex: i < numBlocks - 1 ? i + 1 : null,
      });
    }

    return splits;
  },

  /**
   * Check if a task has already been processed by AutoPlan
   */
  isAlreadyProcessed(task) {
    if (!task.notes) return false;
    return task.notes.includes('[AutoPlan]');
  },

  /**
   * Process all tasks and split them into blocks
   * Skips parent tasks that have subtasks
   * @param {Array} tasks - Tasks to process
   * @param {number} blockSizeMinutes - Size of each block in minutes
   * @param {Object} config - Configuration object
   */
  processAllTasks(tasks, blockSizeMinutes, config) {
    // Find parent task IDs (tasks that have subtasks)
    const parentIds = new Set();
    for (const task of tasks) {
      if (task.parentId) {
        parentIds.add(task.parentId);
      }
    }

    const allSplits = [];
    const skippedParents = [];
    const alreadyProcessed = [];

    for (const task of tasks) {
      // Skip if this task is a parent with subtasks
      if (parentIds.has(task.id)) {
        skippedParents.push(task);
        continue;
      }

      // Skip completed tasks
      if (task.isDone) continue;

      // Skip already processed tasks
      if (this.isAlreadyProcessed(task)) {
        alreadyProcessed.push(task);
        continue;
      }

      const splits = this.splitTask(task, blockSizeMinutes, config, tasks);
      allSplits.push(...splits);
    }

    return { splits: allSplits, skippedParents, alreadyProcessed };
  }
};

// ============================================================================
// AUTOPLANNING ALGORITHM
// ============================================================================

const AutoPlanner = {
  /**
   * Check if a day should be skipped based on config (legacy)
   */
  shouldSkipDay(date, skipDays) {
    if (!skipDays || !Array.isArray(skipDays) || skipDays.length === 0) {
      return false;
    }
    return skipDays.includes(date.getDay());
  },

  /**
   * Check if a day should be skipped for a specific time map
   */
  shouldSkipDayForTimeMap(date, timeMap) {
    const daySchedule = getDaySchedule(timeMap, date.getDay());
    return daySchedule === null;
  },

  /**
   * Advance to the next working day (skipping configured days) - legacy
   */
  advanceToNextWorkday(date, skipDays, workdayStartHour) {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + 1);
    newDate.setHours(workdayStartHour, 0, 0, 0);
    
    // Keep advancing while we're on a skip day (max 7 iterations to prevent infinite loop)
    let iterations = 0;
    while (this.shouldSkipDay(newDate, skipDays) && iterations < 7) {
      newDate.setDate(newDate.getDate() + 1);
      iterations++;
    }
    
    return newDate;
  },

  /**
   * Advance to the next working day for a specific time map
   */
  advanceToNextWorkdayForTimeMap(date, timeMap) {
    const newDate = new Date(date);
    newDate.setDate(newDate.getDate() + 1);
    
    // Get the start hour for the new day from time map
    const daySchedule = getDaySchedule(timeMap, newDate.getDay());
    const startHour = daySchedule?.startHour ?? 9;
    newDate.setHours(startHour, 0, 0, 0);
    
    // Keep advancing while we're on a skip day (max 7 iterations to prevent infinite loop)
    let iterations = 0;
    while (this.shouldSkipDayForTimeMap(newDate, timeMap) && iterations < 7) {
      newDate.setDate(newDate.getDate() + 1);
      const nextDaySchedule = getDaySchedule(timeMap, newDate.getDay());
      if (nextDaySchedule) {
        newDate.setHours(nextDaySchedule.startHour, 0, 0, 0);
      }
      iterations++;
    }
    
    return newDate;
  },

  /**
   * Get the current time slot start based on current time
   */
  getCurrentDayMinutes(now, workdayStartHour = 9) {
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // If before work start, return 0
    if (currentHour < workdayStartHour) {
      return 0;
    }
    
    // Calculate minutes since work day started
    return (currentHour - workdayStartHour) * 60 + currentMinute;
  },

  /**
   * Get current day minutes for a specific time map
   */
  getCurrentDayMinutesForTimeMap(now, timeMap) {
    const daySchedule = getDaySchedule(timeMap, now.getDay());
    if (!daySchedule) return 0; // Skip day
    
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // If before work start for this time map, return 0
    if (currentHour < daySchedule.startHour) {
      return 0;
    }
    
    // If after work end for this time map, return max (day is full)
    if (currentHour >= daySchedule.endHour) {
      return (daySchedule.endHour - daySchedule.startHour) * 60;
    }
    
    // Calculate minutes since this time map's work day started
    return (currentHour - daySchedule.startHour) * 60 + currentMinute;
  },

  /**
   * Get the date key (YYYY-MM-DD) for a given date
   */
  getDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  /**
   * Calculate urgency for a split, considering total remaining work for the original task
   * @param {Object} split - The split to calculate urgency for
   * @param {Array} remainingSplits - All remaining unscheduled splits
   * @param {Object} config - Configuration object
   * @param {Array} allTags - All available tags
   * @param {Array} allProjects - All available projects
   * @param {Date} simulatedTime - Current simulation time
   * @param {Array} allTasks - All tasks (needed for parent tag inheritance)
   * @returns {Object} - { split, urgency, urgencyComponents, index }
   */
  calculateSplitUrgency(split, remainingSplits, config, allTags, allProjects, simulatedTime, allTasks = []) {
    // Calculate total remaining time for all unscheduled splits of the same original task
    const remainingSplitsForTask = remainingSplits.filter(
      s => s.originalTaskId === split.originalTaskId
    );
    const totalRemainingMs = remainingSplitsForTask.reduce(
      (sum, s) => sum + s.estimatedMs, 0
    );

    // Create a pseudo-task for urgency calculation
    // Use the total remaining time for the original task, not just this split's time
    const pseudoTask = {
      ...split.originalTask,
      id: split.originalTaskId,
      timeEstimate: totalRemainingMs,
      timeSpent: 0,
    };

    const urgency = PriorityCalculator.calculateUrgency(
      pseudoTask, 
      config,
      allTags,
      allProjects,
      simulatedTime,
      allTasks
    );

    return {
      split,
      urgency: urgency.total,
      urgencyComponents: urgency.components,
    };
  },

  /**
   * Sort splits by urgency with deterministic tiebreakers
   * Primary: higher urgency first
   * Secondary: older tasks first (lower created timestamp)
   * Tertiary: alphabetical by task ID
   * @param {Array} splitsWithUrgency - Array of { split, urgency, urgencyComponents }
   * @returns {Array} - Sorted array (mutates in place)
   */
  sortSplitsByUrgency(splitsWithUrgency) {
    return splitsWithUrgency.sort((a, b) => {
      // Primary: higher urgency first
      if (b.urgency !== a.urgency) {
        return b.urgency - a.urgency;
      }
      // Secondary: older tasks first (lower created timestamp)
      const aCreated = a.split.originalTask?.created || 0;
      const bCreated = b.split.originalTask?.created || 0;
      if (aCreated !== bCreated) {
        return aCreated - bCreated;
      }
      // Tertiary: alphabetical by task ID for full determinism
      return (a.split.originalTaskId || '').localeCompare(b.split.originalTaskId || '');
    });
  },

  /**
   * Create a dynamic split for overflow time
   * @param {Object} mostUrgentSplit - The original split being split
   * @param {number} remainderMinutes - Minutes that don't fit in current day
   * @param {Array} remainingSplits - All remaining splits (will be updated)
   * @param {Object} config - Configuration object
   * @returns {Object} - The new split object
   */
  createDynamicSplit(mostUrgentSplit, remainderMinutes, remainingSplits, config) {
    const remainderHours = remainderMinutes / 60;
    const newSplitIndex = mostUrgentSplit.totalSplits; // Append at end
    
    // Update all splits for this task to reflect new total
    for (const split of remainingSplits) {
      if (split.originalTaskId === mostUrgentSplit.originalTaskId) {
        split.totalSplits = newSplitIndex + 1;
      }
    }
    
    // Determine the title for the new split
    let newSplitTitle = mostUrgentSplit.originalTask.title;
    if (config.splitPrefix) {
      newSplitTitle = config.splitPrefix + newSplitTitle;
    }
    if (config.splitSuffix !== false) {
      newSplitTitle = `${newSplitTitle} <${toRoman(newSplitIndex + 1)}>`;
    }
    
    const newSplit = {
      originalTaskId: mostUrgentSplit.originalTaskId,
      originalTask: mostUrgentSplit.originalTask,
      splitIndex: newSplitIndex,
      totalSplits: newSplitIndex + 1,
      title: newSplitTitle,
      estimatedHours: remainderHours,
      estimatedMs: remainderMinutes * 60 * 1000,
      // Preserve the tag structure from the original split
      realTagIds: mostUrgentSplit.realTagIds || mostUrgentSplit.tagIds || [],
      virtualTagIds: mostUrgentSplit.virtualTagIds || [],
      tagIds: mostUrgentSplit.tagIds,
      projectId: mostUrgentSplit.projectId,
      parentId: mostUrgentSplit.parentId,
      prevSplitIndex: mostUrgentSplit.splitIndex,
      nextSplitIndex: null,
    };
    
    // Update the current split's next pointer
    mostUrgentSplit.nextSplitIndex = newSplitIndex;
    mostUrgentSplit.totalSplits = newSplitIndex + 1;
    
    return newSplit;
  },

  /**
   * Calculate the block start time from simulation state
   * @param {Date} simulatedTime - Current simulation date
   * @param {number} currentDayMinutes - Minutes into the workday
   * @param {number} workdayStartHour - Hour when workday starts
   * @returns {Date} - Start time for the block
   */
  calculateBlockStartTime(simulatedTime, currentDayMinutes, workdayStartHour) {
    const blockStartTime = new Date(simulatedTime);
    const totalMinutesFromMidnight = workdayStartHour * 60 + currentDayMinutes;
    blockStartTime.setHours(Math.floor(totalMinutesFromMidnight / 60));
    blockStartTime.setMinutes(totalMinutesFromMidnight % 60);
    blockStartTime.setSeconds(0);
    blockStartTime.setMilliseconds(0);
    return blockStartTime;
  },

  /**
   * Calculate the block start time for a specific time map
   */
  calculateBlockStartTimeForTimeMap(simulatedTime, currentDayMinutes, timeMap) {
    const daySchedule = getDaySchedule(timeMap, simulatedTime.getDay());
    const startHour = daySchedule?.startHour ?? 9;
    return this.calculateBlockStartTime(simulatedTime, currentDayMinutes, startHour);
  },

  /**
   * Calculate fixed task minutes per day from a list of fixed tasks
   * Fixed tasks are tasks that have the "do not reschedule" tag and have a scheduled time
   * Only counts the overlap between the fixed task and work hours
   * @param {Array} fixedTasks - List of fixed tasks
   * @param {Object} config - Configuration with workdayStartHour and workdayHours
   */
  calculateFixedMinutesPerDay(fixedTasks, config = {}) {
    const fixedMinutesPerDay = {};
    const workdayStartHour = config.workdayStartHour ?? 9;
    const workdayHours = config.workdayHours ?? 8;
    const workdayEndHour = workdayStartHour + workdayHours;
    
    for (const task of fixedTasks) {
      // Task needs to have a scheduled time (dueWithTime) and a time estimate
      if (!task.dueWithTime || !task.timeEstimate || task.timeEstimate <= 0) {
        continue;
      }
      
      const eventStart = new Date(task.dueWithTime);
      const eventEndMs = task.dueWithTime + task.timeEstimate;
      const eventEnd = new Date(eventEndMs);
      
      // Calculate overlap with work hours for each day the event spans
      let currentDay = new Date(eventStart);
      currentDay.setHours(0, 0, 0, 0);
      
      const lastDay = new Date(eventEnd);
      lastDay.setHours(0, 0, 0, 0);
      
      while (currentDay <= lastDay) {
        const dateKey = this.getDateKey(currentDay);
        
        // Work hours for this day
        const workStart = new Date(currentDay);
        workStart.setHours(workdayStartHour, 0, 0, 0);
        const workEnd = new Date(currentDay);
        workEnd.setHours(workdayEndHour, 0, 0, 0);
        
        // Calculate overlap between event and work hours
        const overlapStart = Math.max(eventStart.getTime(), workStart.getTime());
        const overlapEnd = Math.min(eventEnd.getTime(), workEnd.getTime());
        
        if (overlapEnd > overlapStart) {
          const overlapMinutes = Math.ceil((overlapEnd - overlapStart) / 60000);
          
          if (!fixedMinutesPerDay[dateKey]) {
            fixedMinutesPerDay[dateKey] = 0;
          }
          fixedMinutesPerDay[dateKey] += overlapMinutes;
        }
        
        // Move to next day
        currentDay.setDate(currentDay.getDate() + 1);
      }
    }
    
    return fixedMinutesPerDay;
  },

  /**
   * Main scheduling algorithm
   * For each day, for each time map, sorts tasks by priority and schedules them.
   * This ensures fair scheduling across time maps - each time map gets its slots filled
   * with its highest priority tasks each day, rather than one time map dominating.
   * 
   * @param {Array} splits - Task splits to schedule
   * @param {Object} config - Configuration object
   * @param {Array} allTags - All available tags
   * @param {Array} allProjects - All available projects
   * @param {Date} startTime - When to start scheduling from
   * @param {Array} fixedTasks - Tasks that should not be rescheduled (optional)
   * @param {Array} allTasks - All tasks (needed for parent tag inheritance)
   * @returns {Object} - { schedule: Array, deadlineMisses: Array } where schedule contains scheduled items
   *                     and deadlineMisses contains tasks that will miss their deadlines
   */
  schedule(splits, config, allTags, allProjects = [], startTime = new Date(), fixedTasks = [], allTasks = []) {
    if (splits.length === 0) return { schedule: [], deadlineMisses: [] };

    const schedule = [];
    const remainingSplits = [...splits];
    const maxDaysAhead = config.maxDaysAhead ?? 30;
    const minBlockMinutes = config.minimumBlockSizeMinutes ?? DEFAULT_CONFIG.minimumBlockSizeMinutes;
    
    // Build a map of time maps, ensuring 'default' exists
    // If legacy settings are present, create a time map from them for 'default'
    const timeMaps = { ...config.timeMaps };
    
    // Check if legacy settings are explicitly configured (different from DEFAULT_CONFIG)
    const hasLegacyOverrides = (
      config.workdayStartHour !== undefined ||
      config.workdayHours !== undefined ||
      config.skipDays !== undefined
    );
    
    // If legacy overrides exist, create a time map from them (overrides any default from config)
    if (hasLegacyOverrides || !timeMaps['default']) {
      timeMaps['default'] = createTimeMapFromLegacy(config);
    }
    
    // Track used minutes per day per time map: { timeMapId: { dateKey: minutes } }
    const usedMinutesPerDayPerTimeMap = {};
    for (const timeMapId of Object.keys(timeMaps)) {
      usedMinutesPerDayPerTimeMap[timeMapId] = {};
    }
    
    // Calculate fixed task minutes per day
    const fixedMinutesPerDay = this.calculateFixedMinutesPerDay(fixedTasks, config);
    
    // Helper to get all time map IDs for a split (can be multiple via tags)
    const getTimeMapIdsForSplit = (split) => {
      const ids = getTimeMapIdsForTask(split.originalTask || split, config);
      // If no specific mappings, use default
      return ids.length > 0 ? ids : [config.defaultTimeMap || 'default'];
    };
    
    // Group splits by time map ID - a split can appear in multiple time maps
    const getSplitsForTimeMap = (timeMapId) => {
      return remainingSplits.filter(split => {
        const splitTimeMapIds = getTimeMapIdsForSplit(split);
        return splitTimeMapIds.includes(timeMapId);
      });
    };
    
    // Helper to get available minutes for a day in a time map (excluding fixed tasks)
    const getAvailableMinutesForDayAndTimeMap = (date, timeMap) => {
      const dateKey = this.getDateKey(date);
      const dayOfWeek = date.getDay();
      const daySchedule = getDaySchedule(timeMap, dayOfWeek);
      
      if (!daySchedule) return 0; // Skip day
      
      const baseMinutes = (daySchedule.endHour - daySchedule.startHour) * 60;
      const fixedMinutes = fixedMinutesPerDay[dateKey] || 0;
      return Math.max(0, baseMinutes - fixedMinutes);
    };
    
    // Helper to get remaining minutes for a day in a time map
    const getRemainingMinutesForDay = (timeMapId, date, timeMap) => {
      const dateKey = this.getDateKey(date);
      const usedMinutes = usedMinutesPerDayPerTimeMap[timeMapId]?.[dateKey] || 0;
      const availableMinutes = getAvailableMinutesForDayAndTimeMap(date, timeMap);
      return Math.max(0, availableMinutes - usedMinutes);
    };
    
    // Helper to get used minutes for a day in a time map
    const getUsedMinutesForDay = (timeMapId, dateKey) => {
      return usedMinutesPerDayPerTimeMap[timeMapId]?.[dateKey] || 0;
    };
    
    // Helper to add used minutes for a day in a time map
    const addUsedMinutes = (timeMapId, dateKey, minutes) => {
      if (!usedMinutesPerDayPerTimeMap[timeMapId]) {
        usedMinutesPerDayPerTimeMap[timeMapId] = {};
      }
      if (!usedMinutesPerDayPerTimeMap[timeMapId][dateKey]) {
        usedMinutesPerDayPerTimeMap[timeMapId][dateKey] = 0;
      }
      usedMinutesPerDayPerTimeMap[timeMapId][dateKey] += minutes;
    };
    
    // Initialize: handle first day specially if we're starting mid-day
    const startDate = new Date(startTime);
    startDate.setHours(0, 0, 0, 0);
    
    // Pre-calculate used minutes for the first day based on current time
    const firstDateKey = this.getDateKey(startTime);
    for (const [timeMapId, timeMap] of Object.entries(timeMaps)) {
      const daySchedule = getDaySchedule(timeMap, startTime.getDay());
      if (daySchedule) {
        const currentMinutes = this.getCurrentDayMinutesForTimeMap(startTime, timeMap);
        if (currentMinutes > 0) {
          addUsedMinutes(timeMapId, firstDateKey, currentMinutes);
        }
      }
    }
    
    // Iterate day by day
    let currentDay = new Date(startDate);
    let daysProcessed = 0;
    
    while (remainingSplits.length > 0 && daysProcessed < maxDaysAhead) {
      const dateKey = this.getDateKey(currentDay);
      const dayOfWeek = currentDay.getDay();
      
      // For each time map, schedule tasks for this day
      for (const [timeMapId, timeMap] of Object.entries(timeMaps)) {
        const daySchedule = getDaySchedule(timeMap, dayOfWeek);
        if (!daySchedule) continue; // Skip day for this time map
        
        // Get splits that belong to this time map (can include splits with multiple time maps)
        let timeMapSplits = getSplitsForTimeMap(timeMapId);
        
        if (timeMapSplits.length === 0) continue;
        
        // Schedule as many splits as fit in today's available time for this time map
        let remainingMinutes = getRemainingMinutesForDay(timeMapId, currentDay, timeMap);
        
        // Keep scheduling until we run out of time or splits for this time map
        while (remainingMinutes >= minBlockMinutes && timeMapSplits.length > 0) {
          // Calculate the current scheduling time based on used minutes
          const usedMinutes = getUsedMinutesForDay(timeMapId, dateKey);
          const currentSchedulingTime = this.calculateBlockStartTime(currentDay, usedMinutes, daySchedule.startHour);
          
          // Calculate urgency for all remaining splits at the current scheduling time
          // This ensures deadline and oldness urgency reflect when the task would actually start
          const splitsWithUrgency = timeMapSplits
            .filter(split => {
              // Only consider splits still in remainingSplits
              return remainingSplits.some(
                s => s.originalTaskId === split.originalTaskId && s.splitIndex === split.splitIndex
              );
            })
            .map(split => 
              this.calculateSplitUrgency(split, remainingSplits, config, allTags, allProjects, currentSchedulingTime, allTasks)
            );
          
          if (splitsWithUrgency.length === 0) break;
          
          this.sortSplitsByUrgency(splitsWithUrgency);
          
          // Get the most urgent split
          const { split, urgency, urgencyComponents } = splitsWithUrgency[0];
          
          // Find it in remainingSplits
          const splitIndex = remainingSplits.findIndex(
            s => s.originalTaskId === split.originalTaskId && s.splitIndex === split.splitIndex
          );
          if (splitIndex === -1) {
            // Split was already scheduled, remove from timeMapSplits and continue
            timeMapSplits = timeMapSplits.filter(
              s => !(s.originalTaskId === split.originalTaskId && s.splitIndex === split.splitIndex)
            );
            continue;
          }
          
          let blockMinutes = split.estimatedHours * 60;
          
          // Handle case where block is larger than remaining time
          if (blockMinutes > remainingMinutes) {
            if (remainingMinutes >= minBlockMinutes) {
              // Dynamic splitting: schedule what fits, create new split for remainder
              const remainderMinutes = blockMinutes - remainingMinutes;
              blockMinutes = remainingMinutes;
              
              // Create a dynamic split for the overflow
              const newSplit = this.createDynamicSplit(
                split, 
                remainderMinutes, 
                remainingSplits, 
                config
              );
              
              // Update the current split's estimated time
              split.estimatedHours = blockMinutes / 60;
              split.estimatedMs = blockMinutes * 60 * 1000;
              
              // Add new split to remainingSplits for future scheduling
              remainingSplits.push(newSplit);
            } else {
              // Not enough time for even a partial block, remove from timeMapSplits and continue
              timeMapSplits = timeMapSplits.filter(
                s => !(s.originalTaskId === split.originalTaskId && s.splitIndex === split.splitIndex)
              );
              continue;
            }
          }
          
          // Use currentSchedulingTime as the block start time (already calculated above)
          const blockStartTime = currentSchedulingTime;
          
          const endTime = new Date(blockStartTime);
          endTime.setMinutes(endTime.getMinutes() + blockMinutes);
          
          schedule.push({
            split,
            startTime: blockStartTime,
            endTime,
            urgency,
            urgencyComponents,
            timeMapId,
          });
          
          // Update used minutes
          addUsedMinutes(timeMapId, dateKey, blockMinutes);
          remainingMinutes -= blockMinutes;
          
          // Remove the scheduled split from remainingSplits and timeMapSplits
          remainingSplits.splice(splitIndex, 1);
          timeMapSplits = timeMapSplits.filter(
            s => !(s.originalTaskId === split.originalTaskId && s.splitIndex === split.splitIndex)
          );
        }
      }
      
      // Move to next day
      currentDay.setDate(currentDay.getDate() + 1);
      daysProcessed++;
    }

    // Check for deadline misses
    const deadlineMisses = this.checkDeadlineMisses(schedule, splits);

    return { schedule, deadlineMisses };
  },

  /**
   * Check for tasks that will miss their deadlines based on the schedule
   * @param {Array} schedule - The generated schedule
   * @param {Array} allSplits - All task splits (to check unscheduled tasks)
   * @returns {Array} - Array of deadline miss objects with task info and dates
   */
  checkDeadlineMisses(schedule, allSplits) {
    const deadlineMisses = [];
    
    // Group scheduled items by original task ID
    const scheduledByTask = new Map();
    for (const item of schedule) {
      const taskId = item.split.originalTaskId;
      if (!scheduledByTask.has(taskId)) {
        scheduledByTask.set(taskId, []);
      }
      scheduledByTask.get(taskId).push(item);
    }

    // Group all splits by original task ID to check for unscheduled splits
    const allSplitsByTask = new Map();
    for (const split of allSplits) {
      const taskId = split.originalTaskId;
      if (!allSplitsByTask.has(taskId)) {
        allSplitsByTask.set(taskId, []);
      }
      allSplitsByTask.get(taskId).push(split);
    }

    // Check each unique task
    const checkedTasks = new Set();
    
    for (const [taskId, scheduledItems] of scheduledByTask) {
      if (checkedTasks.has(taskId)) continue;
      checkedTasks.add(taskId);

      const originalTask = scheduledItems[0].split.originalTask;
      const dueDate = getTaskDueDate(originalTask);
      
      if (!dueDate) continue; // No deadline, no miss possible

      // Find the last scheduled end time for this task
      const lastEndTime = scheduledItems.reduce((latest, item) => {
        return item.endTime > latest ? item.endTime : latest;
      }, scheduledItems[0].endTime);

      // Check if all splits for this task are scheduled
      const allTaskSplits = allSplitsByTask.get(taskId) || [];
      const scheduledSplitIndices = new Set(scheduledItems.map(i => i.split.splitIndex));
      const unscheduledSplits = allTaskSplits.filter(s => !scheduledSplitIndices.has(s.splitIndex));

      // Task misses deadline if:
      // 1. The last scheduled split ends after the due date, OR
      // 2. Some splits couldn't be scheduled at all
      if (lastEndTime > dueDate || unscheduledSplits.length > 0) {
        deadlineMisses.push({
          taskId,
          taskTitle: originalTask.title,
          dueDate,
          scheduledCompletionDate: lastEndTime,
          unscheduledSplits: unscheduledSplits.length,
          totalSplits: allTaskSplits.length,
          missedBy: unscheduledSplits.length > 0 ? null : Math.ceil((lastEndTime - dueDate) / MS_PER_DAY), // days
        });
      }
    }

    // Also check for tasks with deadlines that have NO scheduled splits at all
    for (const [taskId, splits] of allSplitsByTask) {
      if (checkedTasks.has(taskId)) continue;
      
      const originalTask = splits[0].originalTask;
      const dueDate = getTaskDueDate(originalTask);
      
      if (!dueDate) continue;

      // This task has a deadline but no splits were scheduled
      deadlineMisses.push({
        taskId,
        taskTitle: originalTask.title,
        dueDate,
        scheduledCompletionDate: null,
        unscheduledSplits: splits.length,
        totalSplits: splits.length,
        missedBy: null, // Unknown since nothing was scheduled
      });
    }

    return deadlineMisses;
  },

  /**
   * Schedule with automatic urgency adjustment.
   * If tasks miss their deadlines, reduce the non-deadline urgency weight
   * and increase the deadline weight, then retry until all deadlines are met
   * or the weight reaches the limits.
   * 
   * This implements a dynamic scheduling approach where deadline priority
   * becomes increasingly important when there's not enough time for everything.
   * 
   * @param {Array} splits - Task splits to schedule
   * @param {Object} config - Configuration object
   * @param {Array} allTags - All available tags
   * @param {Array} allProjects - All available projects
   * @param {Date} startTime - When to start scheduling from
   * @param {Array} fixedTasks - Tasks that should not be rescheduled (optional)
   * @param {Array} allTasks - All tasks (needed for parent tag inheritance)
   * @returns {Object} - { schedule, deadlineMisses, finalUrgencyWeight, finalDeadlineWeight, adjustmentAttempts }
   */
  scheduleWithAutoAdjust(splits, config, allTags, allProjects = [], startTime = new Date(), fixedTasks = [], allTasks = []) {
    const autoAdjust = config.autoAdjustUrgency ?? true;
    const initialUrgencyWeight = config.urgencyWeight ?? 1.0;
    const initialDeadlineWeight = config.deadlineWeight ?? 12.0;
    
    if (!autoAdjust) {
      // No auto-adjust, just run once
      const result = this.schedule(splits, config, allTags, allProjects, startTime, fixedTasks, allTasks);
      return {
        ...result,
        finalUrgencyWeight: initialUrgencyWeight,
        finalDeadlineWeight: initialDeadlineWeight,
        adjustmentAttempts: 0,
      };
    }
    
    let currentUrgencyWeight = initialUrgencyWeight;
    let currentDeadlineWeight = initialDeadlineWeight;
    let attempts = 0;
    let result;
    
    // Calculate the deadline weight increase step (proportional to urgency decrease)
    // When urgency goes from 1.0 to 0.0, deadline weight doubles
    const deadlineWeightStep = (initialDeadlineWeight * URGENCY_WEIGHT_STEP) / initialUrgencyWeight;
    
    // Keep trying with adjusted weights until no deadline misses or limits reached
    while (currentUrgencyWeight >= 0) {
      // Create a modified config with current weights
      const adjustedConfig = {
        ...config,
        urgencyWeight: currentUrgencyWeight,
        deadlineWeight: currentDeadlineWeight,
      };
      
      result = this.schedule(splits, adjustedConfig, allTags, allProjects, startTime, fixedTasks, allTasks);
      
      // If no deadline misses, we're done
      if (result.deadlineMisses.length === 0) {
        break;
      }
      
      // Adjust weights: decrease urgency, increase deadline
      currentUrgencyWeight = Math.round((currentUrgencyWeight - URGENCY_WEIGHT_STEP) * 10) / 10;
      currentDeadlineWeight = Math.round((currentDeadlineWeight + deadlineWeightStep) * 10) / 10;
      attempts++;
      
      // Safety check - don't go below 0 for urgency weight
      if (currentUrgencyWeight < 0) {
        currentUrgencyWeight = 0;
        // One final try with urgency weight = 0 and maximum deadline weight
        const finalConfig = { 
          ...config, 
          urgencyWeight: 0,
          deadlineWeight: currentDeadlineWeight,
        };
        result = this.schedule(splits, finalConfig, allTags, allProjects, startTime, fixedTasks, allTasks);
        break;
      }
    }
    
    return {
      ...result,
      finalUrgencyWeight: currentUrgencyWeight,
      finalDeadlineWeight: currentDeadlineWeight,
      adjustmentAttempts: attempts,
    };
  },
};

// ============================================================================
// TASK MERGE MODULE
// ============================================================================

const TaskMerger = {
  /**
   * Parse the notes field to extract original task ID and split info
   * Uses a more robust parsing approach with [AutoPlan] prefix to prevent false positives
   */
  parseSplitInfo(task) {
    if (!task.notes) return null;
    
    // Look for the AutoPlan split marker with [AutoPlan] prefix
    // This prevents false positives from user notes that happen to match the pattern
    // Handle potential special characters in title
    const splitMatch = task.notes.match(/\[AutoPlan\] Split (\d+)\/(\d+) of "((?:[^"\\]|\\.)*)"/);
    const idMatch = task.notes.match(/\[AutoPlan\] Original Task ID: ([^\n\s]+)/);
    
    if (splitMatch && idMatch) {
      return {
        splitIndex: parseInt(splitMatch[1]) - 1,
        totalSplits: parseInt(splitMatch[2]),
        originalTitle: splitMatch[3].replace(/\\"/g, '"'), // Unescape quotes
        originalTaskId: idMatch[1].trim(),
      };
    }
    return null;
  },

  /**
   * Escape title for safe inclusion in notes
   */
  escapeTitle(title) {
    return title.replace(/"/g, '\\"');
  },

  /**
   * Clean AutoPlan markers from task notes
   * Removes lines containing [AutoPlan] and related metadata like "Original Task ID:"
   * Also removes "Split X/Y of" lines
   * @param {string} notes - The original notes
   * @returns {string} Cleaned notes with AutoPlan markers removed
   */
  cleanAutoplanNotes(notes) {
    if (!notes) return '';
    
    // Split into lines and filter out AutoPlan-related lines
    const lines = notes.split('\n');
    const cleanedLines = lines.filter(line => {
      const trimmed = line.trim();
      // Remove lines with [AutoPlan] marker
      if (trimmed.includes('[AutoPlan]')) return false;
      // Remove "Original Task ID:" lines
      if (trimmed.startsWith('Original Task ID:')) return false;
      // Remove "Split X/Y of" lines (the split task markers)
      if (/^Split \d+\/\d+ of "/.test(trimmed)) return false;
      return true;
    });
    
    // Join and trim excess whitespace
    return cleanedLines.join('\n').trim();
  },

  /**
   * Generate the notes content for a split task, preserving existing user notes
   * @param {number} splitIndex - Zero-based index of this split
   * @param {number} totalSplits - Total number of splits
   * @param {string} originalTitle - The original task title
   * @param {string} originalTaskId - The original task ID
   * @param {string} [existingNotes=''] - Existing notes to preserve (optional)
   * @returns {string} Combined notes with AutoPlan markers and preserved user notes
   */
  generateSplitNotes(splitIndex, totalSplits, originalTitle, originalTaskId, existingNotes = '') {
    const escapedTitle = this.escapeTitle(originalTitle);
    const autoplanMarker = `[AutoPlan] Split ${splitIndex + 1}/${totalSplits} of "${escapedTitle}"\n\n[AutoPlan] Original Task ID: ${originalTaskId}`;
    
    // Clean any existing AutoPlan markers from the notes to avoid duplication
    const cleanedUserNotes = this.cleanAutoplanNotes(existingNotes);
    
    if (cleanedUserNotes) {
      // Put user notes first, then AutoPlan markers
      return `${cleanedUserNotes}\n\n${autoplanMarker}`;
    }
    
    return autoplanMarker;
  },

  /**
   * Find all split tasks that belong to the same original task
   */
  findRelatedSplits(tasks, taskId) {
    const task = tasks.find(t => t.id === taskId);
    
    if (!task) return { splits: [], originalTaskId: null };

    const splitInfo = this.parseSplitInfo(task);
    if (!splitInfo) return { splits: [], originalTaskId: null };

    // Find all tasks with the same original task ID
    const relatedSplits = tasks.filter(t => {
      const info = this.parseSplitInfo(t);
      return info && info.originalTaskId === splitInfo.originalTaskId;
    });

    // Sort by split index
    relatedSplits.sort((a, b) => {
      const infoA = this.parseSplitInfo(a);
      const infoB = this.parseSplitInfo(b);
      return (infoA?.splitIndex || 0) - (infoB?.splitIndex || 0);
    });

    return {
      splits: relatedSplits,
      originalTaskId: splitInfo.originalTaskId,
      originalTitle: splitInfo.originalTitle,
    };
  },

  /**
   * Merge multiple timeSpentOnDay objects into one
   * Each timeSpentOnDay is an object like { "2024-01-15": 3600000, "2024-01-16": 1800000 }
   * @param {Array} timeSpentOnDayObjects - Array of timeSpentOnDay objects to merge
   * @returns {Object} Combined timeSpentOnDay with summed values for each day
   */
  mergeTimeSpentOnDay(timeSpentOnDayObjects) {
    const merged = {};
    for (const timeSpentOnDay of timeSpentOnDayObjects) {
      if (!timeSpentOnDay || typeof timeSpentOnDay !== 'object') continue;
      for (const [day, ms] of Object.entries(timeSpentOnDay)) {
        merged[day] = (merged[day] || 0) + (ms || 0);
      }
    }
    return merged;
  },

  /**
   * Calculate merged task data from splits
   * @param {Array} incompleteSplits - Splits that are not done (for time estimate)
   * @param {Array} allSplits - All splits including completed ones (for time spent)
   * @param {string} originalTitle - The original task title
   */
  calculateMergeData(incompleteSplits, allSplits, originalTitle) {
    let totalTimeEstimate = 0;
    let totalTimeSpent = 0;
    
    // Sum time estimates from incomplete splits only (remaining work)
    for (const split of incompleteSplits) {
      totalTimeEstimate += split.timeEstimate || 0;
    }
    
    // Sum time spent from ALL splits including completed ones
    for (const split of allSplits) {
      totalTimeSpent += split.timeSpent || 0;
    }
    
    // Merge timeSpentOnDay from ALL splits
    const mergedTimeSpentOnDay = this.mergeTimeSpentOnDay(
      allSplits.map(s => s.timeSpentOnDay)
    );

    // Clean title by removing Roman numeral suffix in <> brackets
    // Pattern: " <I>", " <II>", " <XIV>", etc.
    const cleanTitle = originalTitle || incompleteSplits[0]?.title?.replace(/ <[IVXLCDM]+>$/, '') || 'Merged Task';

    return {
      title: cleanTitle,
      totalTimeEstimate,
      totalTimeSpent,
      totalTimeSpentOnDay: mergedTimeSpentOnDay,
      mergedCount: incompleteSplits.length,
    };
  },

  /**
   * Find all split task groups in the task list
   */
  findAllSplitGroups(tasks) {
    const groups = new Map();

    for (const task of tasks) {
      const splitInfo = this.parseSplitInfo(task);
      if (splitInfo) {
        if (!groups.has(splitInfo.originalTaskId)) {
          groups.set(splitInfo.originalTaskId, {
            originalTaskId: splitInfo.originalTaskId,
            originalTitle: splitInfo.originalTitle,
            splits: [],
          });
        }
        groups.get(splitInfo.originalTaskId).splits.push({
          task,
          splitInfo,
        });
      }
    }

    // Sort splits within each group
    for (const group of groups.values()) {
      group.splits.sort((a, b) => a.splitInfo.splitIndex - b.splitInfo.splitIndex);
    }

    return Array.from(groups.values());
  },
};


// ============================================================================
// PLUGIN-SPECIFIC EXTENSIONS (uses PluginAPI)
// These methods extend the core library with Super Productivity integration
// ============================================================================

/**
 * Get scheduling fields for a task based on its scheduled time.
 * Uses dueWithTime (timestamp in milliseconds) for all tasks.
 * This ensures tasks scheduled for the future appear in Planner, not Today.
 * 
 * Note: dueDay and dueWithTime are mutually exclusive in Super Productivity.
 * When setting dueWithTime, we must clear dueDay (use undefined, not null).
 */
function getSchedulingFields(startTime) {
  return {
    dueWithTime: startTime.getTime(),
    dueDay: undefined, // Clear dueDay to avoid conflicts (use undefined per SP's internal behavior)
    hasPlannedTime: true, // Indicate this task has a specific scheduled time
  };
}

/**
 * Apply the schedule by creating/updating tasks in Super Productivity
 * This extends AutoPlanner with PluginAPI integration
 */
AutoPlanner.applySchedule = async function(schedule, originalTasks) {
  const createdTasks = [];
  const errors = [];
  const taskGroups = new Map(); // Group splits by original task

  // Group scheduled splits by original task
  for (const item of schedule) {
    const originalId = item.split.originalTaskId;
    if (!taskGroups.has(originalId)) {
      taskGroups.set(originalId, []);
    }
    taskGroups.get(originalId).push(item);
  }

  // Process each original task
  for (const [originalId, items] of taskGroups) {
    const originalTask = items[0].split.originalTask;

    // Sort items by split index
    items.sort((a, b) => a.split.splitIndex - b.split.splitIndex);

    try {
      // If only one block, just update the original task
      if (items.length === 1) {
        // Update with scheduled time using appropriate field
        const schedulingFields = getSchedulingFields(items[0].startTime);
        await PluginAPI.updateTask(originalId, schedulingFields);
        createdTasks.push({
          type: 'updated',
          taskId: originalId,
          scheduledAt: items[0].startTime,
        });
      } else {
        // Split task into multiple blocks
        // IMPORTANT: Preserve the original task as the first split to maintain task ID
        const splitTaskIds = [];
        
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const schedulingFields = getSchedulingFields(item.startTime);
          
          try {
            if (i === 0) {
              // First split: UPDATE the original task instead of creating a new one
              // This preserves the original task ID and keeps the timeSpent
              await PluginAPI.updateTask(originalId, {
                title: item.split.title,
                timeEstimate: item.split.estimatedMs,
                // timeSpent is preserved automatically since we're updating, not creating
                notes: TaskMerger.generateSplitNotes(
                  item.split.splitIndex,
                  item.split.totalSplits,
                  originalTask.title,
                  originalId,
                  originalTask.notes
                ),
                ...schedulingFields,
              });

              splitTaskIds.push(originalId);
              createdTasks.push({
                type: 'updated',
                taskId: originalId,
                originalTaskId: originalId,
                splitIndex: item.split.splitIndex,
                scheduledAt: item.startTime,
              });
            } else {
              // Subsequent splits: Create new tasks with no time tracking data
              // Use realTagIds (task's own tags) not tagIds (which includes virtual/inherited)
              const splitTagIds = item.split.realTagIds || item.split.tagIds;
              
              // Build task data - for subtasks, SP API expects tags in 'subTaskIds' field
              // We set both tagIds and subTaskIds to handle SP's quirky behavior
              const taskData = {
                title: item.split.title,
                timeEstimate: item.split.estimatedMs,
                timeSpent: 0, // New splits start with no time spent
                timeSpentOnDay: {}, // New splits start with empty time-on-day tracking
                tagIds: splitTagIds,
                projectId: item.split.projectId,
                parentId: item.split.parentId,
                notes: TaskMerger.generateSplitNotes(
                  item.split.splitIndex,
                  item.split.totalSplits,
                  originalTask.title,
                  originalId,
                  originalTask.notes
                ),
              };
              
              // For subtasks, also set subTaskIds (SP API quirk)
              if (item.split.parentId) {
                taskData.subTaskIds = splitTagIds;
              }
              
              const newTaskId = await PluginAPI.addTask(taskData);

              // Set the scheduled time via updateTask using appropriate field
              await PluginAPI.updateTask(newTaskId, schedulingFields);

              splitTaskIds.push(newTaskId);
              createdTasks.push({
                type: 'created',
                taskId: newTaskId,
                originalTaskId: originalId,
                splitIndex: item.split.splitIndex,
                scheduledAt: item.startTime,
              });
            }
          } catch (splitError) {
            console.warn(`[AutoPlan] Failed to create/update split ${i} for task ${originalId}:`, splitError);
            errors.push({ taskId: originalId, splitIndex: i, error: splitError.message });
            // Continue with other splits
          }
        }
      }
    } catch (taskError) {
      console.warn(`[AutoPlan] Failed to process task ${originalId}:`, taskError);
      errors.push({ taskId: originalId, error: taskError.message });
      // Continue with other tasks
    }
  }

  if (errors.length > 0) {
    console.warn(`[AutoPlan] Completed with ${errors.length} errors:`, errors);
  }

  return { createdTasks, errors };
};

/**
 * Find all split tasks that belong to the same original task (async version)
 * This extends TaskMerger with PluginAPI integration
 */
TaskMerger.findRelatedSplitsAsync = async function(taskId) {
  const tasks = await PluginAPI.getTasks();
  return this.findRelatedSplits(tasks, taskId);
};

/**
 * Merge split tasks back into a single task
 * This extends TaskMerger with PluginAPI integration
 * 
 * @param {string} taskId - ID of any task in the split group
 * @param {boolean} silent - If true, don't show snack notifications
 */
TaskMerger.mergeSplits = async function(taskId, silent = false) {
  const tasks = await PluginAPI.getTasks();
  const { splits, originalTaskId, originalTitle } = this.findRelatedSplits(tasks, taskId);
  
  if (splits.length === 0) {
    if (!silent) {
      PluginAPI.showSnack({
        msg: 'This task is not a split task',
        type: 'WARNING',
      });
    }
    return null;
  }

  // Handle single orphan split - clean it up and restore original title
  if (splits.length === 1) {
    const orphanSplit = splits[0];
    
    // If it's done, nothing to do
    if (orphanSplit.isDone) {
      if (!silent) {
        PluginAPI.showSnack({
          msg: 'Split is already completed',
          type: 'INFO',
        });
      }
      return null;
    }
    
    // Clean up the orphan split: restore original title and remove [AutoPlan] markers
    const cleanedNotes = this.cleanAutoplanNotes(orphanSplit.notes);
    await PluginAPI.updateTask(orphanSplit.id, {
      title: originalTitle,
      notes: cleanedNotes,
    });
    
    if (!silent) {
      PluginAPI.showSnack({
        msg: `Restored "${originalTitle}" from orphan split`,
        type: 'SUCCESS',
      });
    }
    
    return {
      mergedTaskId: orphanSplit.id,
      mergedCount: 1,
      totalTimeEstimate: orphanSplit.timeEstimate,
    };
  }

  // Calculate total remaining time from incomplete splits
  const incompleteSplits = splits.filter(s => !s.isDone);
  if (incompleteSplits.length === 0) {
    if (!silent) {
      PluginAPI.showSnack({
        msg: 'All splits are already completed',
        type: 'INFO',
      });
    }
    return null;
  }

  // Calculate merge data - pass all splits to include time spent from completed ones
  const mergeData = this.calculateMergeData(incompleteSplits, splits, originalTitle);

  // Prefer using the original task (the one whose ID matches originalTaskId) as the merged task
  // This preserves the original task ID through the merge process
  let mergedTask = incompleteSplits.find(s => s.id === originalTaskId);
  let tasksToDelete;
  
  if (mergedTask) {
    // Original task is still present and incomplete - use it
    tasksToDelete = incompleteSplits.filter(s => s.id !== originalTaskId);
  } else {
    // Original task was completed or not found - use first incomplete split
    mergedTask = incompleteSplits[0];
    tasksToDelete = incompleteSplits.slice(1);
  }

  // Update the merged task with combined time tracking data
  // Clean any AutoPlan notes from the original task so it can be rescheduled
  const cleanedNotes = this.cleanAutoplanNotes(mergedTask.notes);
  await PluginAPI.updateTask(mergedTask.id, {
    title: mergeData.title,
    timeEstimate: mergeData.totalTimeEstimate,
    timeSpent: mergeData.totalTimeSpent,
    timeSpentOnDay: mergeData.totalTimeSpentOnDay,
    notes: cleanedNotes,
  });

  // Delete the other incomplete splits
  for (const task of tasksToDelete) {
    try {
      await PluginAPI.deleteTask(task.id);
    } catch (e) {
      console.warn('[AutoPlan] Could not delete split task:', e);
      // Fallback: mark as done if delete fails
      try {
        await PluginAPI.updateTask(task.id, {
          isDone: true,
          notes: this.cleanAutoplanNotes(task.notes),
        });
      } catch (e2) {
        console.warn('[AutoPlan] Could not mark task as done:', e2);
      }
    }
  }

  // Also delete any completed splits from this group
  const completedSplits = splits.filter(s => s.isDone);
  for (const task of completedSplits) {
    try {
      await PluginAPI.deleteTask(task.id);
    } catch (e) {
      console.warn('[AutoPlan] Could not delete completed split:', e);
    }
  }

  if (!silent) {
    PluginAPI.showSnack({
      msg: `Merged ${mergeData.mergedCount} splits into "${mergeData.title}"`,
      type: 'SUCCESS',
    });
  }

  return {
    mergedTaskId: mergedTask.id,
    mergedCount: mergeData.mergedCount,
    totalTimeEstimate: mergeData.totalTimeEstimate,
  };
};

/**
 * Find all split task groups (async version)
 */
TaskMerger.findAllSplitGroupsAsync = async function() {
  const tasks = await PluginAPI.getTasks();
  return this.findAllSplitGroups(tasks);
};

// ============================================================================
// MAIN PLUGIN LOGIC
// ============================================================================

let currentConfig = { ...DEFAULT_CONFIG };

/**
 * Load configuration from persistent storage
 */
async function loadConfig() {
  try {
    const data = await PluginAPI.loadSyncedData();
    if (data) {
      const parsed = JSON.parse(data);
      currentConfig = { ...DEFAULT_CONFIG, ...parsed };
    }
  } catch (e) {
    console.log('[AutoPlan] No saved config found, using defaults');
  }
  return currentConfig;
}

/**
 * Save configuration to persistent storage
 */
async function saveConfig(config) {
  currentConfig = { ...currentConfig, ...config };
  await PluginAPI.persistDataSynced(JSON.stringify(currentConfig));
}

/**
 * Simulate merging split tasks without modifying the actual tasks
 * Returns a task list as it would appear after merging all splits
 * Also cleans [AutoPlan] markers from all tasks so they can be re-processed
 * @param {Array} tasks - All tasks
 * @returns {Array} Tasks with splits replaced by virtual merged tasks
 */
function simulateMergedTasks(tasks) {
  const splitGroups = TaskMerger.findAllSplitGroups(tasks);
  
  // Collect all split task IDs
  const splitTaskIds = new Set();
  for (const group of splitGroups) {
    for (const { task } of group.splits) {
      splitTaskIds.add(task.id);
    }
  }
  
  // Filter out split tasks and clean [AutoPlan] marker from non-split tasks
  const nonSplitTasks = tasks
    .filter(t => !splitTaskIds.has(t.id))
    .map(t => {
      // Remove [AutoPlan] marker from notes so the task can be re-processed
      if (t.notes && t.notes.includes('[AutoPlan]')) {
        const cleanNotes = t.notes.replace(/\[AutoPlan\][^\n]*/g, '').trim();
        return { ...t, notes: cleanNotes };
      }
      return t;
    });
  
  if (splitGroups.length === 0) {
    console.log(`[AutoPlan] No split groups to merge, cleaned ${nonSplitTasks.length} tasks`);
    return nonSplitTasks;
  }
  
  // Create virtual merged tasks
  const virtualMergedTasks = [];
  for (const group of splitGroups) {
    const allSplits = group.splits.map(s => s.task);
    const incompleteSplits = allSplits.filter(t => !t.isDone);
    
    if (incompleteSplits.length === 0) {
      // All splits are done, skip this group
      continue;
    }
    
    // Handle single orphan split - create virtual task with restored original title
    // This matches the new mergeSplits behavior that cleans up orphan splits
    if (allSplits.length === 1) {
      const orphanSplit = allSplits[0];
      if (orphanSplit.isDone) {
        continue;
      }
      
      // Remove [AutoPlan] marker from notes so the task can be re-processed
      let cleanNotes = orphanSplit.notes || '';
      cleanNotes = cleanNotes.replace(/\[AutoPlan\][^\n]*/g, '').trim();
      
      const virtualTask = {
        ...orphanSplit,
        id: orphanSplit.id,
        title: group.originalTitle, // Restore original title
        notes: cleanNotes,
        // Clear planning fields as they would be after merging
        dueWithTime: undefined,
        dueDay: undefined,
        hasPlannedTime: undefined,
      };
      
      virtualMergedTasks.push(virtualTask);
      continue;
    }
    
    // Calculate merged data
    const mergeData = TaskMerger.calculateMergeData(incompleteSplits, allSplits, group.originalTitle);
    
    // Match the logic from TaskMerger.mergeSplits:
    // Prefer using the original task (if still incomplete), otherwise use first incomplete split
    // This ensures dry run produces the same result as actual apply
    let mergedTask = incompleteSplits.find(s => s.id === group.originalTaskId);
    if (!mergedTask) {
      // Original task was completed - use first incomplete split (same as mergeSplits does)
      mergedTask = incompleteSplits[0];
    }
    
    // Remove [AutoPlan] marker from notes so the task can be re-processed
    let cleanNotes = mergedTask.notes || '';
    cleanNotes = cleanNotes.replace(/\[AutoPlan\][^\n]*/g, '').trim();
    
    const virtualTask = {
      ...mergedTask,
      id: mergedTask.id, // Use the actual merged task's ID (matches mergeSplits behavior)
      title: mergeData.title,
      timeEstimate: mergeData.totalTimeEstimate,
      timeSpent: mergeData.totalTimeSpent,
      timeSpentOnDay: mergeData.mergedTimeSpentOnDay || {},
      notes: cleanNotes, // Use cleaned notes without [AutoPlan] marker
      // Clear planning fields as they would be after merging
      dueWithTime: undefined,
      dueDay: undefined,
      hasPlannedTime: undefined,
    };
    
    virtualMergedTasks.push(virtualTask);
  }
  
  console.log(`[AutoPlan] Simulated merging ${splitGroups.length} split groups into ${virtualMergedTasks.length} virtual tasks`);
  
  return [...nonSplitTasks, ...virtualMergedTasks];
}

/**
 * Run the autoplanning algorithm
 */
async function runAutoplan(dryRun = false) {
  console.log('[AutoPlan] Starting autoplanning...');

  try {
    // Step 1: Clear previous planning (merge splits + clear scheduled times)
    if (!dryRun) {
      console.log('[AutoPlan] Clearing previous planning...');
      const clearResult = await clearPlanning(true); // silent mode - don't show snack
      console.log(`[AutoPlan] Merged ${clearResult.merged} split groups, cleared ${clearResult.cleared} tasks`);
    }

    // Load config
    const config = await loadConfig();

    // Get all tasks, tags, and projects (re-fetch after clearing for apply, or fresh for dry run)
    let allTasks = await PluginAPI.getTasks();
    const allTags = await PluginAPI.getAllTags();
    const allProjects = await PluginAPI.getAllProjects();

    // For dry run, simulate what tasks would look like after merging splits
    if (dryRun) {
      console.log('[AutoPlan] Dry run: simulating merged task state...');
      allTasks = simulateMergedTasks(allTasks);
    }

    console.log(`[AutoPlan] Processing ${allTasks.length} tasks`);

    // Separate fixed tasks (tasks with do-not-reschedule tag)
    let fixedTasks = [];
    let schedulableTasks = allTasks;
    
    if (config.doNotRescheduleTagId) {
      fixedTasks = allTasks.filter(t => 
        !t.isDone && 
        isFixedTask(t, config)
      );
      schedulableTasks = allTasks.filter(t => 
        !isFixedTask(t, config)
      );
      console.log(`[AutoPlan] ${fixedTasks.length} fixed tasks (will not be rescheduled)`);
    }

    // Filter to only incomplete tasks with time estimates
    const eligibleTasks = schedulableTasks.filter(t => 
      !t.isDone && 
      t.timeEstimate && 
      t.timeEstimate > 0
    );

    console.log(`[AutoPlan] ${eligibleTasks.length} eligible tasks with estimates`);

    // Split tasks into blocks
    const { splits, skippedParents } = TaskSplitter.processAllTasks(
      eligibleTasks,
      config.blockSizeMinutes,
      config
    );

    console.log(`[AutoPlan] Created ${splits.length} time blocks`);
    console.log(`[AutoPlan] Skipped ${skippedParents.length} parent tasks`);

    // Run scheduling algorithm
    // Pass allTasks for parent tag inheritance during priority calculation
    const { schedule, deadlineMisses } = AutoPlanner.schedule(splits, config, allTags, allProjects, new Date(), fixedTasks, allTasks);

    console.log(`[AutoPlan] Generated schedule with ${schedule.length} entries`);
    if (deadlineMisses.length > 0) {
      console.log(`[AutoPlan] Warning: ${deadlineMisses.length} tasks may miss their deadlines`);
    }

    // Show preview
    let message = `AutoPlan: ${schedule.length} blocks scheduled`;
    if (schedule.length > 0) {
      const firstDate = schedule[0].startTime.toLocaleDateString();
      const lastDate = schedule[schedule.length - 1].startTime.toLocaleDateString();
      message += ` (${firstDate} - ${lastDate})`;
    }

    if (dryRun) {
      return { schedule, applied: false, deadlineMisses };
    }

    // Apply the schedule
    const result = await AutoPlanner.applySchedule(schedule, eligibleTasks);

    // Clean TODAY tag to remove tasks scheduled for future dates
    // (PluginAPI.addTask automatically adds new tasks to TODAY)
    const removedFromToday = await cleanTodayTag();
    if (removedFromToday > 0) {
      console.log(`[AutoPlan] Cleaned ${removedFromToday} future tasks from TODAY tag`);
    }

    // Show snack notification with summary
    if (result.errors && result.errors.length > 0) {
      PluginAPI.showSnack({
        msg: `AutoPlan completed with ${result.errors.length} error(s)`,
        type: 'WARNING',
      });
    } else if (schedule.length > 0) {
      // Count unique tasks and total hours
      const uniqueTasks = new Set(schedule.map(s => s.split.originalTaskId)).size;
      const totalMs = schedule.reduce((sum, s) => sum + s.split.estimatedMs, 0);
      const totalHours = (totalMs / 3600000).toFixed(1);
      PluginAPI.showSnack({
        msg: `Scheduled ${uniqueTasks} task${uniqueTasks !== 1 ? 's' : ''} (${totalHours}h)`,
        type: 'SUCCESS',
      });
    } else {
      PluginAPI.showSnack({
        msg: 'No tasks to schedule',
        type: 'INFO',
      });
    }

    return { schedule, applied: true, result, deadlineMisses };

  } catch (error) {
    console.error('[AutoPlan] Error:', error);
    PluginAPI.showSnack({
      msg: `AutoPlan failed: ${error.message}`,
      type: 'ERROR',
    });
    throw error;
  }
}

/**
 * Clean the TODAY tag to only include tasks that are actually scheduled for today.
 * When PluginAPI.addTask() creates new tasks, Super Productivity automatically adds
 * them to the TODAY tag. This function removes tasks that are scheduled for future dates.
 * 
 * @returns {Promise<number>} Number of tasks removed from TODAY tag
 */
async function cleanTodayTag() {
  console.log('[AutoPlan] Cleaning TODAY tag...');
  
  try {
    const allTasks = await PluginAPI.getTasks();
    const allTags = await PluginAPI.getAllTags();
    
    // Find the TODAY tag
    const todayTag = allTags.find(tag => tag.id === 'TODAY');
    if (!todayTag || !todayTag.taskIds || todayTag.taskIds.length === 0) {
      console.log('[AutoPlan] No tasks in TODAY tag to clean');
      return 0;
    }
    
    // Get today's date range (start and end of day in local time)
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    
    // Build a map of task IDs to tasks for quick lookup
    const taskMap = {};
    for (const task of allTasks) {
      taskMap[task.id] = task;
    }
    
    // Find tasks that should be removed from TODAY
    // A task should stay in TODAY if:
    // 1. It has dueWithTime set for today, OR
    // 2. It has no dueWithTime and no hasPlannedTime (manually added to TODAY)
    const tasksToRemove = [];
    for (const taskId of todayTag.taskIds) {
      const task = taskMap[taskId];
      if (!task) continue; // Task might have been deleted
      
      // If task has a planned time (dueWithTime + hasPlannedTime), check if it's for today
      if (task.dueWithTime && task.hasPlannedTime) {
        const taskDate = new Date(task.dueWithTime);
        if (taskDate < todayStart || taskDate > todayEnd) {
          // Task is scheduled for a different day - remove from TODAY
          tasksToRemove.push(taskId);
        }
      }
      // Tasks without dueWithTime or without hasPlannedTime are left alone
      // (they may have been manually added to TODAY)
    }
    
    if (tasksToRemove.length === 0) {
      console.log('[AutoPlan] No tasks to remove from TODAY tag');
      return 0;
    }
    
    console.log(`[AutoPlan] Found ${tasksToRemove.length} tasks to remove from TODAY tag`);
    
    // Step 1: Update the TODAY tag's taskIds array to remove future-dated tasks
    const tasksToRemoveSet = new Set(tasksToRemove);
    const newTodayTaskIds = todayTag.taskIds.filter(id => !tasksToRemoveSet.has(id));
    
    try {
      await PluginAPI.updateTag('TODAY', { taskIds: newTodayTaskIds });
      console.log(`[AutoPlan] Updated TODAY tag taskIds: ${todayTag.taskIds.length} -> ${newTodayTaskIds.length}`);
    } catch (e) {
      console.warn('[AutoPlan] Failed to update TODAY tag taskIds:', e);
    }
    
    // Step 2: Also update each task's tagIds to remove TODAY
    // This ensures consistency from the task's perspective
    let removedCount = 0;
    for (const taskId of tasksToRemove) {
      const task = taskMap[taskId];
      if (!task) continue;
      
      try {
        // Get current tagIds and remove TODAY
        const currentTagIds = task.tagIds || [];
        const newTagIds = currentTagIds.filter(id => id !== 'TODAY');
        
        // Only update if tagIds actually changed
        if (newTagIds.length !== currentTagIds.length) {
          await PluginAPI.updateTask(taskId, { tagIds: newTagIds });
          removedCount++;
        }
      } catch (e) {
        console.warn(`[AutoPlan] Failed to remove task ${taskId} from TODAY tag:`, e);
      }
    }
    
    console.log(`[AutoPlan] Removed ${removedCount} tasks from TODAY tag (scheduled for future dates)`);
    return removedCount;
    
  } catch (error) {
    console.warn('[AutoPlan] Error cleaning TODAY tag:', error);
    return 0;
  }
}

/**
 * Preview the schedule without applying
 */
async function previewSchedule() {
  return runAutoplan(true);
}

/**
 * Merge all split task groups back into single tasks
 * @returns {Promise<number>} Number of groups merged
 */
async function mergeAllSplitGroups() {
  console.log('[AutoPlan] Merging split tasks...');
  const splitGroups = await TaskMerger.findAllSplitGroupsAsync();
  let mergedCount = 0;
  
  for (const group of splitGroups) {
    // Get the first task ID from the group to trigger merge
    // group.splits[0] is { task, splitInfo }, so we need .task.id
    const firstTaskId = group.splits[0].task.id;
    try {
      // Pass silent=true to suppress individual merge notifications
      const result = await TaskMerger.mergeSplits(firstTaskId, true);
      if (result) {
        mergedCount++;
        console.log(`[AutoPlan] Merged group: ${group.originalTitle}`);
      }
    } catch (e) {
      console.warn(`[AutoPlan] Failed to merge group ${group.originalTitle}:`, e);
    }
  }
  
  console.log(`[AutoPlan] Merged ${mergedCount} split task groups`);
  return mergedCount;
}

/**
 * Clear planning fields from tasks
 * @param {Object} config - Configuration object with doNotRescheduleTagId
 * @returns {Promise<number>} Number of tasks cleared
 */
async function clearTasksPlanning(config) {
  console.log('[AutoPlan] Clearing planning...');
  const allTasks = await PluginAPI.getTasks();

  // Filter tasks that should have their planning cleared:
  // - Not done
  // - Has time estimate
  // - Does NOT have the "do not reschedule" tag
  const tasksToClear = allTasks.filter(task => {
    // Skip completed tasks
    if (task.isDone) return false;
    
    // Skip tasks without time estimate
    if (!task.timeEstimate || task.timeEstimate <= 0) return false;
    
    // Skip tasks with "do not reschedule" tag
    if (isFixedTask(task, config)) {
      return false;
    }
    
    // Only include tasks that have some planning set
    if (!task.dueWithTime && !task.dueDay) return false;
    
    return true;
  });

  console.log(`[AutoPlan] Found ${tasksToClear.length} tasks to clear planning from`);

  // Clear planning from each task
  let clearedCount = 0;
  for (const task of tasksToClear) {
    try {
      await PluginAPI.updateTask(task.id, {
        dueWithTime: undefined,
        dueDay: undefined,
        hasPlannedTime: undefined,
      });
      clearedCount++;
    } catch (e) {
      console.warn(`[AutoPlan] Failed to clear planning for task ${task.id}:`, e);
    }
  }

  return clearedCount;
}

/**
 * Build result message for clear planning operation
 * @param {number} mergedCount - Number of split groups merged
 * @param {number} clearedCount - Number of tasks cleared
 * @returns {string} - User-friendly message
 */
function buildClearPlanningMessage(mergedCount, clearedCount) {
  if (mergedCount > 0 && clearedCount > 0) {
    return `Merged ${mergedCount} split groups, cleared planning from ${clearedCount} tasks`;
  } else if (mergedCount > 0) {
    return `Merged ${mergedCount} split groups`;
  } else if (clearedCount > 0) {
    return `Cleared planning from ${clearedCount} tasks`;
  }
  return 'No tasks to clear planning from';
}

/**
 * Clear planning (dueWithTime, dueDay, hasPlannedTime) from all tasks that:
 * - Don't have the "Do Not Reschedule" tag
 * - Have a time estimation
 * - Are not completed
 * 
 * Also merges all split tasks back into their original tasks first.
 * 
 * @param {boolean} silent - If true, don't show snack notifications (used when called internally)
 */
async function clearPlanning(silent = false) {
  console.log('[AutoPlan] Clearing planning from tasks...');

  try {
    const config = await loadConfig();
    
    // Step 1: Merge all split tasks first
    const mergedCount = await mergeAllSplitGroups();

    // Step 2: Clear planning from all eligible tasks
    const clearedCount = await clearTasksPlanning(config);

    // Build and show result message
    const message = buildClearPlanningMessage(mergedCount, clearedCount);

    if (!silent) {
      PluginAPI.showSnack({
        msg: message,
        type: mergedCount > 0 || clearedCount > 0 ? 'SUCCESS' : 'INFO',
      });
    }

    return { merged: mergedCount, cleared: clearedCount };

  } catch (error) {
    console.error('[AutoPlan] Error clearing planning:', error);
    PluginAPI.showSnack({
      msg: `Error clearing planning: ${error.message}`,
      type: 'ERROR',
    });
    throw error;
  }
}

// ============================================================================
// PLUGIN INITIALIZATION
// ============================================================================

// Register side panel button
PluginAPI.registerSidePanelButton({
  label: 'AutoPlan',
  icon: 'auto_fix_high',
  onClick: () => {
    // Required handler - side panel content is shown via sidePanel:true in manifest
  },
});

// Register keyboard shortcut - opens the panel
PluginAPI.registerShortcut({
  keys: 'ctrl+shift+a',
  label: 'Open AutoPlan',
  action: () => {
    PluginAPI.showIndexHtmlAsView();
  },
});

// Expose functions for iframe communication
window.AutoPlanAPI = {
  runAutoplan,
  previewSchedule,
  clearPlanning,
  loadConfig,
  saveConfig,
  getDefaultConfig: () => ({ ...DEFAULT_CONFIG }),
  // Merge functions
  findRelatedSplits: (taskId) => TaskMerger.findRelatedSplitsAsync(taskId),
  mergeSplits: (taskId) => TaskMerger.mergeSplits(taskId),
  findAllSplitGroups: () => TaskMerger.findAllSplitGroupsAsync(),
};

