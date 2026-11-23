// The public API of the to-do list (module map, section 2.4): one slot per file that the
// plan gives the module, with the operations it will export. A task adds its exports in
// its own file's slot only (section 9).

// The composition of the six sections and the Home count
export { todoCount, todoList, SECTIONS_IN_ORDER } from './todo-list';
export type { TodoItem, TodoList, TodoObjectRef, TodoSection, TodoSectionId } from './todo-list';

// requests.ts: the requests to do (BKT-17, BKT-18)

// supplements.ts: the proposed supplementary requests (BKT-05, BKT-06, TAX-20, TAX-24)

// incidents.ts: the open incidents and the hidden count (TRV-45)
export type { IncidentRef, IncidentTodoItem } from './incidents';

// players.ts: the players section (JOU-04, JOU-06, JOU-10, STA-03, JOU-22)

// type-proposals.ts: the proposed types, oldest first

// review.ts: the events and cases to review (TAX-25, TAX-29, SEN-16, DET-32, SEN-45)
