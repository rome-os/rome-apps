---
name: quiz-in-chat
description: Run a spaced-repetition review (a "quiz me") session conversationally in chat for the Teach app. Pull the cards that are due, then quiz the learner ONE card at a time using the interactive `ask_question` card — single-choice for multiple-choice cards, a text box for free-recall cards — grade each answer server-side, give a short encouraging verdict, and recap at the end. Reach for this whenever the learner wants to be quizzed, do their review, or test what they've learned. Do not invent cards and do not grade raw numbers.
tools: [ask_question, teach_find_due_reviews, teach_grade_review, teach_get_dashboard_data]
---

# Quiz the learner in chat

When the learner wants to be quizzed — "quiz me", "let's review", "test me on X",
or the dashboard's **Quiz me in chat** button opened this session — run their
spaced-repetition review as a tight, encouraging conversation. The learner never
sees grades, intervals, or card internals; they just answer questions and learn.

The golden rule: **ask with the `ask_question` card, one card at a time, and WAIT
for the answer before grading.** Never type the question and options as plain
text and never guess the learner's answer — always surface the interactive card
and let their tap/typing come back to you.

## 1. Pull what's due

Call `teach_find_due_reviews` first.

- If the learner named a specific mission, quiz only that mission's due cards;
  otherwise quiz across all due cards.
- If nothing is due, say so warmly in one line ("You're all caught up — nothing
  due right now.") and stop. Do **not** invent cards or pull cards that aren't due.

Each due card comes back with at least `{ id, front, quizType, options? }`:

- `quizType: "mcq"` — multiple choice. `options` is a pre-shuffled array; present
  them in exactly that order.
- `quizType: "qa"` — free recall. The learner answers in their own words.

## 2. Quiz ONE card at a time with `ask_question`

For each due card, emit a single `ask_question` card and wait. Their answer
arrives as the next turn — only then do you grade and move on. Track progress in
the question text or your lead-in, e.g. "Card 2 of 6".

**MCQ card** → one `single`-choice question:

```json
{ "questions": [ {
  "id": "card_<cardId>",
  "question": "<the card's front>",
  "type": "single",
  "options": ["<option A>", "<option B>", "<option C>", "<option D>"],
  "freeText": false
} ] }
```

- Use the card's `options` verbatim and in the given (pre-shuffled) order.
- The answer comes back as the exact option text the learner chose.

**QA card** → one `text` question:

```json
{ "questions": [ {
  "id": "card_<cardId>",
  "question": "<the card's front>",
  "type": "text"
} ] }
```

- The answer comes back as their free-text response.

Ask **one card per `ask_question` call** — do not batch several cards into one
card. This keeps it a real one-at-a-time quiz and matches how reviews are graded.

## 3. Grade the answer (server derives the verdict)

After the learner's answer comes back, call `teach_grade_review` with their
SUBMISSION — never a numeric grade:

- **mcq:** `selected_option` = the exact option text they chose (map a returned
  letter/label back to the option text if needed).
- **qa:** `text` = their free-text answer (an AI judge scores it).

The action derives the verdict (`correct` / `partial` / `wrong`) and the SM-2
grade itself, and returns feedback, the correct answer, and when the card is next
due. If the learner clearly found a correct card trivially easy, you may re-grade
once with `override_easy: true`.

## 4. Give a short verdict, then continue

After each grade, reply briefly and encouragingly:

- the verdict (correct / partially correct / not quite),
- the correct answer,
- a one-line "why",
- optionally when it's next due.

Then immediately surface the next card's `ask_question` card. Keep the whole
thing brisk — short verdicts, no walls of text.

## 5. Recap at the end

When the due queue is empty, give a brief recap: how many cards they reviewed and
how they did, a word of encouragement, and — if it fits — suggest the next lesson
or that they can keep going on the Teach dashboard. Then stop.

## Guardrails

- Always ground card ids and option text in real values from
  `teach_find_due_reviews` — never invent ids, fronts, or options.
- One `ask_question` card per quiz card; wait for the answer before grading.
- Pass the learner's submission to `teach_grade_review`, never a raw grade.
- If `teach_find_due_reviews` returns nothing, don't manufacture a quiz.
