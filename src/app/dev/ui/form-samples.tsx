'use client';

import { useActionState } from 'react';

import {
  Button,
  ChangedElsewhereNotice,
  Checkbox,
  DefinitionList,
  Form,
  FormField,
  Notice,
  PasswordInput,
  RadioGroup,
  Select,
  Switch,
  Textarea,
  TextInput,
} from '@/lib/ui';

import type { FieldErrors } from '@/lib/ui';
import type { ReactNode } from 'react';

/** What the sample action answers, as a Server Action would through `useActionState`. */
type Answer = Readonly<{ errors?: FieldErrors; message?: string; saved?: string }>;

const ZONES = [
  { value: 'Europe/Paris', label: 'Paris time' },
  { value: 'America/New_York', label: 'New York time' },
];

const REASONS = [
  { value: 'wrong-date', label: 'Wrong date' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'other', label: 'Other' },
];

/** The sample check of the server: the name and a reason are required. */
function check(formData: FormData): Answer {
  const errors: Record<string, string> = {};
  if (formData.get('displayName') === '') {
    errors['displayName'] = 'Enter a display name.';
  }
  if (!formData.has('reason')) {
    errors['reason'] = 'Choose a reason.';
  }
  return Object.keys(errors).length === 0
    ? { saved: 'The sample is saved.' }
    : { errors, message: 'Nothing was saved: correct the fields below.' };
}

/**
 * Every kind of field in one form, whose sample action refuses a missing name
 * and reason: the error summary, the field errors and the kept input show once
 * Save is pressed with the form empty.
 */
export function FieldsSample(): ReactNode {
  const [state, dispatch] = useActionState(
    (_previous: Answer, formData: FormData) => check(formData),
    {},
  );
  return (
    <Form
      action={dispatch}
      errors={state.errors}
      message={state.message}
      errorSummaryTitle="The sample was not saved"
    >
      <Notice tone="success" message={state.saved} />
      <FormField
        name="displayName"
        label="Display name"
        hint="As it should appear on every screen."
        requiredMark="(required)"
      >
        <TextInput autoComplete="off" />
      </FormField>
      <FormField name="secret" label="Password">
        <PasswordInput autoComplete="new-password" revealLabel="Show the password" />
      </FormField>
      <FormField name="notes" label="Notes">
        <Textarea />
      </FormField>
      <FormField name="zone" label="Time zone">
        <Select options={ZONES} defaultValue="Europe/Paris" />
      </FormField>
      <RadioGroup
        name="reason"
        legend="Reason"
        hint="Pick the closest one."
        requiredMark="(required)"
        options={REASONS}
      />
      <Checkbox
        name="understood"
        label="I have read the explanation"
        hint="Checking it changes nothing in this sample."
      />
      <Switch name="digest" label="Daily digest" hint="A sample switch, off at first." />
      <Switch name="sound" label="Sound" defaultChecked />
      <div>
        <Button type="submit" label="Save" variant="primary" />
      </div>
    </Form>
  );
}

// The version that "another device" saved while the sample was being edited.
const CURRENT_VERSION = 'Read every morning, before the first game of the day.';

/**
 * A form whose save always finds the object changed elsewhere: the notice shows
 * the current version, beside the input, which stays to be applied again
 * (CL-IHM-18).
 */
export function ChangedElsewhereSample(): ReactNode {
  const [current, dispatch] = useActionState((): string | undefined => CURRENT_VERSION, undefined);
  return (
    <Form action={dispatch} errorSummaryTitle="The note was not saved">
      {current !== undefined && (
        <ChangedElsewhereNotice
          title="Changed elsewhere"
          message="This note changed on another device or in a scheduled task. Your input is kept below: compare it with the current version, then save again."
          currentVersionTitle="Current version"
        >
          <DefinitionList items={[{ term: 'Note', details: current }]} />
        </ChangedElsewhereNotice>
      )}
      <FormField name="note" label="Note">
        <Textarea defaultValue="Read every evening." />
      </FormField>
      <div>
        <Button type="submit" label="Save the note" variant="primary" />
      </div>
    </Form>
  );
}
