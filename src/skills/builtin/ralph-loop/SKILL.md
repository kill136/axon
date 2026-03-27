---
name: ralph-loop
description: Create and manage self-iterating tasks with Ralph loop. Use when you need to set up a task that will automatically re-run until it outputs a completion promise or reaches maximum iterations.
---

# Ralph Loop - Self-Iterating Task System

Ralph Loop is a system for creating self-iterating tasks that repeatedly submit the same prompt to Claude until a completion condition is met.

## How It Works

1. **State File**: Creates a `.claude/ralph-loop.local.md` file that tracks iteration progress
2. **Re-submission**: On each iteration completion, the Stop Hook checks if the completion promise has been output
3. **Loop Until Done**: If the promise hasn't appeared, the task re-runs with an updated iteration count
4. **Auto-stop**: Stops when either:
   - The completion promise is output by Claude
   - Maximum iterations is reached

## Usage

### Basic Ralph Loop

```bash
/loop "Your iterative task here" --max-iterations 10 --promise "✅ TASK COMPLETE"
```

### Parameters

- `prompt` (required): The task description that will be re-submitted
- `--max-iterations` (optional): Maximum number of iterations (default: 10)
- `--promise` (optional): Completion marker text (default: "✅ TASK COMPLETE")

### Example: Iterative Code Review

```bash
/loop "Review this code for bugs and improve it. Output <promise>✅ CODE REVIEW COMPLETE</promise> when you've done at least 3 rounds of improvements."
```

## State File Format

The `.claude/ralph-loop.local.md` file contains:

```yaml
---
iteration: 1
max_iterations: 10
completion_promise: "✅ TASK COMPLETE"
---

Your prompt text here.
Output <promise>✅ TASK COMPLETE</promise> when complete.
```

### Fields

- `iteration`: Current iteration number (1-indexed)
- `max_iterations`: Maximum allowed iterations
- `completion_promise`: Text that signals task completion (must be in `<promise>...</promise>` tags)

## Implementation Details

### File Location

State files are saved to `.claude/ralph-loop.local.md` in the project root.

### Stop Hook Integration

The Stop Hook monitors for ralph-loop state files and:
1. Checks if completion promise appeared in the output
2. If not, increments iteration counter
3. Re-submits the prompt to Claude with system context about current iteration

### Completion Detection

Claude must output the completion promise wrapped in tags:
```
<promise>✅ TASK COMPLETE</promise>
```

The promise text must match exactly (case-sensitive).

## Best Practices

1. **Clear Instructions**: Tell Claude explicitly when to output the promise
2. **Measurable Progress**: Each iteration should show visible progress toward completion
3. **Reasonable Limits**: Set max-iterations based on task complexity (typically 5-15)
4. **Explicit Stopping Rule**: In the prompt, explain exactly when the promise should be output

## Example Patterns

### Iterative Refinement
```
/loop "Improve this function based on feedback. Output <promise>✅ REFINEMENT DONE</promise> after 3 rounds of improvements." --max-iterations 5
```

### Convergence-Based Tasks
```
/loop "Generate and test variations until you find one that meets all criteria. Output <promise>✅ SOLUTION FOUND</promise> when satisfied." --max-iterations 20
```

### Multi-Step Processes
```
/loop "Execute this workflow step by step. Output <promise>✅ WORKFLOW COMPLETE</promise> when all steps are done." --max-iterations 8
```

## Troubleshooting

### Loop keeps running at max iterations

- Check that the promise text in your prompt matches `completion_promise` exactly
- Ensure the promise is wrapped in `<promise>...</promise>` tags
- The promise check is case-sensitive

### Loop stops immediately

- This usually means the prompt already contains the completion promise
- Move the promise instruction outside the initial prompt if possible

### Performance considerations

- Each iteration adds latency as Claude is re-invoked
- Plan iterations carefully - more iterations = longer execution time
- Consider breaking very complex tasks into multiple smaller loops
