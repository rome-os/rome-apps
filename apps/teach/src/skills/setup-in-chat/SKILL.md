---
name: setup-in-chat
description: Set up a new learning mission conversationally in chat for the Teach app. Interview the learner ONE question at a time using the interactive `ask_question` card — what they want to learn, WHY (their real motivation), and a couple of quick questions to gauge their level — then create the mission, record the calibrated level, and lay out the syllabus. Reach for this whenever the learner wants to start learning something new or the dashboard's "Set up in chat" / "Set up a mission in chat" button opened this session. Do NOT teach the first lesson in chat — hand the learner off to the Teach app to start learning. Do not invent ids.
tools: [ask_question, teach_create_mission, teach_assess_level, teach_generate_outline, teach_get_dashboard_data]
---

# Set up a new mission in chat

When the learner wants to start learning something new — "I want to learn X",
"set up a new mission", or the dashboard's **Set up in chat** button opened this
session — run a short, friendly intake interview, then create the mission and
plan the syllabus. **You do not teach here.** Once the mission is set up, hand
the learner to the Teach app to start the actual lessons.

The golden rule: **ask with the `ask_question` card, ONE question at a time, and
WAIT for the answer before moving on.** Never type the questions as plain text
and never guess the learner's answers — always surface the interactive card and
let their tap/typing come back to you as the next turn.

## 1. Interview — one `ask_question` at a time

Keep it light and conversational. Ask each question as a single `ask_question`
card and wait for the reply before asking the next. Cover, in order:

1. **WHAT** they want to learn. Free text, e.g.:

   ```json
   { "questions": [ {
     "id": "topic",
     "question": "What do you want to learn?",
     "type": "text"
   } ] }
   ```

2. **WHY** — their real motivation. This shapes everything; dig for the deeper
   reason, not just "it's useful". Free text.

3. **CURRENT LEVEL** — one or two quick questions to find their zone of proximal
   development (what they already know / have tried). Prefer a `single`-choice
   card when the answers are enumerable (offer concrete options AND `freeText`
   so they can type their own), e.g.:

   ```json
   { "questions": [ {
     "id": "level",
     "question": "How would you describe where you are with this today?",
     "type": "single",
     "options": ["Complete beginner", "Know the basics", "Comfortable, want depth"],
     "freeText": true
   } ] }
   ```

Ask only the few questions that actually change the plan — don't dump a form and
don't over-interview. If the learner already volunteered some of this, skip
ahead and just confirm.

## 2. Create the mission and plan the syllabus

Once you understand what + why + level, run these in order, grounding every
argument in what the learner actually told you:

1. `teach_create_mission` — pass the `title`, the `motivation` (their real why),
   and any constraints/preferences as `notes`. Keep the returned `missionId`.
2. `teach_assess_level` — record the calibrated `level` for that mission.
3. `teach_generate_outline` — lay out the syllabus (2–6 modules of planned
   lessons) so the learner sees the whole journey.

Always use the ids the actions return — never invent mission, module, or lesson
ids.

## 3. Confirm, then hand off to the Teach app — do NOT teach

Briefly confirm back in one or two lines: the mission and a glance at the module
outline. Then **stop and point the learner to the Teach app to start learning** —
do not generate or teach the first lesson in this chat.

Give them a direct link to their new mission so they can jump straight in:

```
Your mission is set up — open it in Teach to start your first lesson:
[Open in Teach](/apps/teach/mission/<missionId>)
```

Substitute the real `missionId` from `teach_create_mission`. Mention they can
also browse the full syllabus and run reviews there. Then stop.

## Guardrails

- One `ask_question` card per question; wait for the answer before continuing.
- Use `ask_question` for the interview — never ask the intake questions as plain
  chat text.
- Ground the mission, module, and lesson ids in real values returned by the
  actions — never invent them.
- Do **not** call `teach_generate_lesson` or teach a lesson in this session. This
  skill ends at "mission planned → open the Teach app." Lessons happen in the app.
- Always include the `/apps/teach/mission/<missionId>` deep link so the learner
  can land directly on their new mission.
