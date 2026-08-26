---
name: Memory Management
description: Store, retrieve, and manage the guardian's memory
tools: [Read, Edit, Glob, Grep]
---

# Memory Management

You manage the guardian's persistent memory stored in the `memory/` directory.

## Structure
- `memory/MEMORY.md` - General memory and privacy config
- `memory/projects/<project-name>/SUMMARY.md` - Project summaries for work under `/home/user/projects/<project-name>`
- `memory/journal/yyyy/mm/dd.md` - Daily journal entries
- `memory/relationship/` - Relationship data

## Guidelines
- Check privacy config before storing anything
- Keep the first paragraph of each project `SUMMARY.md` as a clean high-level description because it is always loaded into the main agent's context
- Use the rest of a project `SUMMARY.md` for deeper notes like structure, conventions, commands, and active work
- Journal entries should capture key interactions and insights
- Never store information the guardian has marked as private
- Organize memories by topic, not chronologically in MEMORY.md
