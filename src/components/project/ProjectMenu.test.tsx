import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { useAppStore } from '@/store/store';
import { MALFORMED_MESSAGE, type ProjectParseResult } from '@/store/projectFile';
import type { ProjectBody } from '@/store/projectFormat';
import type { ProjectStoreResult } from '@/store/projectStore';
import type { ProjectSlotRecord } from '@/store/projectSource';
import { UNREADABLE_FILE_MESSAGE, type FileReadResult } from '@/utils/projectFileIO';
import type { PickHandleResult } from '@/utils/localFileSave';
import {
  PROJECT_MENU_SECTIONS,
  toolsRows,
  ProjectMenu,
  REPLACE_CONFIRM_MESSAGE,
  REPLACING_ACTIONS,
  driveAccountLabel,
  openParsedProjectFile,
  openPickedLocalFile,
  openReadResult,
  replaceConfirmMessage,
  replacesProject,
  saveLabel,
  visibleMenuSections,
  type OpenProjectFile,
} from './ProjectMenu';

function openTag(html: string, needle: string): string {
  const idx = html.indexOf(needle);
  if (idx === -1) throw new Error(`not found in markup: ${needle}`);
  return html.slice(html.lastIndexOf('<', idx), html.indexOf('>', idx) + 1);
}

const FAKE_BODY = { id: 'p1', name: 'x', createdAt: 0, updatedAt: 0 } as unknown as ProjectBody;

/** Records every call and answers with a fixed result — `openProjectFile` never actually installs anything here. */
function fakeOpenProjectFile(
  result: ProjectStoreResult<ProjectSlotRecord> = { ok: true, value: {} as ProjectSlotRecord },
) {
  const calls: Array<[ProjectBody, unknown, readonly string[] | undefined]> = [];
  const openProjectFile: OpenProjectFile = async (body, source, importWarnings) => {
    calls.push([body, source, importWarnings]);
    return result;
  };
  return { openProjectFile, calls };
}

/** Records every message `report` was called with. */
function recordingReport() {
  const messages: Array<string | null> = [];
  return { report: (m: string | null) => messages.push(m), messages };
}

/** Records every toast `notify` was called with (§5.6: message + tone). */
function recordingNotify() {
  const toasts: Array<{ message: string; tone: string }> = [];
  return { notify: (message: string, tone: string) => toasts.push({ message, tone }), toasts };
}

/** The Tools rows this build ships: `Diagnostics` exists only when `import.meta.env.DEV`. */
const shippedTools = () => toolsRows({ development: import.meta.env.DEV === true }).map((r) => r.action);

const allActions = () => PROJECT_MENU_SECTIONS.flatMap((section) => section.rows.map((row) => row.action));

/** The actions a user actually sees, given availability, sign-in and source. */
const visibleActions = (available: boolean, signedIn: boolean, sourceKind: 'drive' | 'local' | 'untitled') =>
  visibleMenuSections(available, signedIn, sourceKind, null).flatMap((s) => s.rows.map((r) => r.action));

describe('ProjectMenu with a remembered Drive account', () => {
  test('a remembered account offers Disconnect before this page holds a token', () => {
    const remembered = { email: 'ann@example.com', name: 'Ann' };
    const sections = visibleMenuSections(true, false, 'untitled', remembered);
    const drive = sections.find((section) => section.id === 'drive');
    expect(drive?.rows.map((row) => row.action)).toContain('disconnect-drive');
    expect(drive?.subtitle).toBe('ann@example.com');
  });
});

describe('ProjectMenu menu composition', () => {
  test('orders the menu as New, then Local, Drive, and tools', () => {
    expect(PROJECT_MENU_SECTIONS.map((s) => s.heading)).toEqual([null, 'Local', 'Drive', 'Tools']);
    expect(allActions()).toEqual([
      'new',
      'open',
      'save',
      'save-as',
      'open-drive',
      'save-as-drive',
      'disconnect-drive',
      ...shippedTools(),
    ]);
  });

  test('only Open, Open from Drive and New replace the project', () => {
    expect(REPLACING_ACTIONS).toEqual(['open', 'open-drive', 'new']);
    expect(replacesProject('save')).toBe(false);
    expect(replacesProject('save-as')).toBe(false);
    expect(replacesProject('save-as-drive')).toBe(false);
    expect(replacesProject('disconnect-drive')).toBe(false);
  });

  test('Save names Drive only for a Drive-bound file', () => {
    expect(saveLabel('drive')).toBe('Save to Drive');
    expect(saveLabel('local')).toBe('Save');
    expect(saveLabel('untitled')).toBe('Save');
  });

  test('the Drive account label prefers the email, then the name', () => {
    expect(driveAccountLabel(null)).toBeNull();
    expect(driveAccountLabel({ email: 'ann@example.com', name: 'Ann' })).toBe('ann@example.com');
    expect(driveAccountLabel({ email: '', name: 'Ann' })).toBe('Ann');
    expect(driveAccountLabel({ email: '', name: '' })).toBeNull();
  });

  // Every row renders into `id={`project-menu-${action}`}`, and two rows both
  // starting with "open" is exactly how a duplicated id would arrive.
  test('no two rows share an element id', () => {
    const ids = allActions().map((a) => `project-menu-${a}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('the Drive rows appear only when they can work, and the section vanishes otherwise', () => {
    // No client id: no Drive section at all — not a disabled one.
    expect(visibleActions(false, false, 'untitled')).toEqual(['new', 'open', 'save', 'save-as', ...shippedTools()]);
    // Configured but signed out: Open from Drive and Save as to Drive are offered
    // (the modal is where connecting happens), Disconnect is not.
    expect(visibleActions(true, false, 'untitled')).toEqual([
      'new',
      'open',
      'save',
      'save-as',
      'open-drive',
      'save-as-drive',
      ...shippedTools(),
    ]);
    expect(visibleActions(true, true, 'untitled')).toContain('disconnect-drive');
  });

  test('a Drive-bound file keeps its Save inside the Drive section', () => {
    expect(visibleActions(true, true, 'drive')).toEqual([
      'new',
      'open',
      'save-as',
      'open-drive',
      'save',
      'save-as-drive',
      'disconnect-drive',
      ...shippedTools(),
    ]);
  });

  test('renders Save actions without the removed Export action', () => {
    // The test deployment has no client id, so `driveAvailable` is false at
    // store creation and the Drive rows would be absent. useLiveStore serves
    // getState() for both snapshots, so setting it here does reach the render.
    useAppStore.setState({ driveAvailable: true });
    const html = renderToString(<ProjectMenu />);
    expect(html).toContain('id="project-menu-save"');
    expect(html).toContain('id="project-menu-save-as"');
    expect(html).not.toContain('id="project-menu-export"');
    expect(html).not.toContain('Export .solna');
    expect(html).toContain('Open from Drive');
    useAppStore.setState({ driveAvailable: false });
  });

  test('renders "Save to Drive" when the project came from Drive', () => {
    useAppStore.setState({ driveAvailable: true, projectSource: { kind: 'drive', fileId: 'f1' } });
    const html = renderToString(<ProjectMenu />);
    expect(html).toContain('Save to Drive');
    expect(html).toContain('id="project-menu-save-as-drive"');
    useAppStore.setState({ driveAvailable: false, projectSource: { kind: 'untitled' } });
  });

  test('renders the account under the Drive heading on its own line', () => {
    useAppStore.setState({ driveAvailable: true, driveUser: { email: 'ann@example.com', name: 'Ann' } });
    const html = renderToString(<ProjectMenu />);
    expect(html).toContain('ann@example.com');
    expect(html).toContain('block truncate');
    useAppStore.setState({ driveAvailable: false, driveUser: null });
  });

  test('the confirm copy says plainly that the project is replaced', () => {
    expect(REPLACE_CONFIRM_MESSAGE).toBe(
      'This replaces your current project. It is autosaved, so the one you are editing now will be gone.',
    );
  });

  test('the replace confirmation warns that an active export will be cancelled', () => {
    expect(replaceConfirmMessage(true)).toBe(
      `${REPLACE_CONFIRM_MESSAGE} The export in progress will be cancelled.`,
    );
    expect(replaceConfirmMessage(false)).toBe(REPLACE_CONFIRM_MESSAGE);
  });
});

describe('openReadResult', () => {
  // The defect this pins: a file that FAILED to read used to be laundered
  // through parseProjectFile('') and reported as "not a Solna project" — the
  // false message a user with a perfectly valid, unreadable file was shown.
  test('a read failure is reported as unreadable and never reaches the parser', async () => {
    const { openProjectFile, calls } = fakeOpenProjectFile();
    const { report, messages } = recordingReport();
    const { notify, toasts } = recordingNotify();
    const read: FileReadResult = { ok: false, cause: new Error('permission revoked') };
    await openReadResult(read, openProjectFile, report, notify);
    expect(toasts).toEqual([{ message: UNREADABLE_FILE_MESSAGE, tone: 'error' }]);
    expect(messages).toEqual([]);
    expect(calls).toEqual([]);
  });

  // The other half of the same distinction: content that was actually read but
  // is genuinely not JSON must still read as "not a Solna project".
  test('content that reads fine but is not JSON still reports malformed', async () => {
    const { openProjectFile, calls } = fakeOpenProjectFile();
    const { report, messages } = recordingReport();
    const { notify, toasts } = recordingNotify();
    const read: FileReadResult = { ok: true, text: 'not json at all' };
    await openReadResult(read, openProjectFile, report, notify);
    expect(toasts).toEqual([{ message: MALFORMED_MESSAGE, tone: 'error' }]);
    expect(messages).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('openPickedLocalFile', () => {
  const HANDLE = { name: 'song.solna' } as unknown as FileSystemFileHandle;
  const VALID = JSON.stringify({ formatVersion: 1, id: 'p1', name: 'Song', createdAt: 1, updatedAt: 2, content: {} });

  function harness(picked: PickHandleResult, read: FileReadResult) {
    const { openProjectFile, calls } = fakeOpenProjectFile();
    const { report, messages } = recordingReport();
    const { notify, toasts } = recordingNotify();
    let inputClicks = 0;
    const run = () =>
      openPickedLocalFile({
        pick: async () => picked,
        readHandle: async () => read,
        openWithInput: () => { inputClicks += 1; },
        openProjectFile,
        report,
        notify,
      });
    return { run, calls, messages, toasts, inputs: () => inputClicks };
  }

  // The defect this pins, and it is the case a user actually hit: in an
  // embedded webview `showOpenFilePicker` EXISTS, so the capability probe says
  // yes and the `unavailable` fallback never fires — but the handle it hands
  // back cannot read the file. The user was told the file was unreadable and
  // given no way forward, with their perfectly valid project blamed for it.
  // Feature detection standing in for the capability WORKING is the bug; a
  // successful read is the only thing that confirms the probe's answer.
  test('a handle that picks fine but cannot be read falls back to the <input> path', async () => {
    const h = harness({ ok: true, handle: HANDLE }, { ok: false, cause: new Error('webview') });
    await h.run();

    expect(h.inputs()).toBe(1);
    // Still said out loud: the second dialog is a route forward, not a denial
    // that the first attempt failed.
    expect(h.toasts).toEqual([{ message: UNREADABLE_FILE_MESSAGE, tone: 'error' }]);
    expect(h.messages).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  test('a picker the environment does not have goes straight to the <input>, silently', async () => {
    const h = harness({ ok: false, reason: 'unavailable' }, { ok: true, text: VALID });
    await h.run();

    expect(h.inputs()).toBe(1);
    // An honest degradation, not a failure: nothing went wrong to report.
    expect(h.messages).toEqual([]);
    expect(h.toasts).toEqual([]);
  });

  test('a cancelled pick does nothing at all', async () => {
    const h = harness({ ok: false, reason: 'cancelled' }, { ok: true, text: VALID });
    await h.run();

    expect(h.inputs()).toBe(0);
    expect(h.messages).toEqual([]);
    expect(h.toasts).toEqual([]);
    expect(h.calls).toEqual([]);
  });

  test('a read that succeeds keeps the handle as the source and never opens the <input>', async () => {
    const h = harness({ ok: true, handle: HANDLE }, { ok: true, text: VALID });
    await h.run();

    expect(h.inputs()).toBe(0);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]![1]).toEqual({ kind: 'local', handle: HANDLE });
  });
});

describe('openParsedProjectFile', () => {
  test('a parse failure is a toast, and never calls openProjectFile', async () => {
    const { openProjectFile, calls } = fakeOpenProjectFile();
    const { report, messages } = recordingReport();
    const { notify, toasts } = recordingNotify();
    const parsed: ProjectParseResult = { ok: false, error: 'malformed', message: MALFORMED_MESSAGE };
    await openParsedProjectFile(parsed, openProjectFile, report, notify);
    expect(toasts).toEqual([{ message: MALFORMED_MESSAGE, tone: 'error' }]);
    expect(messages).toEqual([]);
    expect(calls).toEqual([]);
  });

  // The other defect this pins: the parser's own warnings (an incompatible
  // synth patch reset to its default) used to be read here and discarded —
  // openProjectFile received the body and nothing else. They must now ride
  // along as the third argument, which is the seam projectSlice.ts folds them
  // into the same notice unknownLibraryReferences feeds.
  test('carries the parser’s warnings through to openProjectFile', async () => {
    const { openProjectFile, calls } = fakeOpenProjectFile();
    const { report } = recordingReport();
    const { notify } = recordingNotify();
    const warnings = ['Lead sound (reset to the default)'];
    const parsed: ProjectParseResult = { ok: true, body: FAKE_BODY, warnings };
    await openParsedProjectFile(parsed, openProjectFile, report, notify);
    expect(calls).toEqual([[FAKE_BODY, undefined, warnings]]);
  });

  // A save-storage failure (unavailable/failed/quota) is the same banner
  // family `openProjectFile` already wrote to — reported through `report`,
  // never a toast (§5.6), unless it is the notice-free storage-unavailable
  // degrade.
  test('an install failure reports it to the banner, unless it is the storage-unavailable degrade', async () => {
    const { report, messages } = recordingReport();
    const { notify, toasts } = recordingNotify();
    const failing = fakeOpenProjectFile({ ok: false, error: 'failed', message: 'boom' }).openProjectFile;
    await openParsedProjectFile({ ok: true, body: FAKE_BODY, warnings: [] }, failing, report, notify);
    expect(messages).toEqual(['boom']);
    expect(toasts).toEqual([]);

    const { report: report2, messages: messages2 } = recordingReport();
    const unavailable = fakeOpenProjectFile({ ok: false, error: 'unavailable', message: 'nope' }).openProjectFile;
    await openParsedProjectFile({ ok: true, body: FAKE_BODY, warnings: [] }, unavailable, report2, notify);
    expect(messages2).toEqual([]);
  });
});

describe('ProjectMenu rendering', () => {
  // The menu is behind a dropdown that opens on focus, which renderToString
  // never triggers — so the closed state is what is pinned here: the trigger is
  // a labelled button and the file input is present but hidden.
  test('renders a chevron dropdown trigger, a focusable span, and a hidden file picker', () => {
    const html = renderToString(<ProjectMenu />);
    expect(html).toContain('dropdown');
    const trigger = openTag(html, 'aria-label="Project menu"');
    expect(trigger.startsWith('<span')).toBe(true);
    expect(trigger).toContain('id="btn-project-menu"');
    expect(trigger).toContain('role="button"');
    expect(trigger).toContain('tabindex="0"');
    expect(html).not.toContain('solna</span>'); // the wordmark is no longer inside the menu
    expect(html).toContain('type="file"');
    expect(html).toContain('accept=".solna,.json"');
  });
});

describe('report-bug action', () => {
  test('the Tools section offers Report a Bug', () => {
    const tools = PROJECT_MENU_SECTIONS.find((s) => s.id === 'tools');
    expect(tools?.rows.map((r) => r.action)).toContain('report-bug');
  });

  test('production Tools has only report-bug; development adds diagnostics', () => {
    expect(toolsRows({ development: false }).map((r) => r.action)).toEqual(['report-bug']);
    expect(toolsRows({ development: true }).map((r) => r.action)).toEqual(['diagnostics', 'report-bug']);
  });

  test('the diagnostics panel loader is only constructed behind a compile-time DEV guard', () => {
    const source = readFileSync(new URL('./ProjectMenu.tsx', import.meta.url), 'utf8');
    const lazyAt = source.indexOf("import('@/diagnostics/DiagnosticPanel')");
    expect(lazyAt).toBeGreaterThan(-1);
    expect(source.indexOf("import('@/diagnostics/DiagnosticPanel')", lazyAt + 1)).toBe(-1);
    expect(source.slice(Math.max(0, lazyAt - 120), lazyAt)).toContain('import.meta.env.DEV');
  });

  test('reportManualIncident publishes an open manual/degraded report with no audio and only a route category', async () => {
    const { reportManualIncident, routeCategory } = await import('@/store/incidentReporter');
    const { incidentStore, clearIncident } = await import('@/incidents/incidentStore');
    await clearIncident();
    reportManualIncident('/loop/secret-project-name?loopId=abc');
    const { current, open } = incidentStore.getState();
    expect(open).toBe(true);
    expect(current?.kind).toBe('manual');
    expect(current?.severity).toBe('degraded');
    expect(current?.audio).toBeNull();
    expect(current?.summary).toBe('Manual bug report from the loop view');
    expect(JSON.stringify(current)).not.toContain('secret-project-name');
    expect(routeCategory('/somewhere/else')).toBe('unknown');
    await clearIncident();
  });
});
