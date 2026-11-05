"use client";

import { avatarOf } from "@/lib/employeeAvatar.mjs";
import { useMemo, useState } from "react";
import SchemaFormPanel from "@/components/schema-form/SchemaFormPanel";
import useFormErrors from "@/components/shared/useFormErrors";
import { createTask, updateTask, uploadTaskAttachment } from "@/services/hrm/tasks.service";
import { TaskFilePicker } from "@/components/hrm/TaskAttachments";
import {
  PRIORITY_LABELS,
  TASK_PRIORITIES,
  TASK_TYPES,
  emptyTaskValues,
  taskFormValues,
  taskFormSections,
  taskTypeIsOther,
  OTHER_TASK_TYPE,
} from "@/constants/taskConfig";

/**
 * Giving somebody a task.
 *
 * The same full-screen panel every other form in the OS opens in, driven by the field list in
 * `taskConfig` — so the sections, the rail beside them and the validation messages are the ones the
 * rest of the application already draws, and adding a field to a task is adding a line there.
 *
 * Three jobs, one form: raising a task, **duplicating** one, and **correcting** one.
 *
 * It was creation only, on the reasoning that what was asked for is the record the receiver acted
 * on and changing it under them would leave a completed task describing something else. The studio
 * asked for the opposite, and the reasoning was worth less than it looked: a task written down
 * wrong was already being fixed by deleting it and raising it again, which loses its history, its
 * attachments and its holder chain. Correcting it in place keeps all three and writes a line saying
 * what changed - see `updateTask` in the service, which names the fields that moved.
 *
 * Who may correct one is not this form's answer: the server allows the giver and a Super Admin, and
 * the menu offers Edit only where the record came back saying `canEdit`. The receiver is
 * deliberately not among them - they act on a task through the four verbs on the detail panel, and
 * rewriting the title or the due date would let somebody restate the job they were given.
 *
 * Duplicating is a create that starts from an existing task rather than from an empty form, which
 * is what the studio does with anything recurring. It carries no id, so it cannot be mistaken for
 * an edit, and it deliberately does **not** carry the original's attachments: the files belonged to
 * that task, and copying them silently would attach somebody else's work to a new job.
 *
 * The assignee is not editable, only chosen. Handing a task to somebody else is a real event in its
 * life - `POST /:id/reassign` records it in the holder chain and tells the new holder - so an edit
 * that quietly changed it would be a second, worse way of doing something the module already does
 * properly. On a duplicate it is a fresh choice like any other field.
 *
 * The files are the one part that is not saved with the rest. They are uploaded after the task
 * exists, because until it does there is nothing to attach them to — uploading them somewhere
 * temporary first would leave an orphan behind every form somebody opened and thought better of.
 * A file that fails to upload does not undo the task: the task is real and assigned by then, so the
 * panel says which file did not make it and leaves the rest attached rather than pretending the
 * whole thing failed.
 */
export default function TaskFormPanel({ users = [], taskTypes = TASK_TYPES, taskTypesAskingForDetails = [OTHER_TASK_TYPE], priorities = TASK_PRIORITIES, departments = [], branches = [], onClose, onCreated, task = null, mode = "create" }) {
  const editing = mode === "edit";
  /*
   * The form as it opens: empty for a new task, and filled from `task` for an edit or a duplicate.
   *
   * Seeded once rather than synced by an effect - the panel is mounted per task by its caller's
   * `key`, so first render is this task's first render, and re-seeding afterwards would overwrite
   * whatever had been typed since.
   */
  const [values, setValues] = useState(() => (task ? taskFormValues(task) : emptyTaskValues()));
  const fields = useFormErrors();
  // What is wrong with the save rather than with a field: the server's refusal, a file not attached.
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Held as picked, and uploaded once the task has an id. See the note above the component.
  const [files, setFiles] = useState([]);

  /*
   * What the pickers offer. The people come from the tasks module's own narrow endpoint — ids and
   * names and nothing else — and the two scales are turned into labels here rather than on the
   * server, which speaks in the values it stores.
   */
  const context = useMemo(() => ({
    options: {
      users: users.map((user) => ({ value: user.id, label: user.name, avatar: avatarOf(user) })),
      taskTypes,
      // Which of them ask what the work was, as the server answered it - the form asks for exactly
      // what the server would refuse the task without.
      taskTypesAskingForDetails,
      priorities: priorities.map((priority) => ({ value: priority, label: PRIORITY_LABELS[priority] || priority })),
      // Names, which are both the label and the stored value - the task keeps the department and
      // branch it was filed under rather than a reference that a later rename would rewrite.
      departments,
      branches,
    },
    /*
     * Which job this form is doing, so the field list can hide what an edit does not own - see the
     * `when` on Assigned To in `taskConfig`. Carried in the context rather than read from a prop
     * inside the config, because the config is a plain list with no component around it.
     */
    editing,
  }), [branches, departments, editing, priorities, taskTypes, taskTypesAskingForDetails, users]);

  function change(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
    // The message goes the moment the field it was about is touched, rather than waiting for the
    // next save to tell somebody they have already fixed it.
    fields.clear(name);
  }

  /** What the server would refuse, asked here first so the answer lands on the field itself. */
  function validate() {
    const found = {};
    if (!values.assignedToUserId) found.assignedToUserId = "Choose who this task is for.";
    if (!values.taskType) found.taskType = "Choose what kind of task this is.";
    // Only asked for while "Other" is the answer - the field is not on screen otherwise, and a
    // message about a box nobody can see would stop the form with nothing to fix.
    if (taskTypeIsOther(values, context) && !String(values.taskTypeOther || "").trim()) {
      found.taskTypeOther = "Say what kind of task this is.";
    }
    if (!values.priority) found.priority = "Choose a priority.";
    if (!values.department) found.department = "Choose which department this is for.";
    if (!values.branch) found.branch = "Choose which branch this is for.";
    if (!String(values.title || "").trim()) found.title = "Give the task a title.";
    if (!String(values.description || "").trim()) found.description = "Describe what needs doing.";
    return found;
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!fields.check(validate())) return;

    setSaving(true);
    try {
      /*
       * The same fields either way, minus the one an edit does not own.
       *
       * `assignedToUserId` is left out of an update because reassigning is its own verb, with its
       * own holder-chain entry and its own notice to the new holder - and the server's update
       * schema omits it too, so sending it would be refused rather than quietly ignored.
       */
      const payload = {
        ...(editing ? {} : { assignedToUserId: Number(values.assignedToUserId) }),
        title: String(values.title).trim(),
        description: String(values.description).trim(),
        taskType: values.taskType,
        taskTypeOther: taskTypeIsOther(values, context) ? String(values.taskTypeOther).trim() : null,
        priority: values.priority,
        department: values.department,
        branch: values.branch,
        dueOn: values.dueOn || null,
      };
      const response = editing ? await updateTask(task.id, payload) : await createTask(payload);
      const created = response?.data;

      /*
       * An edit is finished here. There is no file step - the attachments belong to the task
       * already and are added and removed from the detail panel, which is where somebody looking at
       * a task manages them.
       */
      if (editing) {
        // The same two arguments the create path hands back - the saved task and what to say about
        // it - so the caller has one shape to read rather than two.
        onCreated?.(created, `${created?.taskCode || "The task"} updated.`);
        return;
      }

      /*
       * The files, one at a time, in the order they were picked.
       *
       * Sequential rather than in parallel: the server takes them singly, and a failure then names
       * the file that failed with the ones before it already attached. The task itself is already
       * saved by this point, so a refused file is reported beside a task that exists rather than
       * rolling back work the studio has been told about.
       */
      const failed = [];
      for (const file of files) {
        try {
          await uploadTaskAttachment(created.id, file);
        } catch (error) {
          failed.push(`${file.name}${error?.data?.message ? ` (${error.data.message})` : ""}`);
        }
      }

      const attached = files.length - failed.length;
      const filesSaid = attached ? ` ${attached} file${attached === 1 ? "" : "s"} attached.` : "";
      const message = `${created?.taskCode || "The task"} assigned to ${created?.assignedToName || "them"}.${filesSaid}`;
      if (failed.length) {
        // The task is real and the panel stays open saying so, rather than closing on a success
        // notice that would be the last anybody heard of the files that did not make it.
        setError(`${message} These files could not be attached: ${failed.join(", ")}.`);
        setFiles([]);
        return;
      }
      onCreated?.(created, message);
    } catch (error) {
      // The server's own message where it has one — it is the specific reason, and a generic
      // fallback here would hide "that login is not active" behind "unable to create that task".
      if (!fields.fromServer(error)) setError(error?.data?.message || error?.message || "Unable to create that task.");
    } finally {
      setSaving(false);
    }
  }

  /*
   * The form's own sections, plus the files. A section with a `render` rather than a field in
   * `taskConfig`, because what it holds is `File` objects the browser is keeping - not a value the
   * schema form could store, validate or send with the rest of the payload.
   */
  const sections = useMemo(() => [
    ...taskFormSections,
    {
      id: "attachments",
      title: "Attachments",
      render: () => <TaskFilePicker
        files={files}
        onChange={setFiles}
        disabled={saving}
        onError={setError}
      />,
    },
  ], [files, saving]);

  return <SchemaFormPanel
    /*
     * Named for what the press will do. "Assign a Task" over a form filled with somebody else's
     * task is the kind of thing that gets a duplicate saved as an edit in somebody's head.
     */
    title={editing ? `Edit ${task?.taskCode || "Task"}` : task ? "Duplicate Task" : "Assign a Task"}
    description="Anybody in the studio can be asked, and they are told the moment you save."
    sections={sections}
    values={values}
    onChange={change}
    errors={fields.errors}
    context={context}
    saving={saving}
    submitLabel={editing ? "Save Changes" : "Assign Task"}
    savingLabel="Assigning..."
    sidebarAriaLabel="Task sections"
    closeAriaLabel="Close task form"
    onClose={onClose}
    onSubmit={submit}
    error={error || fields.summary}
  />;
}
