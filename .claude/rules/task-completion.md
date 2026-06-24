# Task Completion (PRIORITY: CRITICAL)

Always complete every pending task without stopping. Never pause between tasks or wait for the user to say "continue", "proceed", or "finish the rest".

## When a Plan or Task List Has Pending Items

- A plan file in context with uncompleted steps → execute every remaining step, in order, end-to-end
- A task list with `pending` or `in_progress` tasks → claim each task and complete it before responding to the user
- A session that resumed after context compression → read the plan/task list summary and continue from where work stopped — do NOT ask the user what to do next

## Never Do This

- Stop after completing one task and report "ready for the next step"
- Complete a subset of tasks and say "let me know when to continue"
- Finish a phase and ask "shall I proceed with the remaining tasks?"
- Treat a session resumption as a blank slate — check for pending tasks and continue them
- Declare the work "complete" or "done" while the task list still has open or in-progress items — always verify task list state before issuing any final summary

## Always Do This

- After each task completes, immediately pick up the next pending task
- Mark tasks `in_progress` when starting, `completed` when done, then move to the next
- When the plan has N steps, execute all N steps in the same response chain
- If a step fails, fix it and continue — only stop if the failure is genuinely unrecoverable and requires user input

## Scope

This rule applies to all task sources: TaskList/TaskUpdate tool, plan `.md` files loaded into context, numbered step lists in prompts, and any other structured list of work items.
